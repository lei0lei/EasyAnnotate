/**
 * SAM2.1 hashJoe/CVAT：浏览器端 onnxruntime-web 跑与 export_sam21_cvat_decoder 一致的 decoder.onnx。
 */
import {
  decoderOnnxUrlForAsset,
  type Sam2EncodeImageResponse,
  type Sam2TensorPayload,
} from "@/lib/sam2-encode-api"
import { encodeBinaryToRowMajorRle, maskBinaryHasForeground } from "@/lib/mask-raster-rle"

type OrtModule = typeof import("onnxruntime-web")

let ortPromise: Promise<OrtModule> | null = null

async function getOrt(): Promise<OrtModule> {
  if (!ortPromise) {
    ortPromise = import("onnxruntime-web").then((ort) => {
      if (!ort.env.wasm.wasmPaths) {
        ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.2/dist/"
      }
      return ort
    })
  }
  return ortPromise
}

const sessionByModelId = new Map<string, Promise<import("onnxruntime-web").InferenceSession>>()

/** WASM EP 上同一 session 并发 `run()` 会抛 “session already started”；所有解码串行排队。 */
const decoderRunTailByModelId = new Map<string, Promise<unknown>>()

export function clearSam2DecoderSessions(): void {
  sessionByModelId.clear()
  decoderRunTailByModelId.clear()
}

function enqueueSam2DecoderRun<T>(modelId: string, work: () => Promise<T>): Promise<T> {
  const prev = decoderRunTailByModelId.get(modelId) ?? Promise.resolve()
  const current = prev.then(work)
  decoderRunTailByModelId.set(
    modelId,
    current.then(
      () => undefined,
      () => undefined,
    ),
  )
  return current
}

function numElements(shape: readonly number[]): number {
  let n = 1
  for (const d of shape) n *= Math.max(1, Math.floor(Number(d)))
  return n
}

function decodeLeRawFloat32Payload(payload: Sam2TensorPayload, ort: OrtModule): InstanceType<OrtModule["Tensor"]> {
  if (payload.encoding !== "le-raw" || payload.dtype !== "float32") {
    throw new Error(`SAM2 CVAT decode: expected float32 le-raw tensor, got ${payload.dtype} ${payload.encoding}`)
  }
  const expectedBytes = numElements(payload.shape) * 4
  const bin = atob(payload.data_base64)
  if (bin.length !== expectedBytes) {
    throw new Error(`SAM2 CVAT decode: base64 length ${bin.length} != expected ${expectedBytes}`)
  }
  const u8 = new Uint8Array(expectedBytes)
  for (let i = 0; i < bin.length; i += 1) u8[i] = bin.charCodeAt(i)
  const floats = new Float32Array(u8.buffer, u8.byteOffset, expectedBytes / 4)
  return new ort.Tensor("float32", floats, payload.shape.map((x) => Math.floor(Number(x))))
}

function toModelSpace(x: number, y: number, iw: number, ih: number, res: number): [number, number] {
  return [(x / iw) * res, (y / ih) * res]
}

/** MobileSAM：最长边缩放到 res 后 pad 成正方形；prompt 须在缩放后（未 pad）像素坐标。 */
function toMobileSamModelSpace(x: number, y: number, iw: number, ih: number, res: number): [number, number] {
  const scale = res / Math.max(ih, iw, 1)
  const newW = Math.round(iw * scale)
  const newH = Math.round(ih * scale)
  return [(x / iw) * newW, (y / ih) * newH]
}

function promptToModelSpace(
  x: number,
  y: number,
  iw: number,
  ih: number,
  res: number,
  featureLayout: string | undefined,
): [number, number] {
  if (featureLayout === "mobile_sam_cvat_decoder_onnx_v1") {
    return toMobileSamModelSpace(x, y, iw, ih, res)
  }
  return toModelSpace(x, y, iw, ih, res)
}

