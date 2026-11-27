// A small, defensive ZIP reader for unpacking downloaded model archives. No Electron imports, so
// it runs in tests. Downloaded archives are untrusted, so:
//   - entry names are never used as paths directly (see safeRelativePath)
//   - every entry is size-capped while inflating (zip bombs), and its CRC-32 is checked
//   - encrypted entries and unusual compression methods are skipped, not guessed at
import { open, type FileHandle } from 'node:fs/promises'
import { crc32, inflateRawSync } from 'node:zlib'

export interface ZipEntry {
  /** Name as stored in the archive (forward slashes). */
  name: string
  method: number
  flags: number
  crc: number
  compressedSize: number
  size: number
  localOffset: number
  isDir: boolean
}

const EOCD = 0x06054b50
const EOCD64_LOCATOR = 0x07064b50
const EOCD64 = 0x06064b50
const CEN = 0x02014b50
const LOC = 0x04034b50
const MAX_ENTRIES = 100_000

async function readAt(fh: FileHandle, pos: number, len: number) {
  const buf = Buffer.alloc(len)
  const { bytesRead } = await fh.read(buf, 0, len, pos)
  if (bytesRead !== len) throw new Error('The archive is truncated.')
  return buf
}

function decodeName(raw: Buffer, utf8: boolean) {
  // Without the UTF-8 flag names are CP437; Latin-1 is the closest built-in decoding.
  return (utf8 ? raw.toString('utf8') : raw.toString('latin1')).replace(/\\/g, '/')
}

/** Reads the central directory. */
export async function readZipEntries(fh: FileHandle): Promise<ZipEntry[]> {
  const { size: fileSize } = await fh.stat()
  if (fileSize < 22) throw new Error('This is not a ZIP archive.')
  const tailLen = Math.min(fileSize, 22 + 65535)
  const tail = await readAt(fh, fileSize - tailLen, tailLen)
  let e = -1
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === EOCD) {
      e = i
      break
    }
  }
  if (e < 0) throw new Error('This is not a ZIP archive, or it is damaged.')
  let count = tail.readUInt16LE(e + 10)
  let cdSize = tail.readUInt32LE(e + 12)
  let cdOffset = tail.readUInt32LE(e + 16)

  // ZIP64: the real values live in the ZIP64 end record.
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    const locPos = fileSize - tailLen + e - 20
    if (locPos < 0) throw new Error('The archive is damaged (ZIP64 locator missing).')
    const loc = await readAt(fh, locPos, 20)
    if (loc.readUInt32LE(0) !== EOCD64_LOCATOR) throw new Error('The archive is damaged (ZIP64 locator missing).')
    const rec = await readAt(fh, Number(loc.readBigUInt64LE(8)), 56)
    if (rec.readUInt32LE(0) !== EOCD64) throw new Error('The archive is damaged (ZIP64 record missing).')
    count = Number(rec.readBigUInt64LE(32))
    cdSize = Number(rec.readBigUInt64LE(40))
    cdOffset = Number(rec.readBigUInt64LE(48))
  }
  if (count > MAX_ENTRIES) throw new Error('The archive has too many files.')
  if (cdOffset + cdSize > fileSize) throw new Error('The archive is damaged (directory out of range).')

  const cd = await readAt(fh, cdOffset, cdSize)
  const entries: ZipEntry[] = []
  let p = 0
  for (let i = 0; i < count; i++) {
    if (p + 46 > cd.length || cd.readUInt32LE(p) !== CEN) throw new Error('The archive is damaged (bad directory entry).')
    const flags = cd.readUInt16LE(p + 8)
    const method = cd.readUInt16LE(p + 10)
    const crc = cd.readUInt32LE(p + 16)
    let compressedSize = cd.readUInt32LE(p + 20)
    let size = cd.readUInt32LE(p + 24)
    const nameLen = cd.readUInt16LE(p + 28)
    const extraLen = cd.readUInt16LE(p + 30)
    const commentLen = cd.readUInt16LE(p + 32)
    let localOffset = cd.readUInt32LE(p + 42)
    const name = decodeName(cd.subarray(p + 46, p + 46 + nameLen), (flags & 0x800) !== 0)
    // ZIP64 extra field (id 0x0001) holds whichever values overflowed, in this order.
    let x = p + 46 + nameLen
    const xEnd = x + extraLen
    while (x + 4 <= xEnd) {
      const id = cd.readUInt16LE(x)
      const len = cd.readUInt16LE(x + 2)
      if (id === 0x0001) {
        let q = x + 4
        if (size === 0xffffffff) {
          size = Number(cd.readBigUInt64LE(q))
          q += 8
        }
        if (compressedSize === 0xffffffff) {
          compressedSize = Number(cd.readBigUInt64LE(q))
          q += 8
        }
        if (localOffset === 0xffffffff) localOffset = Number(cd.readBigUInt64LE(q))
      }
      x += 4 + len
    }
    entries.push({ name, method, flags, crc, compressedSize, size, localOffset, isDir: name.endsWith('/') })
    p = xEnd + commentLen
  }
  return entries
}

/** Inflates one entry, refusing to produce more than `maxBytes` and checking its CRC-32. */
export async function readZipEntry(fh: FileHandle, entry: ZipEntry, maxBytes: number): Promise<Buffer> {
  if (entry.flags & 0x1) throw new Error('encrypted')
  if (entry.method !== 0 && entry.method !== 8) throw new Error(`compression method ${entry.method} is not supported`)
  if (entry.size > maxBytes) throw new Error('too large')
  const head = await readAt(fh, entry.localOffset, 30)
  if (head.readUInt32LE(0) !== LOC) throw new Error('damaged entry')
  const start = entry.localOffset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28)
  const raw = await readAt(fh, start, entry.compressedSize)
  let data: Buffer
  if (entry.method === 0) data = raw
  else {
    try {
      // The declared size can lie; the output cap is what actually stops a zip bomb.
      data = inflateRawSync(raw, { maxOutputLength: Math.max(1, Math.min(maxBytes, entry.size)) })
    } catch (err) {
      throw new Error(/maxOutputLength|buffer/i.test((err as Error).message) ? 'larger than it claims to be' : 'damaged entry')
    }
  }
  if (data.length !== entry.size) throw new Error('damaged entry (size mismatch)')
  if (crc32(data) >>> 0 !== entry.crc >>> 0) throw new Error('damaged entry (checksum mismatch)')
  return data
}

const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i

/**
 * Turns an archive entry name into safe relative path segments, or null when it must be skipped:
 * no absolute paths or drive letters, no "..", no hidden or macOS resource files, no characters
 * Windows reserves, no reserved device names.
 */
export function safeRelativePath(name: string): string[] | null {
  if (/^[a-z]:/i.test(name) || name.startsWith('/') || name.startsWith('//')) return null
  const parts = name.split('/').filter((s) => s !== '' && s !== '.')
  if (!parts.length) return null
  const out: string[] = []
  for (const raw of parts) {
    if (raw === '..') return null
    if (raw.startsWith('.') || raw === '__MACOSX') return null
    const clean = raw.replace(/[<>:"|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').trim().slice(0, 120)
    if (!clean || RESERVED.test(clean)) return null
    out.push(clean)
  }
  return out
}

export async function openZip(path: string) {
  return open(path, 'r')
}
