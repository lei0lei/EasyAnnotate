/**
 * 模块：project-task-detail/use-task-bootstrap
 * 职责：处理页面初始化与切图加载（文件拉取、图片加载、临时态重置）。
 * 边界：负责首屏与切换流程，不负责绘制交互细节。
 */
import { useCallback, useEffect, useRef } from "react"
import type { Dispatch, MutableRefObject, SetStateAction } from "react"
import { getProject, listTaskFiles, readImageFile, type ProjectItem, type TaskFileItem } from "@/lib/projects-api"
import { guessMimeType } from "@/pages/project-task-detail/utils"

type ToolResetAction = { type: "clearRectPoints" } | { type: "resetForNewFile" }
const TASK_FILES_BATCH_SIZE = 10
let globalImageLoadChain: Promise<void> = Promise.resolve()
let globalImageLoadRequestId = 0
let globalImageLoadInFlight = false

type LoadImageFromCandidatesParams = {
  imagePathCandidates: string[]
  isCanceled: () => boolean
  setIsImageLoading: Dispatch<SetStateAction<boolean>>
  setImageLoadingHint: Dispatch<SetStateAction<string>>
  setImageLoadError: Dispatch<SetStateAction<boolean>>
  setImageObjectUrl: Dispatch<SetStateAction<string>>
  setActiveImagePath: Dispatch<SetStateAction<string>>
}

async function loadImageFromCandidates(params: LoadImageFromCandidatesParams): Promise<{
  objectUrl: string
  loaded: boolean
}> {
  const {
    imagePathCandidates,
    isCanceled,
    setIsImageLoading,
    setImageLoadingHint,
    setImageLoadError,
    setImageObjectUrl,
    setActiveImagePath,
  } = params
  let objectUrl = ""
  let lastReadError = ""
  if (isCanceled()) return { objectUrl, loaded: false }
  if (imagePathCandidates.length === 0) {
    setIsImageLoading(false)
    setImageLoadingHint("未找到可读取的图片路径")
    setImageObjectUrl("")
    setActiveImagePath("")
    setImageLoadError(true)
    return { objectUrl, loaded: false }
  }
  setIsImageLoading(true)
  setImageLoadingHint(`准备读取图片候选路径（${imagePathCandidates.length}）...`)
  setImageLoadError(false)
  setImageObjectUrl("")

  for (const [index, candidate] of imagePathCandidates.entries()) {
    if (isCanceled()) return { objectUrl, loaded: false }
    setImageLoadingHint(`正在读取候选 ${index + 1}/${imagePathCandidates.length}：${candidate}`)
    const result = await readImageFile(candidate)
    if (isCanceled()) return { objectUrl, loaded: false }
    if (result.errorMessage) {
      lastReadError = result.errorMessage
      continue
    }
    if (!result.content || result.content.length === 0) continue
    const bytes = result.content
    setImageLoadingHint("已读取字节，正在创建对象 URL...")
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    objectUrl = URL.createObjectURL(new Blob([buffer], { type: guessMimeType(candidate) }))
    setImageLoadingHint("对象 URL 已创建，等待浏览器解码...")
    setImageObjectUrl(objectUrl)
    setActiveImagePath(candidate)
    return { objectUrl, loaded: true }
  }

  if (isCanceled()) return { objectUrl, loaded: false }
  setIsImageLoading(false)
  setImageLoadingHint(lastReadError ? `所有候选路径读取失败：${lastReadError}` : "所有候选路径读取失败")
  setImageLoadError(true)
  setActiveImagePath("")
  return { objectUrl, loaded: false }
}

