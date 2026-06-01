/**
 * 扩散式标注：在浏览器端对 DINOv2 patch 特征做相似搜索（后端仅提供特征张量）。
 */
import { buildSeedDinoPrototype } from "@/lib/diffusion-dino-embedding"
import type { Dinov2LetterboxMeta, Dinov2PatchFeaturesResponse } from "@/lib/dinov2-patch-features-api"

export type DiffusionSimilarityCandidate = {
  bbox: [number, number, number, number]
  score: number
  peak_x: number
  peak_y: number
}

/** DINO 相似峰 → 候选 bbox 的生成方式 */
export type DiffusionCandidateBoxStrategy = "peak_score_extent" | "peak_fixed_seed" | "score_connected"

export type DiffusionSimilaritySearchOptions = {
  seedBbox: [number, number, number, number]
  seedMask?: { maskBinary: Uint8Array; w: number; h: number }
  similarityThreshold?: number
  maxInstances?: number
  nmsIou?: number
  minPeakDistance?: number
  boxStrategy?: DiffusionCandidateBoxStrategy
}

function bboxIou(a: [number, number, number, number], b: [number, number, number, number]): number {
  const ix1 = Math.max(a[0], b[0])
  const iy1 = Math.max(a[1], b[1])
  const ix2 = Math.min(a[2], b[2])
  const iy2 = Math.min(a[3], b[3])
  const iw = Math.max(0, ix2 - ix1)
  const ih = Math.max(0, iy2 - iy1)
  const inter = iw * ih
  if (inter <= 0) return 0
  const areaA = Math.max(0, a[2] - a[0]) * Math.max(0, a[3] - a[1])
  const areaB = Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1])
  const union = areaA + areaB - inter
  return union > 0 ? inter / union : 0
}

function nmsBoxes(
  boxes: [number, number, number, number][],
  scores: number[],
  iouThr: number,
): number[] {
  const order = scores.map((_, i) => i).sort((a, b) => scores[b]! - scores[a]!)
  const keep: number[] = []
  for (const i of order) {
    if (keep.some((j) => bboxIou(boxes[i]!, boxes[j]!) >= iouThr)) continue
    keep.push(i)
  }
  return keep
}

function patchIndexFromFullXY(
  x: number,
  y: number,
  meta: Dinov2LetterboxMeta,
  gh: number,
  gw: number,
): { gy: number; gx: number } | null {
  const lx = x * meta.scale + meta.pad_x
  const ly = y * meta.scale + meta.pad_y
  if (lx < 0 || ly < 0 || lx >= meta.img_size || ly >= meta.img_size) return null
  const patch = meta.img_size / Math.max(gh, 1)
  const gx = Math.min(gw - 1, Math.max(0, Math.floor(lx / patch)))
  const gy = Math.min(gh - 1, Math.max(0, Math.floor(ly / patch)))
  return { gy, gx }
}

function isLocalPeak(scores: Float32Array, gh: number, gw: number, gy: number, gx: number): boolean {
  const center = scores[gy * gw + gx]!
  for (let yy = Math.max(0, gy - 1); yy <= Math.min(gh - 1, gy + 1); yy += 1) {
    for (let xx = Math.max(0, gx - 1); xx <= Math.min(gw - 1, gx + 1); xx += 1) {
      if (yy === gy && xx === gx) continue
      if (scores[yy * gw + xx]! > center) return false
    }
  }
  return true
}

