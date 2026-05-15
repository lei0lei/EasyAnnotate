/**
 * 模块：use-sam2-canvas-tool
 * 职责：SAM2 标注态下点/框交互；仅在当前图尚无缓存时向后端请求 encode-image（首张 prompt 或框确认前），解码前 await 保证与首点无竞态。
 */
import { fetchSam2ImageEmbeddings } from "@/lib/sam2-encode-api"
import type { Sam2EmbedCache } from "@/lib/sam2-encode-api"
import type { ImageGeometry } from "@/pages/project-task-detail/canvas-geometry"
import type { Sam2PromptMode } from "@/pages/project-task-detail/annotateTools/aiTools/types"
import type { Point } from "@/pages/project-task-detail/types"
import type { StageElementRef } from "@/pages/project-task-detail/hook-shared"
import { roundPointToInt } from "@/pages/project-task-detail/utils"
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type MutableRefObject } from "react"

export type Sam2ImagePoint = { id: string; x: number; y: number; label: 1 | 0 }

export type Sam2DecodeRequest = {
  imagePath: string
  promptMode: Sam2PromptMode
  points: Sam2ImagePoint[]
  bbox: { x1: number; y1: number; x2: number; y2: number } | null
  /** 仅当 decoder 导出预测 IoU 时生效；未导出时忽略 */
  minPredIou?: number
}

type PreviewRect = {
  left: number
  top: number
  width: number
  height: number
  clippedLeft: boolean
  clippedTop: boolean
  clippedRight: boolean
  clippedBottom: boolean
}

function newPointId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `p-${Date.now()}-${Math.random().toString(16).slice(2)}`
  }
}

function clientToImage(
  event: MouseEvent<Element>,
  stageRef: MutableRefObject<HTMLDivElement | null>,
  getGeometry: () => ImageGeometry | null,
  toImage: (p: Point, g: ImageGeometry) => Point | null,
): Point | null {
  const geometry = getGeometry()
  const rect = stageRef.current?.getBoundingClientRect()
  if (!geometry || !rect) return null
  return toImage({ x: event.clientX - rect.left, y: event.clientY - rect.top }, geometry)
}

export type Sam2AutoPromptParams = {
  enabled: boolean
  /** 仅「矩形框 + 自动 prompt」使用；点 + 自动 prompt 忽略 */
  objectBoxW: number
  /** 仅「矩形框 + 自动 prompt」使用；点 + 自动 prompt 忽略 */
  objectBoxH: number
  /** 0–1，与 decoder 导出的预测 IoU 比较（无 IoU 输出时不生效） */
  iouThreshold: number
  /** 0.3–1.5，悬停触发时间 = 基准 × 该系数 */
  hoverFactor: number
}

function clampInt(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.round(n)))
}

function buildAutoBboxFromCenter(cx: number, cy: number, boxW: number, boxH: number, iw: number, ih: number): {
  x1: number
  y1: number
  x2: number
  y2: number
} {
  const hw = boxW / 2
  const hh = boxH / 2
  let x1 = Math.round(cx - hw)
  let y1 = Math.round(cy - hh)
  let x2 = Math.round(cx + hw)
  let y2 = Math.round(cy + hh)
  const iwm = Math.max(0, iw - 1)
  const ihm = Math.max(0, ih - 1)
  x1 = clampInt(x1, 0, iwm)
  y1 = clampInt(y1, 0, ihm)
  x2 = clampInt(x2, 0, iwm)
  y2 = clampInt(y2, 0, ihm)
  if (x2 - x1 < 2) {
    if (x1 + 2 <= iwm) x2 = x1 + 2
    else x1 = Math.max(0, x2 - 2)
  }
  if (y2 - y1 < 2) {
    if (y1 + 2 <= ihm) y2 = y1 + 2
    else y1 = Math.max(0, y2 - 2)
  }
  return { x1, y1, x2, y2 }
}