type UseTaskBootstrapParams = {
  projectId?: string
  taskId?: string
  currentIndex: number
  files: TaskFileItem[]
  imagePathCandidates: string[]
  currentFilePath: string
  stageRef: MutableRefObject<HTMLDivElement | null>
  panStartRef: MutableRefObject<{ x: number; y: number; originX: number; originY: number } | null>
  clearToolTransientInteractions: () => void
  dispatchTool: (action: ToolResetAction) => void
  setProject: Dispatch<SetStateAction<ProjectItem | undefined>>
  setError: Dispatch<SetStateAction<string | null>>
  setFiles: Dispatch<SetStateAction<TaskFileItem[]>>
  setCurrentIndex: Dispatch<SetStateAction<number>>
  setImageObjectUrl: Dispatch<SetStateAction<string>>
  setActiveImagePath: Dispatch<SetStateAction<string>>
  setIsImageLoading: Dispatch<SetStateAction<boolean>>
  setImageLoadingHint: Dispatch<SetStateAction<string>>
  setImageLoadError: Dispatch<SetStateAction<boolean>>
  setImageScale: Dispatch<SetStateAction<number>>
  setImageOffset: Dispatch<SetStateAction<{ x: number; y: number }>>
  setIsPanning: Dispatch<SetStateAction<boolean>>
  setImageNaturalSize: Dispatch<SetStateAction<{ width: number; height: number }>>
  setSelectedShapeIndex: Dispatch<SetStateAction<number | null>>
  resetDocForNewFile: () => void
  setHiddenShapeIndexes: Dispatch<SetStateAction<number[]>>
  setHiddenClassLabels: Dispatch<SetStateAction<string[]>>
  setLabelsTab: Dispatch<SetStateAction<"layers" | "classes">>
  setStageSize: Dispatch<SetStateAction<{ width: number; height: number }>>
}