/** 从峰值邻域高分 patch 连通块估计 bbox（不按种子尺寸强制缩放）。 */
function boxFromPeakScoreExtent(
  scores: Float32Array,
  gh: number,
  gw: number,
  peakGy: number,
  peakGx: number,
  peakScore: number,
  similarityThreshold: number,
  patchPx: number,
  meta: Dinov2LetterboxMeta,
  ow: number,
  oh: number,
  seedW: number,
  seedH: number,
): [number, number, number, number] | null {
  const idx0 = peakGy * gw + peakGx
  if (idx0 < 0 || idx0 >= scores.length) return null
  const connThr = Math.max(similarityThreshold, peakScore * 0.88)
  const visited = new Uint8Array(gh * gw)
  const q: number[] = [idx0]
  visited[idx0] = 1
  let qHead = 0
  let minGx = peakGx
  let maxGx = peakGx
  let minGy = peakGy
  let maxGy = peakGy
  let region = 0
  const maxRegion = Math.max(9, Math.floor(gh * gw * 0.12))
  const maxRadius = Math.max(3, Math.ceil((Math.max(seedW, seedH) * meta.scale) / patchPx * 2.5))

  while (qHead < q.length) {
    const idx = q[qHead++]!
    const gy = Math.floor(idx / gw)
    const gx = idx % gw
    const score = scores[idx]!
    if (score < connThr) continue
    if (Math.abs(gy - peakGy) > maxRadius || Math.abs(gx - peakGx) > maxRadius) continue
    region += 1
    if (region > maxRegion) break
    if (gx < minGx) minGx = gx
    if (gx > maxGx) maxGx = gx
    if (gy < minGy) minGy = gy
    if (gy > maxGy) maxGy = gy

    for (let yy = Math.max(0, gy - 1); yy <= Math.min(gh - 1, gy + 1); yy += 1) {
      for (let xx = Math.max(0, gx - 1); xx <= Math.min(gw - 1, gx + 1); xx += 1) {
        const nIdx = yy * gw + xx
        if (visited[nIdx]) continue
        visited[nIdx] = 1
        q.push(nIdx)
      }
    }
  }

  if (region <= 0) return null
  const patchPad = 0.15
  const lx1 = (minGx - patchPad) * patchPx
  const ly1 = (minGy - patchPad) * patchPx
  const lx2 = (maxGx + 1 + patchPad) * patchPx
  const ly2 = (maxGy + 1 + patchPad) * patchPx
  let x1 = (lx1 - meta.pad_x) / meta.scale
  let y1 = (ly1 - meta.pad_y) / meta.scale
  let x2 = (lx2 - meta.pad_x) / meta.scale
  let y2 = (ly2 - meta.pad_y) / meta.scale

  x1 = Math.max(0, Math.min(ow - 1, x1))
  y1 = Math.max(0, Math.min(oh - 1, y1))
  x2 = Math.max(0, Math.min(ow - 1, x2))
  y2 = Math.max(0, Math.min(oh - 1, y2))
  if (x2 < x1) [x1, x2] = [x2, x1]
  if (y2 < y1) [y1, y2] = [y2, y1]
  if (x2 - x1 < 4) {
    const cx = (x1 + x2) * 0.5
    x1 = Math.max(0, cx - 2)
    x2 = Math.min(ow - 1, cx + 2)
  }
  if (y2 - y1 < 4) {
    const cy = (y1 + y2) * 0.5
    y1 = Math.max(0, cy - 2)
    y2 = Math.min(oh - 1, cy + 2)
  }
  return [x1, y1, x2, y2]
}

function patchUnionToImageBbox(
  minGx: number,
  maxGx: number,
  minGy: number,
  maxGy: number,
  patchPx: number,
  meta: Dinov2LetterboxMeta,
  ow: number,
  oh: number,
  padPatches: number,
): [number, number, number, number] {
  const lx1 = (minGx - padPatches) * patchPx
  const ly1 = (minGy - padPatches) * patchPx
  const lx2 = (maxGx + 1 + padPatches) * patchPx
  const ly2 = (maxGy + 1 + padPatches) * patchPx
  let x1 = (lx1 - meta.pad_x) / meta.scale
  let y1 = (ly1 - meta.pad_y) / meta.scale
  let x2 = (lx2 - meta.pad_x) / meta.scale
  let y2 = (ly2 - meta.pad_y) / meta.scale
  x1 = Math.max(0, Math.min(ow - 1, x1))
  y1 = Math.max(0, Math.min(oh - 1, y1))
  x2 = Math.max(0, Math.min(ow - 1, x2))
  y2 = Math.max(0, Math.min(oh - 1, y2))
  if (x2 < x1) [x1, x2] = [x2, x1]
  if (y2 < y1) [y1, y2] = [y2, y1]
  return [x1, y1, x2, y2]
}

