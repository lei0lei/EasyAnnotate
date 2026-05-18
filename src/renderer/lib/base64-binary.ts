/**
 * Base64 → 二进制（不依赖 window.atob，兼容部分 Electron / 沙箱环境）。
 * 标准 alphabet，忽略空白；URL-safe（-_）按常见约定映射。
 */

const STD = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

function buildLookup(): Uint8Array {
  const t = new Uint8Array(128).fill(255)
  for (let i = 0; i < STD.length; i++) {
    t[STD.charCodeAt(i)!] = i
  }
  t["-".charCodeAt(0)!] = 62
  t["_".charCodeAt(0)!] = 63
  return t
}

const LOOKUP = buildLookup()

function charCode6(c: number): number {
  if (c >= 128) return 255
  const v = LOOKUP[c]!
  if (v === 255) throw new Error(`Invalid base64 character: ${String.fromCharCode(c)}`)
  return v
}

/** 解码为标准 Base64（含 padding）；返回连续 Uint8Array */
export function decodeBase64ToUint8Array(b64: string): Uint8Array {
  const s = b64.replace(/\s/g, "")
  if (s.length === 0) return new Uint8Array(0)
  if (s.length % 4 !== 0) {
    throw new Error("Invalid base64 length")
  }
  const out: number[] = []
  const eq = "=".charCodeAt(0)
  for (let i = 0; i < s.length; i += 4) {
    const a = charCode6(s.charCodeAt(i)!)
    const b = charCode6(s.charCodeAt(i + 1)!)
    const cchr = s.charCodeAt(i + 2)!
    const dchr = s.charCodeAt(i + 3)!
    if (cchr === eq && dchr === eq) {
      const n = (a << 18) | (b << 12)
      out.push((n >> 16) & 255)
    } else if (dchr === eq) {
      const c = charCode6(cchr)
      const n = (a << 18) | (b << 12) | (c << 6)
      out.push((n >> 16) & 255)
      out.push((n >> 8) & 255)
    } else {
      const c = charCode6(cchr)
      const d = charCode6(dchr)
      const n = (a << 18) | (b << 12) | (c << 6) | d
      out.push((n >> 16) & 255)
      out.push((n >> 8) & 255)
      out.push(n & 255)
    }
  }
  return Uint8Array.from(out)
}