function scalarOutputToInt(t: import("onnxruntime-web").Tensor): number {
  const d = t.data
  if (d instanceof BigInt64Array) return Number(d[0] ?? 0n)
  if (d instanceof Int32Array) return Number(d[0] ?? 0)
  if (d instanceof Float32Array) return Math.floor(Number(d[0] ?? 0))
  return 0
}

/** 部分 CVAT/hashJoe decoder 会额外导出 IoU / scores；若不存在则返回 null（不做阈值过滤）。 */
function extractPredIouFromDecoderOutputs(out: Record<string, import("onnxruntime-web").Tensor>): number | null {
  const keys = Object.keys(out)
  for (const key of keys) {
    const lower = key.toLowerCase()
    if (!lower.includes("iou") && !lower.includes("score")) continue
    const t = out[key]
    if (!t?.data) continue
    const d = t.data
    if (d instanceof Float32Array && d.length > 0) {
      let m = d[0]!
      for (let i = 1; i < d.length; i += 1) m = Math.max(m, d[i]!)
      if (!Number.isFinite(m)) continue
      return Math.max(0, Math.min(1, m))
    }
  }
  return null
}

function stitchCroppedMask(
  crop: Uint8Array,
  cropW: number,
  cropH: number,
  xtl: number,
  ytl: number,
  fullW: number,
  fullH: number,
): Uint8Array {
  const out = new Uint8Array(fullW * fullH)
  for (let y = 0; y < cropH; y += 1) {
    for (let x = 0; x < cropW; x += 1) {
      if (!crop[y * cropW + x]) continue
      const fx = xtl + x
      const fy = ytl + y
      if (fx >= 0 && fx < fullW && fy >= 0 && fy < fullH) out[fy * fullW + fx] = 1
    }
  }
  return out
}

export async function loadSam2DecoderSession(modelId: string): Promise<import("onnxruntime-web").InferenceSession> {
  const hit = sessionByModelId.get(modelId)
  if (hit) return hit
  const p = (async () => {
    const ort = await getOrt()
    const url = decoderOnnxUrlForAsset(modelId)
    return ort.InferenceSession.create(url, { executionProviders: ["wasm"] })
  })()
  sessionByModelId.set(modelId, p)
  return p
}

export type Sam2CvatsPrompt =
  | { mode: "point"; points: { x: number; y: number; label: 0 | 1 }[] }
  | { mode: "bbox"; bbox: { x1: number; y1: number; x2: number; y2: number } }

export type Sam2CvatsDecodeOptions = {
  /** 若 decoder 导出预测 IoU 且低于该值则视为无有效目标（不返回 mask）。未导出 IoU 时忽略此项。 */
  minPredIou?: number
}

function buildCvatsPromptTensors(
  ort: OrtModule,
  encode: Sam2EncodeImageResponse,
  prompt: Sam2CvatsPrompt,
): {
  pointCoords: InstanceType<OrtModule["Tensor"]>
  pointLabels: InstanceType<OrtModule["Tensor"]>
  maskInput: InstanceType<OrtModule["Tensor"]>
  hasMaskInput: InstanceType<OrtModule["Tensor"]>
  origIm: InstanceType<OrtModule["Tensor"]>
} {
  const iw = encode.image_width
  const ih = encode.image_height
  const res = encode.model_input_size ?? 1024
  const mh = encode.mask_input_height ?? 256
  const mw = encode.mask_input_width ?? 256
  const layout = encode.feature_layout
  const toSpace = (x: number, y: number) => promptToModelSpace(x, y, iw, ih, res, layout)

  const coordsFlat: number[] = []
  const labelsFlat: number[] = []

  if (prompt.mode === "bbox") {
    const { x1, y1, x2, y2 } = prompt.bbox
    const a = toSpace(x1, y1)
    const b = toSpace(x2, y2)
    coordsFlat.push(a[0], a[1], b[0], b[1], 0, 0)
    labelsFlat.push(2, 3, -1)
  } else {
    for (const p of prompt.points) {
      const m = toSpace(p.x, p.y)
      coordsFlat.push(m[0], m[1])
      labelsFlat.push(p.label)
    }
    coordsFlat.push(0, 0)
    labelsFlat.push(-1)
  }

  const n = labelsFlat.length
  const pointCoordsArr = new Float32Array(n * 2)
  for (let i = 0; i < n; i += 1) {
    pointCoordsArr[i * 2] = coordsFlat[i * 2]!
    pointCoordsArr[i * 2 + 1] = coordsFlat[i * 2 + 1]!
  }
  const pointLabelsArr = new Float32Array(labelsFlat.map((x) => Number(x)))
  const maskInputArr = new Float32Array(1 * 1 * mh * mw)
  const hasMaskInputArr = new Float32Array([0])
  const origImArr = new Int32Array([ih, iw])

  return {
    pointCoords: new ort.Tensor("float32", pointCoordsArr, [1, n, 2]),
    pointLabels: new ort.Tensor("float32", pointLabelsArr, [1, n]),
    maskInput: new ort.Tensor("float32", maskInputArr, [1, 1, mh, mw]),
    hasMaskInput: new ort.Tensor("float32", hasMaskInputArr, [1]),
    origIm: new ort.Tensor("int32", origImArr, [2]),
  }
}