/** 全图 score≥阈值 的 4-连通域，每域一个 bbox（利于合并同一物体上的多个峰）。 */
function boxesFromScoreConnectedComponents(
  scores: Float32Array,
  gh: number,
  gw: number,
  similarityThreshold: number,
  patchPx: number,
  meta: Dinov2LetterboxMeta,
  ow: number,
  oh: number,
  maxComponents: number,
): { boxes: [number, number, number, number][]; scores: number[]; peakXy: [number, number][] } {
  const visited = new Uint8Array(gh * gw)
  const components: { minGx: number; maxGx: number; minGy: number; maxGy: number; maxScore: number }[] = []

  for (let gy = 0; gy < gh; gy += 1) {
    for (let gx = 0; gx < gw; gx += 1) {
      const idx = gy * gw + gx
      if (visited[idx] || scores[idx]! < similarityThreshold) continue
      let minGx = gx
      let maxGx = gx
      let minGy = gy
      let maxGy = gy
      let maxScore = scores[idx]!
      const q: number[] = [idx]
      visited[idx] = 1
      let qHead = 0
      while (qHead < q.length) {
        const cur = q[qHead++]!
        const cy = Math.floor(cur / gw)
        const cx = cur % gw
        const s = scores[cur]!
        if (s > maxScore) maxScore = s
        if (cx < minGx) minGx = cx
        if (cx > maxGx) maxGx = cx
        if (cy < minGy) minGy = cy
        if (cy > maxGy) maxGy = cy
        for (let yy = Math.max(0, cy - 1); yy <= Math.min(gh - 1, cy + 1); yy += 1) {
          for (let xx = Math.max(0, cx - 1); xx <= Math.min(gw - 1, cx + 1); xx += 1) {
            const nIdx = yy * gw + xx
            if (visited[nIdx] || scores[nIdx]! < similarityThreshold) continue
            visited[nIdx] = 1
            q.push(nIdx)
          }
        }
      }
      components.push({ minGx, maxGx, minGy, maxGy, maxScore })
    }
  }

  components.sort((a, b) => b.maxScore - a.maxScore)
  const boxes: [number, number, number, number][] = []
  const peakScores: number[] = []
  const peakXy: [number, number][] = []
  for (const c of components.slice(0, maxComponents * 3)) {
    const b = patchUnionToImageBbox(c.minGx, c.maxGx, c.minGy, c.maxGy, patchPx, meta, ow, oh, 0.15)
    const w = b[2] - b[0]
    const h = b[3] - b[1]
    if (w < 3 || h < 3) continue
    const cx = (b[0] + b[2]) * 0.5
    const cy = (b[1] + b[3]) * 0.5
    boxes.push(b)
    peakScores.push(c.maxScore)
    peakXy.push([cx, cy])
  }
  return { boxes, scores: peakScores, peakXy }
}

/** 合并中心过近且 IoU 偏高的框，缓解同一物体多个峰。 */
function mergeOverlappingCandidateBoxes(
  boxes: [number, number, number, number][],
  scores: number[],
  peakXy: [number, number][],
): { boxes: [number, number, number, number][]; scores: number[]; peakXy: [number, number][] } {
  const order = scores.map((_, i) => i).sort((a, b) => scores[b]! - scores[a]!)
  const keep: number[] = []
  for (const i of order) {
    const bi = boxes[i]!
    const [cxi, cyi] = peakXy[i]!
    const wi = bi[2] - bi[0]
    const hi = bi[3] - bi[1]
    const dup = keep.some((j) => {
      const bj = boxes[j]!
      const [cxj, cyj] = peakXy[j]!
      const wj = bj[2] - bj[0]
      const hj = bj[3] - bj[1]
      const dist = Math.hypot(cxi - cxj, cyi - cyj)
      const minSpan = Math.min(Math.max(wi, hi), Math.max(wj, hj))
      if (dist > minSpan * 0.55) return false
      return bboxIou(bi, bj) >= 0.2
    })
    if (!dup) keep.push(i)
  }
  return {
    boxes: keep.map((i) => boxes[i]!),
    scores: keep.map((i) => scores[i]!),
    peakXy: keep.map((i) => peakXy[i]!),
  }
}

function collectSimilarityPeaks(
  scores: Float32Array,
  gh: number,
  gw: number,
  similarityThreshold: number,
  minDistPatches: number,
  maxPeaks: number,
): { gy: number; gx: number; score: number }[] {
  const localPeakIdxs: number[] = []
  for (let gy = 0; gy < gh; gy += 1) {
    for (let gx = 0; gx < gw; gx += 1) {
      const idx = gy * gw + gx
      if (scores[idx]! < similarityThreshold) continue
      if (!isLocalPeak(scores, gh, gw, gy, gx)) continue
      localPeakIdxs.push(idx)
    }
  }
  const order = localPeakIdxs.sort((a, b) => scores[b]! - scores[a]!)
  const peaks: { gy: number; gx: number; score: number }[] = []
  for (const idx of order) {
    const score = scores[idx]!
    if (score < similarityThreshold) break
    const gy = Math.floor(idx / gw)
    const gx = idx % gw
    if (peaks.some((p) => (gy - p.gy) ** 2 + (gx - p.gx) ** 2 < minDistPatches ** 2)) continue
    peaks.push({ gy, gx, score })
    if (peaks.length >= maxPeaks) break
  }
  return peaks
}