function imageBboxToPreviewRect(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  imageGeometry: ImageGeometry,
  imageToStage: (point: Point) => Point | null,
): PreviewRect | null {
  const p1 = imageToStage({ x: x1, y: y1 })
  const p2 = imageToStage({ x: x2, y: y2 })
  if (!p1 || !p2) return null
  const left = Math.min(p1.x, p2.x)
  const top = Math.min(p1.y, p2.y)
  const width = Math.abs(p1.x - p2.x)
  const height = Math.abs(p1.y - p2.y)
  const stageW = imageGeometry.stageWidth ?? 0
  const stageH = imageGeometry.stageHeight ?? 0
  const right = left + width
  const bottom = top + height
  const clippedLeft = stageW > 0 ? Math.max(0, left) : left
  const clippedTop = stageH > 0 ? Math.max(0, top) : top
  const clippedRight = stageW > 0 ? Math.min(stageW, right) : right
  const clippedBottom = stageH > 0 ? Math.min(stageH, bottom) : bottom
  return {
    left: clippedLeft,
    top: clippedTop,
    width: Math.max(0, clippedRight - clippedLeft),
    height: Math.max(0, clippedBottom - clippedTop),
    clippedLeft: clippedLeft > left,
    clippedTop: clippedTop > top,
    clippedRight: clippedRight < right,
    clippedBottom: clippedBottom < bottom,
  }
}