function masksTensorToRleInEncodeSpace(
  out: Record<string, import("onnxruntime-web").Tensor>,
  iw: number,
  ih: number,
  options?: Sam2CvatsDecodeOptions,
): { counts: number[]; w: number; h: number } | null {
  const masksTensor = out.masks
  const xtlT = out.xtl
  const ytlT = out.ytl
  const xbrT = out.xbr
  const ybrT = out.ybr
  if (!masksTensor || !xtlT || !ytlT || !xbrT || !ybrT) {
    throw new Error("decoder ONNX 输出缺少 masks/xtl/ytl/xbr/ybr")
  }

  const predIou = extractPredIouFromDecoderOutputs(out)
  const minIou = options?.minPredIou
  if (predIou !== null && minIou !== undefined && minIou > 0 && predIou < minIou) {
    return null
  }

  const xtl = scalarOutputToInt(xtlT)
  const ytl = scalarOutputToInt(ytlT)
  void scalarOutputToInt(xbrT)
  void scalarOutputToInt(ybrT)

  const md = masksTensor.data
  let crop: Uint8Array
  const dims = masksTensor.dims.map((d) => Math.floor(Number(d)))
  if (md instanceof Uint8Array) {
    crop = new Uint8Array(md.length)
    for (let i = 0; i < md.length; i += 1) crop[i] = md[i]! > 0 ? 1 : 0
  } else if (md instanceof Float32Array) {
    crop = new Uint8Array(md.length)
    for (let i = 0; i < md.length; i += 1) crop[i] = md[i]! > 0 ? 1 : 0
  } else {
    throw new Error(`unexpected masks dtype ${masksTensor.type}`)
  }

  let cropH = 1
  let cropW = 1
  if (dims.length >= 2) {
    cropH = Math.max(1, dims[dims.length - 2] ?? 1)
    cropW = Math.max(1, dims[dims.length - 1] ?? 1)
  }
  if (cropH * cropW !== crop.length) {
    cropH = Math.max(1, dims[dims.length - 2] ?? 1)
    cropW = Math.max(1, Math.floor(crop.length / cropH))
  }
  if (cropH * cropW !== crop.length) {
    throw new Error(`masks tensor size mismatch dims=${dims.join("x")} len=${crop.length}`)
  }

  const full = stitchCroppedMask(crop, cropW, cropH, xtl, ytl, iw, ih)
  if (!maskBinaryHasForeground(full)) return null

  return {
    counts: encodeBinaryToRowMajorRle(full),
    w: iw,
    h: ih,
  }
}