/** 在已解码的 patch 特征上做全图相似搜索，返回候选 bbox 列表。 */
export function searchSimilarFromPatchFeatures(
  features: Dinov2PatchFeaturesResponse,
  options: DiffusionSimilaritySearchOptions,
): DiffusionSimilarityCandidate[] {
  const { proto, gridPack } = buildSeedDinoPrototype(features, {
    seedBbox: options.seedBbox,
    seedMask: options.seedMask,
  })
  const { grid, meta, gh, gw, dim } = gridPack

  const ow = meta.orig_w
  const oh = meta.orig_h
  let [x1, y1, x2, y2] = options.seedBbox
  x1 = Math.max(0, Math.min(x1, ow - 1))
  y1 = Math.max(0, Math.min(y1, oh - 1))
  x2 = Math.max(0, Math.min(x2, ow - 1))
  y2 = Math.max(0, Math.min(y2, oh - 1))
  if (x2 < x1) {
    const t = x1
    x1 = x2
    x2 = t
  }
  if (y2 < y1) {
    const t = y1
    y1 = y2
    y2 = t
  }

  const scores = new Float32Array(gh * gw)
  for (let gy = 0; gy < gh; gy += 1) {
    for (let gx = 0; gx < gw; gx += 1) {
      let dot = 0
      let vNorm = 0
      const base = (gy * gw + gx) * dim
      for (let d = 0; d < dim; d += 1) {
        const v = grid[base + d]!
        dot += v * proto[d]!
        vNorm += v * v
      }
      scores[gy * gw + gx] = vNorm > 1e-8 ? dot / Math.sqrt(vNorm) : 0
    }
  }

  const seedHit = patchIndexFromFullXY((x1 + x2) * 0.5, (y1 + y2) * 0.5, meta, gh, gw)
  if (seedHit) {
    // Suppress a small neighborhood around the seed center to reduce "self-hit" duplicates.
    for (let yy = Math.max(0, seedHit.gy - 1); yy <= Math.min(gh - 1, seedHit.gy + 1); yy += 1) {
      for (let xx = Math.max(0, seedHit.gx - 1); xx <= Math.min(gw - 1, seedHit.gx + 1); xx += 1) {
        scores[yy * gw + xx] = -1
      }
    }
  }

  const similarityThreshold = Math.max(0, Math.min(1, options.similarityThreshold ?? 0.45))
  const maxInstances = Math.max(1, Math.min(32, options.maxInstances ?? 32))
  const nmsIou = options.nmsIou ?? 0.5
  const minPeakDistance = options.minPeakDistance ?? 0.35

  const bw = Math.max(4, x2 - x1)
  const bh = Math.max(4, y2 - y1)
  const patchPx = meta.img_size / Math.max(gh, 1)
  const minDistPatches = Math.max(1, (minPeakDistance * Math.max(bw, bh)) / patchPx * meta.scale)
  const boxStrategy = options.boxStrategy ?? "peak_score_extent"

  let boxes: [number, number, number, number][] = []
  let peakScores: number[] = []
  let peakXy: [number, number][] = []

  if (boxStrategy === "score_connected") {
    const cc = boxesFromScoreConnectedComponents(
      scores,
      gh,
      gw,
      similarityThreshold,
      patchPx,
      meta,
      ow,
      oh,
      maxInstances,
    )
    boxes = cc.boxes
    peakScores = cc.scores
    peakXy = cc.peakXy
  } else {
    const peaks = collectSimilarityPeaks(scores, gh, gw, similarityThreshold, minDistPatches, maxInstances * 3)
    const halfW = bw * 0.5
    const halfH = bh * 0.5
    const useFixedSeed = boxStrategy === "peak_fixed_seed"

    for (const { gy, gx, score } of peaks) {
      const cxL = (gx + 0.5) * patchPx
      const cyL = (gy + 0.5) * patchPx
      const cx = (cxL - meta.pad_x) / meta.scale
      const cy = (cyL - meta.pad_y) / meta.scale
      let b: [number, number, number, number]
      if (useFixedSeed) {
        b = [
          Math.max(0, cx - halfW),
          Math.max(0, cy - halfH),
          Math.min(ow - 1, cx + halfW),
          Math.min(oh - 1, cy + halfH),
        ]
      } else {
        b =
          boxFromPeakScoreExtent(
            scores,
            gh,
            gw,
            gy,
            gx,
            score,
            similarityThreshold,
            patchPx,
            meta,
            ow,
            oh,
            bw,
            bh,
          ) ?? [
            Math.max(0, cx - halfW),
            Math.max(0, cy - halfH),
            Math.min(ow - 1, cx + halfW),
            Math.min(oh - 1, cy + halfH),
          ]
      }
      boxes.push(b)
      peakScores.push(score)
      peakXy.push([cx, cy])
    }
    const merged = mergeOverlappingCandidateBoxes(boxes, peakScores, peakXy)
    boxes = merged.boxes
    peakScores = merged.scores
    peakXy = merged.peakXy
  }

  const keep = nmsBoxes(boxes, peakScores, nmsIou).slice(0, maxInstances)
  return keep.map((i) => {
    const b = boxes[i]!
    const [px, py] = peakXy[i]!
    return {
      bbox: [Math.round(b[0] * 100) / 100, Math.round(b[1] * 100) / 100, Math.round(b[2] * 100) / 100, Math.round(b[3] * 100) / 100] as [
        number,
        number,
        number,
        number,
      ],
      score: Math.round(peakScores[i]! * 10000) / 10000,
      peak_x: Math.round(px * 100) / 100,
      peak_y: Math.round(py * 100) / 100,
    }
  })
}
