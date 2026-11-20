// 极简 ZIP：只存不压（STORE），给「导出全部」把多张 PNG 打成一个包。PNG 本身已经压缩过，再压也小不了多少。
// 不依赖第三方库；文件名用 UTF-8（通用标志第 11 位），中文名在各系统的解压工具里都能正常显示。
// 同时附一个只认 STORE 的读取函数，测试里拿来做来回校验。

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

/** CRC-32（ZIP 用的那种）。 */
export function crc32(bytes) {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** 日期转成 ZIP 里的 DOS 时间和日期。 */
function dosTime(date) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date()
  const year = Math.max(1980, d.getFullYear())
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

/**
 * 打一个 STORE 方式的 ZIP。
 * @param {Array<{name: string, data: Uint8Array}>} files - 文件名（可以有中文，不能有 .. 和开头的 /）和内容。
 * @param {{date?: Date}} [options]
 * @returns {Uint8Array} 整个 ZIP 文件的字节。
 */
export function makeZip(files, { date } = {}) {
  const encoder = new TextEncoder()
  const stamp = dosTime(date)
  const chunks = []
  const central = []
  let offset = 0
  const seen = new Set()
  for (const file of files) {
    let name = String(file.name ?? '').replace(/\\/g, '/').replace(/^\/+/, '').split('/').filter(part => part && part !== '..' && part !== '.').join('/') || 'file'
    // 重名的加序号，免得解压时互相覆盖
    for (let n = 2; seen.has(name); n += 1) name = name.replace(/(\.[^.]*)?$/, ext => `-${n}${ext ?? ''}`)
    seen.add(name)
    const nameBytes = encoder.encode(name)
    const data = file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data ?? [])
    const crc = crc32(data)
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true)
    local.setUint16(6, 0x0800, true)
    local.setUint16(8, 0, true)
    local.setUint16(10, stamp.time, true)
    local.setUint16(12, stamp.date, true)
    local.setUint32(14, crc, true)
    local.setUint32(18, data.length, true)
    local.setUint32(22, data.length, true)
    local.setUint16(26, nameBytes.length, true)
    local.setUint16(28, 0, true)
    chunks.push(new Uint8Array(local.buffer), nameBytes, data)
    const entry = new DataView(new ArrayBuffer(46))
    entry.setUint32(0, 0x02014b50, true)
    entry.setUint16(4, 20, true)
    entry.setUint16(6, 20, true)
    entry.setUint16(8, 0x0800, true)
    entry.setUint16(10, 0, true)
    entry.setUint16(12, stamp.time, true)
    entry.setUint16(14, stamp.date, true)
    entry.setUint32(16, crc, true)
    entry.setUint32(20, data.length, true)
    entry.setUint32(24, data.length, true)
    entry.setUint16(28, nameBytes.length, true)
    entry.setUint32(42, offset, true)
    central.push(new Uint8Array(entry.buffer), nameBytes)
    offset += 30 + nameBytes.length + data.length
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, files.length, true)
  end.setUint16(10, files.length, true)
  end.setUint32(12, centralSize, true)
  end.setUint32(16, offset, true)
  const parts = [...chunks, ...central, new Uint8Array(end.buffer)]
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

/**
 * 读 STORE 方式的 ZIP（只给测试和自检用）。
 * @returns {Array<{name: string, data: Uint8Array, crc: number}>} 读到的文件；CRC 对不上时抛错。
 */
export function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = bytes.length - 22
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end -= 1
  if (end < 0) throw new Error('not a zip')
  const count = view.getUint16(end + 10, true)
  let at = view.getUint32(end + 16, true)
  const decoder = new TextDecoder()
  const files = []
  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error('bad central directory')
    const method = view.getUint16(at + 10, true)
    const crc = view.getUint32(at + 16, true)
    const size = view.getUint32(at + 20, true)
    const nameLength = view.getUint16(at + 28, true)
    const extra = view.getUint16(at + 30, true)
    const comment = view.getUint16(at + 32, true)
    const local = view.getUint32(at + 42, true)
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength))
    if (method !== 0) throw new Error('only STORE is supported')
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
    const data = bytes.slice(start, start + size)
    if (crc32(data) !== crc) throw new Error(`crc mismatch: ${name}`)
    files.push({ name, data, crc })
    at += 46 + nameLength + extra + comment
  }
  return files
}