export async function runSam2CvatsDecoder(
  encode: Sam2EncodeImageResponse,
  prompt: Sam2CvatsPrompt,
  options?: Sam2CvatsDecodeOptions,
): Promise<{ counts: number[]; w: number; h: number } | null> {
  if (encode.feature_layout !== "sam2.1_cvat_decoder_onnx_v1") {
    throw new Error("当前图像编码不是 CVAT/ONNX 布局，请重新编码或检查后端版本")
  }
  const modelId = encode.model_id
  return enqueueSam2DecoderRun(modelId, async () => {
    const ort = await getOrt()
    const session = await loadSam2DecoderSession(modelId)

    const iw = encode.image_width
    const ih = encode.image_height
    const hr = encode.high_res_feats
    if (!hr || hr.length < 2) {
      throw new Error("SAM 2.1 编码缺少 high_res_feats，请重新编码")
    }

    const image_embed = decodeLeRawFloat32Payload(encode.image_embed, ort)
    const hr0 = decodeLeRawFloat32Payload(hr[0]!, ort)
    const hr1 = decodeLeRawFloat32Payload(hr[1]!, ort)
    const promptTensors = buildCvatsPromptTensors(ort, encode, prompt)

    const feeds: Record<string, InstanceType<OrtModule["Tensor"]>> = {
      image_embed,
      high_res_feats_0: hr0,
      high_res_feats_1: hr1,
      point_coords: promptTensors.pointCoords,
      point_labels: promptTensors.pointLabels,
      orig_im_size: promptTensors.origIm,
      mask_input: promptTensors.maskInput,
      has_mask_input: promptTensors.hasMaskInput,
    }

    const out = await session.run(feeds)
    return masksTensorToRleInEncodeSpace(out as Record<string, import("onnxruntime-web").Tensor>, iw, ih, options)
  })
}

export async function runMobileSamCvatsDecoder(
  encode: Sam2EncodeImageResponse,
  prompt: Sam2CvatsPrompt,
  options?: Sam2CvatsDecodeOptions,
): Promise<{ counts: number[]; w: number; h: number } | null> {
  if (encode.feature_layout !== "mobile_sam_cvat_decoder_onnx_v1") {
    throw new Error("当前图像编码不是 MobileSAM CVAT/ONNX 布局，请重新编码或检查后端版本")
  }
  const modelId = encode.model_id
  return enqueueSam2DecoderRun(modelId, async () => {
    const ort = await getOrt()
    const session = await loadSam2DecoderSession(modelId)

    const iw = encode.image_width
    const ih = encode.image_height
    const image_embed = decodeLeRawFloat32Payload(encode.image_embed, ort)
    const promptTensors = buildCvatsPromptTensors(ort, encode, prompt)

    const feeds: Record<string, InstanceType<OrtModule["Tensor"]>> = {
      image_embed,
      point_coords: promptTensors.pointCoords,
      point_labels: promptTensors.pointLabels,
      orig_im_size: promptTensors.origIm,
      mask_input: promptTensors.maskInput,
      has_mask_input: promptTensors.hasMaskInput,
    }

    const out = await session.run(feeds)
    return masksTensorToRleInEncodeSpace(out as Record<string, import("onnxruntime-web").Tensor>, iw, ih, options)
  })
}

/** 按 encode.feature_layout 分发到 SAM2.1 或 MobileSAM decoder。 */
export async function runSamCvatsDecoder(
  encode: Sam2EncodeImageResponse,
  prompt: Sam2CvatsPrompt,
  options?: Sam2CvatsDecodeOptions,
): Promise<{ counts: number[]; w: number; h: number } | null> {
  const layout = encode.feature_layout
  if (layout === "sam2.1_cvat_decoder_onnx_v1") {
    return runSam2CvatsDecoder(encode, prompt, options)
  }
  if (layout === "mobile_sam_cvat_decoder_onnx_v1") {
    return runMobileSamCvatsDecoder(encode, prompt, options)
  }
  throw new Error(`不支持的 SAM feature_layout: ${layout ?? "(缺失)"}`)
}

export function isSamCvatsFeatureLayout(layout: string | undefined): boolean {
  return layout === "sam2.1_cvat_decoder_onnx_v1" || layout === "mobile_sam_cvat_decoder_onnx_v1"
}

export async function loadSamDecoderSession(modelId: string): Promise<import("onnxruntime-web").InferenceSession> {
  return loadSam2DecoderSession(modelId)
}