function hitPointIndex(points: Sam2ImagePoint[], img: Point, radiusPx: number): number {
  let best = -1
  let bestD = radiusPx * radiusPx
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    if (!p) continue
    const dx = p.x - img.x
    const dy = p.y - img.y
    const d = dx * dx + dy * dy
    if (d <= bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

type Params = {
  sam2AnnotatingActive: boolean
  sam2PromptMode: Sam2PromptMode
  activeImagePath: string
  imageReady: boolean
  imageGeometry: ImageGeometry | null
  imageFitScale: number
  stageRef: StageElementRef
  getCurrentImageGeometry: () => ImageGeometry | null
  stageToImageStrictWithGeometry: (point: Point, geometry: ImageGeometry) => Point | null
  imageToStage: (point: Point) => Point | null
  labelColor: string
  modelIdRef: MutableRefObject<string>
  sessionNonce: number
  shouldSkipEncode: () => boolean
  onEmbeddingsCached: (cache: Sam2EmbedCache) => void
  onEncodeToast: (ok: boolean, message: string) => void
  /** 返回当前 encode 缓存；用于 CVAT/ONNX 解码前检查 */
  getEmbedCache?: () => Sam2EmbedCache | null
  /** 点变化或框确认后触发；由页面层用 ORT 解码并写入标注 */
  onSam2DecodeRequest?: (ctx: Sam2DecodeRequest) => void
  imageNaturalSize: { width: number; height: number }
  sam2Auto: Sam2AutoPromptParams
  /** 传给后端的 encode 相对原图倍率（0.3–1），与缓存键一致 */
  sam2InferScale: number
}

const AUTO_DWELL_BASE_MS = 450

export function useSam2CanvasTool(params: Params) {
  const {
    sam2AnnotatingActive,
    sam2PromptMode,
    activeImagePath,
    imageReady,
    imageGeometry,
    imageFitScale,
    stageRef,
    getCurrentImageGeometry,
    stageToImageStrictWithGeometry,
    imageToStage,
    labelColor,
    modelIdRef,
    sessionNonce,
    shouldSkipEncode,
    onEmbeddingsCached,
    onEncodeToast,
    getEmbedCache,
    onSam2DecodeRequest,
    imageNaturalSize,
    sam2Auto,
    sam2InferScale,
  } = params

  const [points, setPoints] = useState<Sam2ImagePoint[]>([])
  const [rectAnchor, setRectAnchor] = useState<Point | null>(null)
  const [rectHover, setRectHover] = useState<Point | null>(null)
  const [committedBbox, setCommittedBbox] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
  const [autoHoverImage, setAutoHoverImage] = useState<Point | null>(null)
  const encodeInFlightPromiseRef = useRef<Promise<void> | null>(null)
  const activeImagePathRef = useRef(activeImagePath)
  activeImagePathRef.current = activeImagePath

  const dwellClusterRef = useRef<Point | null>(null)
  const dwellClusterStartRef = useRef(0)
  const dwellFiredRef = useRef(false)
  const dwellTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoDecodeFlightRef = useRef(false)
  const sam2PromptModeRef = useRef(sam2PromptMode)
  sam2PromptModeRef.current = sam2PromptMode
  const sam2AutoRef = useRef(sam2Auto)
  sam2AutoRef.current = sam2Auto
  const imageNaturalRef = useRef(imageNaturalSize)
  imageNaturalRef.current = imageNaturalSize
  const sam2InferScaleRef = useRef(sam2InferScale)
  sam2InferScaleRef.current = sam2InferScale

  const clearAutoDwellTimer = useCallback(() => {
    if (dwellTimerRef.current !== null) {
      clearTimeout(dwellTimerRef.current)
      dwellTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      clearAutoDwellTimer()
    }
  }, [clearAutoDwellTimer])

  useEffect(() => {
    setPoints([])
    setRectAnchor(null)
    setRectHover(null)
    setCommittedBbox(null)
    setAutoHoverImage(null)
    dwellClusterRef.current = null
    dwellFiredRef.current = false
    clearAutoDwellTimer()
  }, [activeImagePath, clearAutoDwellTimer, sessionNonce])

  useEffect(() => {
    if (!sam2AnnotatingActive) {
      setPoints([])
      setRectAnchor(null)
      setRectHover(null)
      setCommittedBbox(null)
      setAutoHoverImage(null)
      dwellClusterRef.current = null
      dwellFiredRef.current = false
      clearAutoDwellTimer()
    }
  }, [clearAutoDwellTimer, sam2AnnotatingActive])

  useEffect(() => {
    if (!sam2Auto.enabled) {
      setAutoHoverImage(null)
      dwellClusterRef.current = null
      dwellFiredRef.current = false
      clearAutoDwellTimer()
      return
    }
    setPoints([])
    setRectAnchor(null)
    setRectHover(null)
    setCommittedBbox(null)
  }, [clearAutoDwellTimer, sam2Auto.enabled])

  const hitRadiusImage = useMemo(() => Math.max(6, 10 / Math.max(imageFitScale, 0.001)), [imageFitScale])

  /** 当前图尚无 embeddings 时请求后端；已缓存则立即返回。会等待他人发起的 in-flight 编码结束后再判断是否还需请求（换图中途完成上一张编码）。 */
  const ensureEmbeddingsForActiveImage = useCallback(async (): Promise<void> => {
    for (let i = 0; i < 8; i++) {
      const path = activeImagePathRef.current.trim()
      if (!path || !imageReady || !sam2AnnotatingActive) return
      if (shouldSkipEncode()) return
      const pending = encodeInFlightPromiseRef.current
      if (pending) {
        await pending.catch(() => {})
        continue
      }
      const mid = modelIdRef.current.trim() || "sam2/sam2.1_hiera_tiny"
      const holder: { flight: Promise<void> | null } = { flight: null }
      holder.flight = (async () => {
        const scaleAtStart = sam2InferScaleRef.current
        try {
          const response = await fetchSam2ImageEmbeddings(mid, path, { inferScale: scaleAtStart })
          if (activeImagePathRef.current.trim() !== path) return
          if (sam2InferScaleRef.current !== scaleAtStart) return
          onEmbeddingsCached({ imagePath: path, inferScale: scaleAtStart, response })
          onEncodeToast(true, "SAM2 图像编码完成，已缓存 embeddings")
        } catch (e) {
          if (activeImagePathRef.current.trim() !== path) return
          if (sam2InferScaleRef.current !== scaleAtStart) return
          const msg = e instanceof Error ? e.message : String(e)
          onEncodeToast(false, `SAM2 编码失败：${msg}`)
        } finally {
          if (encodeInFlightPromiseRef.current === holder.flight) {
            encodeInFlightPromiseRef.current = null
          }
        }
      })()
      const flight = holder.flight
      encodeInFlightPromiseRef.current = flight
      await flight
      if (shouldSkipEncode()) return
    }
  }, [imageReady, modelIdRef, onEmbeddingsCached, onEncodeToast, sam2AnnotatingActive, shouldSkipEncode])

  const emitSam2Decode = useCallback(
    (ctx: Sam2DecodeRequest) => {
      if (!onSam2DecodeRequest || !getEmbedCache) return
      const path = ctx.imagePath.trim()
      queueMicrotask(() => {
        const cache = getEmbedCache()
        if (!cache || cache.imagePath !== path) return
        if (cache.inferScale !== sam2InferScaleRef.current) return
        onSam2DecodeRequest(ctx)
      })
    },
    [getEmbedCache, onSam2DecodeRequest],
  )

  const emitSam2DecodeRef = useRef(emitSam2Decode)
  emitSam2DecodeRef.current = emitSam2Decode

  const queueDecode = useCallback(
    (opts: { promptMode: Sam2PromptMode; nextPoints: Sam2ImagePoint[]; bbox: Sam2DecodeRequest["bbox"]; minPredIou?: number }) => {
      emitSam2Decode({
        imagePath: activeImagePath.trim(),
        promptMode: opts.promptMode,
        points: opts.nextPoints,
        bbox: opts.bbox,
        minPredIou: opts.minPredIou,
      })
    },
    [activeImagePath, emitSam2Decode],
  )

  const commitAutoDwellDecodeRef = useRef<() => void>(() => {})

  const commitAutoDwellDecode = useCallback(() => {
    if (dwellFiredRef.current || autoDecodeFlightRef.current) return
    if (!sam2AutoRef.current.enabled) return
    const cluster = dwellClusterRef.current
    if (!cluster) return

    dwellFiredRef.current = true
    autoDecodeFlightRef.current = true
    clearAutoDwellTimer()

    const mode = sam2PromptModeRef.current
    const path = activeImagePathRef.current.trim()
    void (async () => {
      try {
        await ensureEmbeddingsForActiveImage()
        if (activeImagePathRef.current.trim() !== path) return
        const a = sam2AutoRef.current
        const iw2 = imageNaturalRef.current.width
        const ih2 = imageNaturalRef.current.height
        if (iw2 <= 0 || ih2 <= 0) return
        const minIou = a.iouThreshold > 0 ? a.iouThreshold : undefined
        if (mode === "point") {
          const iwm = Math.max(0, iw2 - 1)
          const ihm = Math.max(0, ih2 - 1)
          const px = clampInt(cluster.x, 0, iwm)
          const py = clampInt(cluster.y, 0, ihm)
          const next: Sam2ImagePoint[] = [{ id: "auto-pos", x: px, y: py, label: 1 }]
          emitSam2DecodeRef.current({
            imagePath: path,
            promptMode: "point",
            points: next,
            bbox: null,
            minPredIou: minIou,
          })
        } else {
          const bbox = buildAutoBboxFromCenter(cluster.x, cluster.y, a.objectBoxW, a.objectBoxH, iw2, ih2)
          emitSam2DecodeRef.current({
            imagePath: path,
            promptMode: "bbox",
            points: [],
            bbox,
            minPredIou: minIou,
          })
        }
      } finally {
        autoDecodeFlightRef.current = false
      }
    })()
  }, [clearAutoDwellTimer, ensureEmbeddingsForActiveImage])

  commitAutoDwellDecodeRef.current = commitAutoDwellDecode

  const rescheduleAutoDwellTimer = useCallback(() => {
    clearAutoDwellTimer()
    if (dwellFiredRef.current || autoDecodeFlightRef.current) return
    const cluster = dwellClusterRef.current
    if (!cluster || !sam2AutoRef.current.enabled) return
    const dwellMs = AUTO_DWELL_BASE_MS * sam2AutoRef.current.hoverFactor
    const elapsed = performance.now() - dwellClusterStartRef.current
    const remaining = Math.max(0, dwellMs - elapsed)
    dwellTimerRef.current = setTimeout(() => {
      dwellTimerRef.current = null
      commitAutoDwellDecodeRef.current()
    }, remaining)
  }, [clearAutoDwellTimer])

  const sam2StagePoints = useMemo(() => {
    return points
      .map((p) => {
        const st = imageToStage({ x: p.x, y: p.y })
        if (!st) return null
        return { ...p, stageX: st.x, stageY: st.y }
      })
      .filter((x): x is Sam2ImagePoint & { stageX: number; stageY: number } => x !== null)
  }, [imageToStage, points])

  const sam2PreviewRect = useMemo((): PreviewRect | null => {
    if (!sam2AnnotatingActive || sam2PromptMode !== "bbox" || !imageGeometry || sam2Auto.enabled) return null
    let a: Point
    let b: Point
    if (committedBbox) {
      a = { x: committedBbox.x1, y: committedBbox.y1 }
      b = { x: committedBbox.x2, y: committedBbox.y2 }
    } else if (rectAnchor && rectHover) {
      a = rectAnchor
      b = rectHover
    } else {
      return null
    }
    const p1 = imageToStage(a)
    const p2 = imageToStage(b)
    if (!p1 || !p2) return null
    const left = Math.min(p1.x, p2.x)
    const top = Math.min(p1.y, p2.y)
    const width = Math.abs(p1.x - p2.x)
    const height = Math.abs(p1.y - p2.y)
    const stageW = imageGeometry.stageWidth ?? 0
    const stageH = imageGeometry.stageHeight ?? 0
    const right = left + width
    const bottom = top + height
    const clippedLeft = stageW > 0 ? Math.max(0, left) : left
    const clippedTop = stageH > 0 ? Math.max(0, top) : top
    const clippedRight = stageW > 0 ? Math.min(stageW, right) : right
    const clippedBottom = stageH > 0 ? Math.min(stageH, bottom) : bottom
    return {
      left: clippedLeft,
      top: clippedTop,
      width: Math.max(0, clippedRight - clippedLeft),
      height: Math.max(0, clippedBottom - clippedTop),
      clippedLeft: clippedLeft > left,
      clippedTop: clippedTop > top,
      clippedRight: clippedRight < right,
      clippedBottom: clippedBottom < bottom,
    }
  }, [committedBbox, imageGeometry, imageToStage, rectAnchor, rectHover, sam2AnnotatingActive, sam2Auto.enabled, sam2PromptMode])

  const sam2AutoPreviewRect = useMemo((): PreviewRect | null => {
    if (!sam2AnnotatingActive || !sam2Auto.enabled || sam2PromptMode === "point" || !autoHoverImage || !imageGeometry)
      return null
    const iw = imageNaturalSize.width
    const ih = imageNaturalSize.height
    if (iw <= 0 || ih <= 0) return null
    const box = buildAutoBboxFromCenter(
      autoHoverImage.x,
      autoHoverImage.y,
      sam2Auto.objectBoxW,
      sam2Auto.objectBoxH,
      iw,
      ih,
    )
    return imageBboxToPreviewRect(box.x1, box.y1, box.x2, box.y2, imageGeometry, imageToStage)
  }, [
    autoHoverImage,
    imageGeometry,
    imageNaturalSize.height,
    imageNaturalSize.width,
    imageToStage,
    sam2AnnotatingActive,
    sam2Auto.enabled,
    sam2Auto.objectBoxH,
    sam2Auto.objectBoxW,
    sam2PromptMode,
  ])

  const handleSam2OverlayClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (!sam2AnnotatingActive || !imageReady || event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      if (sam2Auto.enabled) return

      const img = clientToImage(event, stageRef, getCurrentImageGeometry, stageToImageStrictWithGeometry)
      if (!img) return
      const p = roundPointToInt(img)

      if (sam2PromptMode === "point") {
        const wasEmpty = points.length === 0
        void (async () => {
          if (wasEmpty) await ensureEmbeddingsForActiveImage()
          setPoints((prev) => {
            const next: Sam2ImagePoint[] = [...prev, { id: newPointId(), x: p.x, y: p.y, label: 1 }]
            queueDecode({ promptMode: "point", nextPoints: next, bbox: null })
            return next
          })
        })()
        return
      }

      if (!rectAnchor) {
        if (committedBbox) setCommittedBbox(null)
        setRectAnchor(p)
        void ensureEmbeddingsForActiveImage()
        return
      }
      const minX = Math.min(rectAnchor.x, p.x)
      const maxX = Math.max(rectAnchor.x, p.x)
      const minY = Math.min(rectAnchor.y, p.y)
      const maxY = Math.max(rectAnchor.y, p.y)
      if (maxX - minX < 2 || maxY - minY < 2) {
        setRectAnchor(null)
        setRectHover(null)
        return
      }
      const box = { x1: minX, y1: minY, x2: maxX, y2: maxY }
      setCommittedBbox(box)
      setRectAnchor(null)
      setRectHover(null)
      void (async () => {
        await ensureEmbeddingsForActiveImage()
        queueDecode({ promptMode: "bbox", nextPoints: [], bbox: box })
      })()
    },
    [
      committedBbox,
      ensureEmbeddingsForActiveImage,
      getCurrentImageGeometry,
      imageReady,
      points.length,
      queueDecode,
      rectAnchor,
      sam2AnnotatingActive,
      sam2Auto.enabled,
      sam2PromptMode,
      stageRef,
      stageToImageStrictWithGeometry,
    ],
  )

  const handleSam2OverlayContextMenu = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (!sam2AnnotatingActive || !imageReady || sam2PromptMode !== "point") return
      event.preventDefault()
      event.stopPropagation()
      if (sam2Auto.enabled) return

      const img = clientToImage(event, stageRef, getCurrentImageGeometry, stageToImageStrictWithGeometry)
      if (!img) return
      const p = roundPointToInt(img)
      const idx = hitPointIndex(points, p, hitRadiusImage)
      if (idx >= 0) {
        setPoints((prev) => prev.filter((_, i) => i !== idx))
        return
      }
      const wasEmpty = points.length === 0
      void (async () => {
        if (wasEmpty) await ensureEmbeddingsForActiveImage()
        setPoints((prev) => {
          const next: Sam2ImagePoint[] = [...prev, { id: newPointId(), x: p.x, y: p.y, label: 0 }]
          queueDecode({ promptMode: "point", nextPoints: next, bbox: null })
          return next
        })
      })()
    },
    [
      ensureEmbeddingsForActiveImage,
      getCurrentImageGeometry,
      hitRadiusImage,
      imageReady,
      points,
      queueDecode,
      sam2AnnotatingActive,
      sam2Auto.enabled,
      sam2PromptMode,
      stageRef,
      stageToImageStrictWithGeometry,
    ],
  )

  const handleSam2OverlayMouseMove = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (!sam2AnnotatingActive || !imageReady) return
      const img = clientToImage(event, stageRef, getCurrentImageGeometry, stageToImageStrictWithGeometry)

      if (sam2AutoRef.current.enabled) {
        if (!img) {
          clearAutoDwellTimer()
          setAutoHoverImage(null)
          dwellClusterRef.current = null
          dwellFiredRef.current = false
          return
        }
        const iw = imageNaturalRef.current.width
        const ih = imageNaturalRef.current.height
        if (iw <= 0 || ih <= 0) {
          clearAutoDwellTimer()
          return
        }
        const p = roundPointToInt(img)

        const jitter = Math.max(3, Math.min(iw, ih) * 0.004)
        const t = performance.now()

        let c = dwellClusterRef.current
        if (!c) {
          dwellClusterRef.current = p
          dwellClusterStartRef.current = t
          dwellFiredRef.current = false
          c = p
        } else {
          const dist = Math.hypot(p.x - c.x, p.y - c.y)
          if (dist > jitter) {
            dwellClusterRef.current = p
            dwellClusterStartRef.current = t
            dwellFiredRef.current = false
            c = p
          }
        }

        const cluster = dwellClusterRef.current!
        setAutoHoverImage({ x: cluster.x, y: cluster.y })

        rescheduleAutoDwellTimer()
        return
      }

      clearAutoDwellTimer()
      setAutoHoverImage(null)
      dwellClusterRef.current = null
      dwellFiredRef.current = false

      if (sam2PromptMode !== "bbox" || !rectAnchor) return
      if (!img) {
        setRectHover(null)
        return
      }
      setRectHover(roundPointToInt(img))
    },
    [
      clearAutoDwellTimer,
      getCurrentImageGeometry,
      imageReady,
      rectAnchor,
      rescheduleAutoDwellTimer,
      sam2AnnotatingActive,
      sam2PromptMode,
      stageRef,
      stageToImageStrictWithGeometry,
    ],
  )

  const handleSam2OverlayMouseLeave = useCallback(() => {
    if (!sam2AnnotatingActive) return
    clearAutoDwellTimer()
    setAutoHoverImage(null)
    dwellClusterRef.current = null
    dwellFiredRef.current = false
    if (sam2PromptMode === "bbox") setRectHover(null)
  }, [clearAutoDwellTimer, sam2AnnotatingActive, sam2PromptMode])

  const sam2ManualPromptNonEmpty = Boolean(
    points.length > 0 || committedBbox !== null || (sam2PromptMode === "bbox" && rectAnchor !== null),
  )

  const sam2PromptNonEmpty = Boolean(
    sam2ManualPromptNonEmpty || (sam2Auto.enabled && autoHoverImage !== null),
  )

  return {
    sam2OverlayActive: sam2AnnotatingActive && imageReady,
    sam2StagePoints,
    sam2PointColors: { positive: labelColor, negative: "#ffffff" },
    sam2PreviewRect,
    sam2AutoPreviewRect,
    sam2ManualPromptNonEmpty,
    sam2PromptNonEmpty,
    handleSam2OverlayClick,
    handleSam2OverlayContextMenu,
    handleSam2OverlayMouseMove,
    handleSam2OverlayMouseLeave,
  }
}
