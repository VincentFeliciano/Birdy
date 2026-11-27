// Elegoo .goo (V3.0) writer and layer reader. Big-endian throughout.
// Layout follows Elegoo's published GOO format as implemented by the open-source msla_format crate.

import type { ResinPrinter, ResinSettings } from './printers.ts'

const DELIM = [0x0d, 0x0a]
const MAGIC = [0x07, 0x00, 0x00, 0x00, 0x44, 0x4c, 0x50, 0x00]
export const GOO_ENDING = new Uint8Array([0x00, 0x00, 0x00, ...MAGIC])
export const GOO_HEADER_SIZE = 0x2fb95
export const SMALL_PREVIEW = 116
export const BIG_PREVIEW = 290

/** Growable byte buffer. */
class Bytes {
  buf: Uint8Array
  len = 0
  constructor(size = 1 << 16) {
    this.buf = new Uint8Array(size)
  }
  private room(n: number) {
    if (this.len + n <= this.buf.length) return
    let size = this.buf.length * 2
    while (size < this.len + n) size *= 2
    const next = new Uint8Array(size)
    next.set(this.buf.subarray(0, this.len))
    this.buf = next
  }
  u8(v: number) {
    this.room(1)
    this.buf[this.len++] = v & 0xff
  }
  bytes(a: ArrayLike<number>) {
    this.room(a.length)
    this.buf.set(a, this.len)
    this.len += a.length
  }
  result() {
    return this.buf.slice(0, this.len)
  }
}

/**
 * Run-length encodes one layer image. Feed it runs of (length, grey value) covering every pixel,
 * row by row; adjacent runs of the same value are merged.
 */
export class LayerEncoder {
  private out = new Bytes()
  private value = -1
  private length = 0
  /** Lit pixels, weighted by grey level (for the volume estimate). */
  lit = 0
  pixels = 0

  run(length: number, value: number) {
    if (length <= 0) return
    this.pixels += length
    if (value) this.lit += (length * value) / 255
    if (value === this.value) {
      this.length += length
      return
    }
    this.flush()
    this.value = value
    this.length = length
  }

  private flush() {
    let n = this.length
    const v = this.value
    while (n > 0) {
      const len = Math.min(n, 0xfffffff)
      this.chunk(len, v)
      n -= len
    }
    this.length = 0
  }

  private chunk(len: number, v: number) {
    const type = v === 0 ? 0 : v === 255 ? 3 : 1
    const size = len < 0x10 ? 0 : len < 0x1000 ? 1 : len < 0x100000 ? 2 : 3
    this.out.u8((type << 6) | (size << 4) | (len & 0x0f))
    if (type === 1) this.out.u8(v)
    if (size === 1) this.out.u8(len >> 4)
    else if (size === 2) {
      this.out.u8(len >> 12)
      this.out.u8((len >> 4) & 0xff)
    } else if (size === 3) {
      this.out.u8(len >> 20)
      this.out.u8((len >> 12) & 0xff)
      this.out.u8((len >> 4) & 0xff)
    }
  }

  /** Encoded layer image (without the 0x55 marker and checksum). */
  finish() {
    this.flush()
    return this.out.result()
  }
}

export function checksum(data: Uint8Array) {
  let sum = 0
  for (let i = 0; i < data.length; i++) sum = (sum + data[i]!) & 0xff
  return ~sum & 0xff
}

function writer(size: number) {
  const buf = new Uint8Array(size)
  const view = new DataView(buf.buffer)
  let o = 0
  return {
    buf,
    get offset() {
      return o
    },
    u8: (v: number) => view.setUint8(o++, v),
    u16: (v: number) => {
      view.setUint16(o, v)
      o += 2
    },
    u32: (v: number) => {
      view.setUint32(o, v >>> 0)
      o += 4
    },
    f32: (v: number) => {
      view.setFloat32(o, v)
      o += 4
    },
    bytes: (a: ArrayLike<number>) => {
      buf.set(a, o)
      o += a.length
    },
    str: (s: string, n: number) => {
      const enc = new TextEncoder().encode(s).subarray(0, n)
      buf.set(enc, o)
      o += n
    },
  }
}

export interface LayerInfo {
  z: number
  exposure: number
  bottom: boolean
}

/** One layer record: settings, then the encoded image between its marker and checksum. */
export function layerRecord(s: ResinSettings, info: LayerInfo, image: Uint8Array) {
  const w = writer(74 + image.length)
  const lift = info.bottom ? s.bottomLiftDistance : s.liftDistance
  const liftSpeed = info.bottom ? s.bottomLiftSpeed : s.liftSpeed
  w.u16(0) // pause
  w.f32(200) // pause position z
  w.f32(info.z)
  w.f32(info.exposure)
  w.f32(s.lightOff)
  w.f32(0) // before lift
  w.f32(0) // after lift
  w.f32(0) // after retract
  w.f32(lift)
  w.f32(liftSpeed)
  w.f32(0) // second lift distance
  w.f32(0) // second lift speed
  w.f32(lift)
  w.f32(s.retractSpeed)
  w.f32(0) // second retract distance
  w.f32(0) // second retract speed
  w.u16(255) // light PWM
  w.bytes(DELIM)
  w.u32(image.length + 2)
  w.u8(0x55)
  w.bytes(image)
  w.u8(checksum(image))
  w.bytes(DELIM)
  return w.buf
}

