/** 从文件头解析常见图片格式的宽高（不依赖额外 native 库）。 */

export function parseImageDimensionsFromHeader(buffer: Buffer, format: string): { width: number; height: number } {
  const fmt = (format || "").trim().toUpperCase()
  if (fmt === "PNG" && buffer.length >= 24) {
    const width = buffer.readUInt32BE(16)
    const height = buffer.readUInt32BE(20)
    if (width > 0 && height > 0) return { width, height }
  }
  if (fmt === "JPEG" || fmt === "JPG") {
    const jpeg = parseJpegDimensions(buffer)
    if (jpeg) return jpeg
  }
  if (fmt === "GIF" && buffer.length >= 10) {
    const width = buffer.readUInt16LE(6)
    const height = buffer.readUInt16LE(8)
    if (width > 0 && height > 0) return { width, height }
  }
  if (fmt === "BMP" && buffer.length >= 26) {
    const width = buffer.readInt32LE(18)
    const height = Math.abs(buffer.readInt32LE(22))
    if (width > 0 && height > 0) return { width, height }
  }
  if (fmt === "WEBP" && buffer.length >= 30) {
    const chunkType = buffer.toString("ascii", 12, 16)
    if (chunkType === "VP8X" && buffer.length >= 30) {
      const width = 1 + buffer.readUIntLE(24, 3)
      const height = 1 + buffer.readUIntLE(27, 3)
      if (width > 0 && height > 0) return { width, height }
    }
    if (chunkType === "VP8 " && buffer.length >= 30) {
      const width = buffer.readUInt16LE(26) & 0x3fff
      const height = buffer.readUInt16LE(28) & 0x3fff
      if (width > 0 && height > 0) return { width, height }
    }
  }
  return { width: 0, height: 0 }
}

function parseJpegDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null
  let offset = 2
  while (offset + 3 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1
      continue
    }
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1
    if (offset >= buffer.length) break
    const marker = buffer[offset]
    offset += 1
    if (marker === 0xd9 || marker === 0xda) break
    if (offset + 1 >= buffer.length) break
    const segmentLength = (buffer[offset] << 8) + buffer[offset + 1]
    if (segmentLength < 2 || offset + segmentLength > buffer.length) break
    const isSOF =
      marker === 0xc0 ||
      marker === 0xc1 ||
      marker === 0xc2 ||
      marker === 0xc3 ||
      marker === 0xc5 ||
      marker === 0xc6 ||
      marker === 0xc7 ||
      marker === 0xc9 ||
      marker === 0xca ||
      marker === 0xcb ||
      marker === 0xcd ||
      marker === 0xce ||
      marker === 0xcf
    if (isSOF && segmentLength >= 8) {
      const height = (buffer[offset + 5] << 8) + buffer[offset + 6]
      const width = (buffer[offset + 7] << 8) + buffer[offset + 8]
      if (width > 0 && height > 0) return { width, height }
      return null
    }
    offset += segmentLength
  }
  return null
}
