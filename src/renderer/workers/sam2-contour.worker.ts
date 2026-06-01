/// <reference lib="webworker" />

import { contourForYoloExport } from "../lib/mask-contour"

type ContourWorkerRequest = {
  maskBinary: Uint8Array
  w: number
  h: number
  options: { rdpEpsilon: number; maxPoints: number }
}

type ContourWorkerResponse =
  | { ok: true; ring: number[][] }
  | { ok: false; error: string }

self.onmessage = (event: MessageEvent<ContourWorkerRequest>) => {
  try {
    const payload = event.data
    const ring = contourForYoloExport(payload.maskBinary, payload.w, payload.h, payload.options).map(([x, y]) => [
      Math.round(x),
      Math.round(y),
    ])
    const response: ContourWorkerResponse = { ok: true, ring }
    self.postMessage(response)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const response: ContourWorkerResponse = { ok: false, error: message }
    self.postMessage(response)
  }
}

export {}