export interface HeaderInfo {
  printer: ResinPrinter
  settings: ResinSettings
  layers: number
  printSeconds: number
  volumeMm3: number
  weightG: number
  /** RGBA previews, 116×116 and 290×290. */
  smallPreview?: Uint8ClampedArray
  bigPreview?: Uint8ClampedArray
  softwareVersion: string
  date: Date
}

function rgb565(rgba: Uint8ClampedArray | undefined, size: number, put: (v: number) => void) {
  for (let i = 0; i < size * size; i++) {
    if (!rgba) {
      put(0)
      continue
    }
    const r = rgba[i * 4]!, g = rgba[i * 4 + 1]!, b = rgba[i * 4 + 2]!
    put(((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3))
  }
}

const pad = (n: number) => String(n).padStart(2, '0')

export function gooHeader(h: HeaderInfo) {
  const { printer: p, settings: s } = h
  const w = writer(GOO_HEADER_SIZE)
  const d = h.date
  w.str('V3.0', 4)
  w.bytes(MAGIC)
  w.str('Birdy', 32)
  w.str(h.softwareVersion, 24)
  w.str(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`, 24)
  w.str(p.name, 32)
  w.str('MSLA', 32)
  w.str('Birdy', 32)
  w.u16(s.antialias ? 4 : 1) // anti-aliasing level
  w.u16(0) // grey level
  w.u16(0) // blur level
  rgb565(h.smallPreview, SMALL_PREVIEW, w.u16)
  w.bytes(DELIM)
  rgb565(h.bigPreview, BIG_PREVIEW, w.u16)
  w.bytes(DELIM)
  w.u32(h.layers)
  w.u16(p.resX)
  w.u16(p.resY)
  w.u8(s.mirror ? 1 : 0) // x mirror
  w.u8(0) // y mirror
  w.f32(p.sizeX)
  w.f32(p.sizeY)
  w.f32(p.sizeZ)
  w.f32(s.layerHeight)
  w.f32(s.exposure)
  w.u8(0) // exposure delay mode: light-off time
  w.f32(s.lightOff)
  w.f32(0) // bottom before lift
  w.f32(0) // bottom after lift
  w.f32(0) // bottom after retract
  w.f32(0) // before lift
  w.f32(0) // after lift
  w.f32(0) // after retract
  w.f32(s.bottomExposure)
  w.u32(s.bottomLayers)
  w.f32(s.bottomLiftDistance)
  w.f32(s.bottomLiftSpeed)
  w.f32(s.liftDistance)
  w.f32(s.liftSpeed)
  w.f32(s.bottomLiftDistance) // bottom retract distance
  w.f32(s.retractSpeed)
  w.f32(s.liftDistance) // retract distance
  w.f32(s.retractSpeed)
  for (let i = 0; i < 8; i++) w.f32(0) // second lift / retract stages unused
  w.u16(255) // bottom light PWM
  w.u16(255) // light PWM
  w.u8(0) // per-layer settings
  w.u32(Math.round(h.printSeconds))
  w.f32(h.volumeMm3)
  w.f32(h.weightG)
  w.f32(0) // price
  w.str('$', 8)
  w.u32(GOO_HEADER_SIZE)
  w.u8(1) // grey scale 0x00-0xFF
  w.u16(0) // transition layers
  if (w.offset !== GOO_HEADER_SIZE) throw new Error(`GOO header is ${w.offset} bytes, expected ${GOO_HEADER_SIZE}`)
  return w.buf
}

/** Calls `run(length, value)` for each run in an encoded layer image. */
export function decodeLayer(data: Uint8Array, run: (length: number, value: number) => void) {
  let i = 0
  let last = 0
  while (i < data.length) {
    const head = data[i++]!
    const type = head >> 6
    if (type === 2) {
      const diff = head & 0x0f
      const value = head & 0x20 ? last - diff : last + diff
      const length = head & 0x10 ? data[i++]! : 1
      run(length, value)
      last = value
      continue
    }
    const value = type === 0 ? 0 : type === 3 ? 255 : data[i++]!
    const size = (head >> 4) & 3
    let length = head & 0x0f
    if (size === 1) length |= data[i++]! << 4
    else if (size === 2) length |= (data[i++]! << 12) | (data[i++]! << 4)
    else if (size === 3) length |= (data[i++]! << 20) | (data[i++]! << 12) | (data[i++]! << 4)
    run(length, value)
    last = value
  }
}

/** Finds layer images in a finished file (for preview and tests). */
export function readLayers(file: Uint8Array) {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength)
  const count = view.getUint32(195310)
  const resX = view.getUint16(195314)
  const resY = view.getUint16(195316)
  const layers: { z: number; exposure: number; image: Uint8Array; checksumOk: boolean }[] = []
  let o = GOO_HEADER_SIZE
  for (let n = 0; n < count; n++) {
    const z = view.getFloat32(o + 6)
    const exposure = view.getFloat32(o + 10)
    if (file[o + 64] !== 0x0d || file[o + 65] !== 0x0a) throw new Error(`Layer ${n}: missing delimiter`)
    const len = view.getUint32(o + 66)
    if (file[o + 70] !== 0x55) throw new Error(`Layer ${n}: missing marker`)
    const image = file.subarray(o + 71, o + 71 + len - 2)
    const checksumOk = file[o + 71 + len - 2] === checksum(image)
    layers.push({ z, exposure, image, checksumOk })
    o += 72 + len
  }
  const ending = file.subarray(o)
  const endingOk = ending.length === GOO_ENDING.length && ending.every((b, i) => b === GOO_ENDING[i])
  return { resX, resY, layers, endingOk }
}