export function useTaskBootstrap(params: UseTaskBootstrapParams) {
  const {
    projectId,
    taskId,
    currentIndex,
    files,
    imagePathCandidates,
    currentFilePath,
    stageRef,
    panStartRef,
    clearToolTransientInteractions,
    dispatchTool,
    setProject,
    setError,
    setFiles,
    setCurrentIndex,
    setImageObjectUrl,
    setActiveImagePath,
    setIsImageLoading,
    setImageLoadingHint,
    setImageLoadError,
    setImageScale,
    setImageOffset,
    setIsPanning,
    setImageNaturalSize,
    setSelectedShapeIndex,
    resetDocForNewFile,
    setHiddenShapeIndexes,
    setHiddenClassLabels,
    setLabelsTab,
    setStageSize,
  } = params
  const dispatchToolRef = useRef(dispatchTool)
  const resetDocForNewFileRef = useRef(resetDocForNewFile)
  const clearToolTransientInteractionsRef = useRef(clearToolTransientInteractions)
  const lastResetFilePathRef = useRef<string | null>(null)
  const nextPageOffsetRef = useRef(0)
  const hasMoreTaskFilesRef = useRef(false)
  const taskFilesPageLoadingRef = useRef(false)
  const taskFilesPageTokenRef = useRef(0)
  const loadedFilesCountRef = useRef(0)

  useEffect(() => {
    dispatchToolRef.current = dispatchTool
  }, [dispatchTool])

  useEffect(() => {
    resetDocForNewFileRef.current = resetDocForNewFile
  }, [resetDocForNewFile])

  useEffect(() => {
    clearToolTransientInteractionsRef.current = clearToolTransientInteractions
  }, [clearToolTransientInteractions])

  const clearFilesPaginationState = useCallback(() => {
    taskFilesPageTokenRef.current += 1
    nextPageOffsetRef.current = 0
    hasMoreTaskFilesRef.current = false
    taskFilesPageLoadingRef.current = false
    loadedFilesCountRef.current = 0
  }, [])

  const loadTaskFilesPage = useCallback(
    async (reset: boolean): Promise<number> => {
      if (!projectId || !taskId) return loadedFilesCountRef.current
      if (taskFilesPageLoadingRef.current) return loadedFilesCountRef.current
      taskFilesPageLoadingRef.current = true
      try {
        const token = taskFilesPageTokenRef.current
        const offset = reset ? 0 : nextPageOffsetRef.current
        const result = await listTaskFiles({
          projectId,
          taskId,
          offset,
          limit: TASK_FILES_BATCH_SIZE,
        })
        if (token !== taskFilesPageTokenRef.current) {
          return loadedFilesCountRef.current
        }
        if (result.errorMessage) {
          if (reset) {
            setFiles([])
            loadedFilesCountRef.current = 0
          }
          hasMoreTaskFilesRef.current = false
          setError(result.errorMessage)
          setImageLoadingHint(`任务文件读取失败：${result.errorMessage}`)
          return loadedFilesCountRef.current
        }
        setError(null)
        const incoming = result.files
        hasMoreTaskFilesRef.current = result.hasMore
        if (reset) {
          nextPageOffsetRef.current = incoming.length
          loadedFilesCountRef.current = incoming.length
          setFiles(incoming)
          if (incoming.length === 0) {
            setImageLoadingHint("任务内暂无图片")
          } else if (result.hasMore) {
            setImageLoadingHint(`任务文件已分页加载 ${incoming.length} 项，翻到末尾继续加载`)
          } else {
            setImageLoadingHint(`任务文件已加载 ${incoming.length} 项，准备读取图片`)
          }
          return loadedFilesCountRef.current
        }
        let mergedCount = loadedFilesCountRef.current
        setFiles((prev) => {
          const merged = [...prev]
          const seen = new Set(prev.map((item) => item.filePath))
          for (const item of incoming) {
            if (seen.has(item.filePath)) continue
            seen.add(item.filePath)
            merged.push(item)
          }
          mergedCount = merged.length
          nextPageOffsetRef.current = merged.length
          const hint = result.hasMore
            ? `任务文件分页加载：已加载 ${merged.length} 项，翻到末尾继续加载`
            : `任务文件分页加载完成：共 ${merged.length} 项`
          setImageLoadingHint(hint)
          return merged
        })
        loadedFilesCountRef.current = mergedCount
        return mergedCount
      } finally {
        taskFilesPageLoadingRef.current = false
      }
    },
    [projectId, setError, setFiles, setImageLoadingHint, taskId],
  )

  const ensureFilesLoadedThroughIndex = useCallback(
    async (targetIndex: number): Promise<number> => {
      if (!projectId || !taskId) return 0
      const safeTarget = Math.max(0, Math.floor(targetIndex))
      let guard = 0
      const maxPages = Math.max(1, Math.ceil((safeTarget + 1) / TASK_FILES_BATCH_SIZE)) + 2
      while (loadedFilesCountRef.current <= safeTarget && hasMoreTaskFilesRef.current && guard < maxPages) {
        guard += 1
        await loadTaskFilesPage(false)
      }
      return Math.max(0, Math.min(safeTarget, loadedFilesCountRef.current - 1))
    },
    [loadTaskFilesPage, projectId, taskId],
  )

  const maybeLoadNextFilesBatch = useCallback(() => {
    if (taskFilesPageLoadingRef.current) return
    if (!hasMoreTaskFilesRef.current) return
    if (files.length === 0) return
    if (currentIndex < files.length - 1) return
    void loadTaskFilesPage(false)
  }, [currentIndex, files.length, loadTaskFilesPage])

  const resetAndLoadFirstTaskFilesPage = useCallback(async () => {
    clearFilesPaginationState()
    setFiles([])
    setImageLoadingHint("正在读取任务文件列表...")
    await loadTaskFilesPage(true)
  }, [clearFilesPaginationState, loadTaskFilesPage, setFiles, setImageLoadingHint])

  const reloadTaskFiles = useCallback(async () => {
    if (!projectId || !taskId) return
    await resetAndLoadFirstTaskFilesPage()
  }, [projectId, resetAndLoadFirstTaskFilesPage, taskId])

  useEffect(() => {
    let alive = true
    if (!projectId) return
    void getProject(projectId).then((item) => {
      if (!alive) return
      setProject(item)
    })
    return () => {
      alive = false
    }
  }, [projectId, setProject])

  useEffect(() => {
    if (!projectId || !taskId) return
    void resetAndLoadFirstTaskFilesPage()
    return () => {
      clearFilesPaginationState()
    }
  }, [clearFilesPaginationState, projectId, resetAndLoadFirstTaskFilesPage, taskId])

  useEffect(() => {
    setCurrentIndex((index) => {
      if (files.length === 0) return 0
      return Math.min(index, files.length - 1)
    })
  }, [files, setCurrentIndex])

  useEffect(() => {
    maybeLoadNextFilesBatch()
  }, [currentIndex, maybeLoadNextFilesBatch])

  const handleImageDecodeError = useCallback(() => {
    // 仍由 bootstrap 的顺序候选读取承担主要回退策略；这里保留接口兼容。
    setImageLoadingHint("浏览器解码失败（<img onError>）")
  }, [setImageLoadingHint])

  useEffect(() => {
    let alive = true
    let objectUrl = ""
    const requestId = ++globalImageLoadRequestId

    const loadImage = async () => {
      if (globalImageLoadInFlight) {
        setImageLoadingHint("前序图片仍在加载，当前请求排队中...")
      }
      const isCanceled = () => !alive || requestId !== globalImageLoadRequestId
      const result = await loadImageFromCandidates({
        imagePathCandidates,
        isCanceled,
        setIsImageLoading,
        setImageLoadingHint,
        setImageLoadError,
        setImageObjectUrl,
        setActiveImagePath,
      })
      if (result.loaded) {
        objectUrl = result.objectUrl
      }
    }

    globalImageLoadChain = globalImageLoadChain
      .catch(() => {})
      .then(async () => {
        if (!alive || requestId !== globalImageLoadRequestId) return
        globalImageLoadInFlight = true
        try {
          await loadImage()
        } finally {
          globalImageLoadInFlight = false
        }
      })
    void globalImageLoadChain

    return () => {
      alive = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [
    imagePathCandidates,
    setActiveImagePath,
    setImageLoadError,
    setImageLoadingHint,
    setImageObjectUrl,
    setIsImageLoading,
  ])

  useEffect(() => {
    if (lastResetFilePathRef.current === currentFilePath) return
    lastResetFilePathRef.current = currentFilePath
    setImageScale(1)
    setImageOffset({ x: 0, y: 0 })
    setIsPanning(false)
    panStartRef.current = null
    setImageNaturalSize({ width: 0, height: 0 })
    dispatchToolRef.current({ type: "clearRectPoints" })
    setSelectedShapeIndex(null)
    dispatchToolRef.current({ type: "resetForNewFile" })
    resetDocForNewFileRef.current()
    clearToolTransientInteractionsRef.current()
    setHiddenShapeIndexes([])
    setHiddenClassLabels([])
    setLabelsTab("layers")
  }, [currentFilePath, panStartRef, setHiddenClassLabels, setHiddenShapeIndexes, setImageNaturalSize, setImageOffset, setImageScale, setIsPanning, setLabelsTab, setSelectedShapeIndex])

  useEffect(() => {
    return () => {
      clearFilesPaginationState()
    }
  }, [clearFilesPaginationState])

  useEffect(() => {
    let observer: ResizeObserver | null = null
    let rafId = 0
    let disposed = false

    const update = () => {
      const target = stageRef.current
      if (!target) return
      const rect = target.getBoundingClientRect()
      setStageSize({ width: rect.width, height: rect.height })
    }

    const attachObserver = () => {
      if (disposed) return
      const target = stageRef.current
      if (!target) {
        rafId = window.requestAnimationFrame(attachObserver)
        return
      }
      update()
      observer = new ResizeObserver(update)
      observer.observe(target)
      window.addEventListener("resize", update)
    }

    attachObserver()

    return () => {
      disposed = true
      if (rafId) window.cancelAnimationFrame(rafId)
      observer?.disconnect()
      window.removeEventListener("resize", update)
    }
  }, [setStageSize, stageRef, currentFilePath])

  return { reloadTaskFiles, handleImageDecodeError, ensureFilesLoadedThroughIndex }
}
