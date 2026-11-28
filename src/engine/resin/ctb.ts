// Chitubox .ctb (version 3) writer: Elegoo Mars / Saturn (before .goo), Phrozen Sonic, and other
// printers with a Chitubox mainboard. Little-endian throughout.
// Layout as documented by the open-source UVtools and mslicer projects: header, two previews,
// print parameters, slicer info, a table of layers, then each layer's settings and image.
// Layer images use Chitubox's 7-bit grey run-length coding, XOR-scrambled per layer with the file key.

import { decodeLayer, type HeaderInfo } from './goo.ts'

const MAGIC_CTB = 0x12fd0086
const VERSION = 3
const HEADER = 112
const PREVIEW_STRUCT = 32
const PRINT_PARAMS = 60
const SLICER_INFO = 76
const LAYER_DEF = 36
const LAYER_DEF_EX = 84

class Out {
  buf: Uint8Array
  view: DataView
  len = 0
  constructor(size = 1 << 16) {
    this.buf = new Uint8Array(size)
    this.view = new DataView(this.buf.buffer)
  }
  private room(n: number) {
    if (this.len + n <= this.buf.length) return
    let size = this.buf.length * 2
    while (size < this.len + n) size *= 2
    const next = new Uint8Array(size)
    next.set(this.buf.subarray(0, this.len))
    this.buf = next
    this.view = new DataView(next.buffer)
  }
  u8(v: number) {
    this.room(1)
    this.buf[this.len++] = v & 0xff
  }
  u16(v: number) {
    this.room(2)
    this.view.setUint16(this.len, v, true)
    this.len += 2
  }
  u32(v: number) {
    this.room(4)
    this.view.setUint32(this.len, v >>> 0, true)
    this.len += 4
  }
  f32(v: number) {
    this.room(4)
    this.view.setFloat32(this.len, v, true)
    this.len += 4
  }
  bytes(a: Uint8Array) {
    this.room(a.length)
    this.buf.set(a, this.len)
    this.len += a.length
  }
  result() {
    return this.buf.slice(0, this.len)
  }
}

/** Run-length codes one layer: runs of (length, grey 0..255), merged by 7-bit grey. */
export class CtbLayerEncoder {
  private out = new Out()
  private color = -1
  private length = 0

  run(length: number, value: number) {
    if (length <= 0) return
    const c = value >> 1
    if (c === this.color) {
      this.length += length
      return
    }
    this.flush()
    this.color = c
    this.length = length
  }

  private flush() {
    let n = this.length
    const c = this.color
    while (n > 0) {
      const len = Math.min(n, 0x0fffffff)
      if (len === 1) this.out.u8(c)
      else {
        this.out.u8(c | 0x80)
        if (len <= 0x7f) this.out.u8(len)
        else if (len <= 0x3fff) {
          this.out.u8(0x80 | (len >> 8))
          this.out.u8(len)
        } else if (len <= 0x1fffff) {
          this.out.u8(0xc0 | (len >> 16))
          this.out.u8(len >> 8)
          this.out.u8(len)
        } else {
          this.out.u8(0xe0 | (len >> 24))
          this.out.u8(len >> 16)
          this.out.u8(len >> 8)
          this.out.u8(len)
        }
      }
      n -= len
    }
    this.length = 0
  }

  finish() {
    this.flush()
    return this.out.result()
  }
}

/** Calls `run(length, grey)` for each run of a CTB layer image (already unscrambled). */
export function decodeCtbLayer(data: Uint8Array, run: (length: number, value: number) => void) {
  let i = 0
  while (i < data.length) {
    const code = data[i++]!
    const c = code & 0x7f
    const value = c ? (c << 1) | 1 : 0
    if (!(code & 0x80)) {
      run(1, value)
      continue
    }
    const s = data[i++]!
    let len: number
    if ((s & 0x80) === 0) len = s
    else if ((s & 0xc0) === 0x80) len = ((s & 0x3f) << 8) + data[i++]!
    else if ((s & 0xe0) === 0xc0) len = ((s & 0x1f) << 16) + (data[i++]! << 8) + data[i++]!
    else if ((s & 0xf0) === 0xe0) len = (s & 0x0f) * 0x1000000 + (data[i++]! << 16) + (data[i++]! << 8) + data[i++]!
    else throw new Error('Bad CTB run length')
    run(len, value)
  }
}

/** Scrambles (or unscrambles: it is its own inverse) a layer image with the file key, in place. */
export function ctbCrypt(data: Uint8Array, seed: number, layerIndex: number) {
  if (!seed) return
  const init = (Math.imul(seed, 0x2d83cdac) + 0xd8a83423) >>> 0
  let key = Math.imul((Math.imul(layerIndex, 0x1e1530cd) + 0xec3d47cd) >>> 0, init) >>> 0
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let i = 0
  for (; i + 4 <= data.length; i += 4) {
    view.setUint32(i, (view.getUint32(i, true) ^ key) >>> 0, true)
    key = (key + init) >>> 0
  }
  for (let j = 0; i < data.length; i++, j++) data[i] = data[i]! ^ ((key >>> (8 * j)) & 0xff)
}

/** A preview as Chitubox's 15-bit colour run-length image (RGBA in, square `size`). */
export function ctbPreview(rgba: Uint8ClampedArray | undefined, size: number): Uint8Array {
  const out = new Out()
  let color = -1
  let rep = 0
  const emit = () => {
    if (rep <= 0) return
    if (rep <= 2) for (let k = 0; k < rep; k++) out.u16(color)
    else {
      out.u16(color | 0x20)
      out.u16((rep - 1) | 0x3000)
    }
  }
  for (let i = 0; i < size * size; i++) {
    const r = rgba ? rgba[i * 4]! : 0
    const g = rgba ? rgba[i * 4 + 1]! : 0
    const b = rgba ? rgba[i * 4 + 2]! : 0
    // Red bits 11-15, green 6-10, blue 0-4; bit 5 marks a run.
    const c = ((r >> 3) << 11) | ((g >> 3) << 6) | (b >> 3)
    if (c === color && rep < 0xfff) rep++
    else {
      emit()
      color = c
      rep = 1
    }
  }
  emit()
  return out.result()
}

export interface CtbLayer {
  z: number
  exposure: number
  bottom: boolean
  /** RLE image, not yet scrambled. */
  image: Uint8Array
}

/** The finished .ctb file in pieces: everything before the layers, then one piece per layer. */
export function buildCtb(h: HeaderInfo, layers: CtbLayer[], seed: number, date = h.date): Uint8Array[] {
  const { printer: p, settings: s } = h
  const name = new TextEncoder().encode(p.name.slice(0, 64))
  const big = ctbPreview(h.bigPreview, 290)
  const small = ctbPreview(h.smallPreview, 116)
  const bigAt = HEADER
  const smallAt = bigAt + PREVIEW_STRUCT + big.length
  const paramsAt = smallAt + PREVIEW_STRUCT + small.length
  const slicerAt = paramsAt + PRINT_PARAMS
  const tableAt = slicerAt + SLICER_INFO + name.length
  const dataAt = tableAt + LAYER_DEF * layers.length

  const head = new Out(dataAt)
  // Header
  head.u32(MAGIC_CTB)
  head.u32(VERSION)
  head.f32(p.sizeX)
  head.f32(p.sizeY)
  head.f32(p.sizeZ)
  head.u32(0)
  head.u32(0)
  head.f32(layers.length * s.layerHeight)
  head.f32(s.layerHeight)
  head.f32(s.exposure)
  head.f32(s.bottomExposure)
  head.f32(s.lightOff)
  head.u32(s.bottomLayers)
  head.u32(p.resX)
  head.u32(p.resY)
  head.u32(bigAt)
  head.u32(tableAt)
  head.u32(layers.length)
  head.u32(smallAt)
  head.u32(Math.round(h.printSeconds))
  head.u32(s.mirror ? 1 : 0) // projector type
  head.u32(paramsAt)
  head.u32(PRINT_PARAMS)
  head.u32(1) // anti-aliasing is set in the slicer info for .ctb
  head.u16(255) // light PWM
  head.u16(255) // bottom light PWM
  head.u32(seed)
  head.u32(slicerAt)
  head.u32(SLICER_INFO)
  // Previews: struct, then image
  for (const [at, size, img] of [[bigAt, 290, big], [smallAt, 116, small]] as const) {
    head.u32(size)
    head.u32(size)
    head.u32(at + PREVIEW_STRUCT)
    head.u32(img.length)
    for (let k = 0; k < 4; k++) head.u32(0)
    head.bytes(img)
  }
  // Print parameters
  head.f32(s.bottomLiftDistance)
  head.f32(s.bottomLiftSpeed)
  head.f32(s.liftDistance)
  head.f32(s.liftSpeed)
  head.f32(s.retractSpeed)
  head.f32(h.volumeMm3 / 1000)
  head.f32(h.weightG)
  head.f32(0) // cost
  head.f32(s.lightOff) // bottom light-off delay
  head.f32(s.lightOff)
  head.u32(s.bottomLayers)
  for (let k = 0; k < 4; k++) head.u32(0)
  // Slicer info, then the machine name
  for (let k = 0; k < 7; k++) head.f32(0) // second lift/retract stages and rest times unused
  head.u32(slicerAt + SLICER_INFO)
  head.u32(name.length)
  head.u8(s.antialias ? 0x0f : 0x07)
  head.u16(0)
  head.u8(0) // no per-layer settings
  head.u32(Math.floor(date.getTime() / 60000))
  head.u32(s.antialias ? 8 : 1)
  head.u32(0x01060300) // Chitubox-compatible software version for v3
  head.f32(0)
  head.f32(0)
  head.u32(0) // transition layers
  head.u32(0)
  head.u32(0)
  head.u32(0)
  head.bytes(name)

  // Layer table and layer records
  const records: Uint8Array[] = []
  let at = dataAt
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i]!
    const image = l.image.slice()
    ctbCrypt(image, seed, i)
    const addr = at + LAYER_DEF_EX
    if (addr + image.length > 0xffffffff) throw new Error('The print is too large for a .ctb file.')
    const def = (o: Out) => {
      o.f32(l.z)
      o.f32(l.exposure)
      o.f32(s.lightOff)
      o.u32(addr)
      o.u32(image.length)
      o.u32(0) // page
      o.u32(LAYER_DEF_EX)
      o.u32(0)
      o.u32(0)
    }
    def(head)
    const rec = new Out(LAYER_DEF_EX + image.length)
    def(rec)
    rec.u32(LAYER_DEF_EX + image.length)
    rec.f32(l.bottom ? s.bottomLiftDistance : s.liftDistance)
    rec.f32(l.bottom ? s.bottomLiftSpeed : s.liftSpeed)
    rec.f32(0)
    rec.f32(0)
    rec.f32(s.retractSpeed)
    rec.f32(0)
    rec.f32(0)
    rec.f32(0)
    rec.f32(0)
    rec.f32(0)
    rec.f32(255) // light PWM
    rec.bytes(image)
    records.push(rec.result())
    at += LAYER_DEF_EX + image.length
  }
  const first = head.result()
  if (first.length !== dataAt) throw new Error(`CTB header is ${first.length} bytes, expected ${dataAt}`)
  return [first, ...records]
}

/** Converts Boaty's sliced .goo pieces (header, layer records, ending) into a .ctb file. */
export function gooToCtb(gooParts: Uint8Array[], h: HeaderInfo, seed = randomSeed()): Uint8Array[] {
  const layers: CtbLayer[] = []
  for (let i = 1; i < gooParts.length - 1; i++) {
    const rec = gooParts[i]!
    const view = new DataView(rec.buffer, rec.byteOffset, rec.byteLength)
    const len = view.getUint32(66)
    const enc = new CtbLayerEncoder()
    decodeLayer(rec.subarray(71, 71 + len - 2), (n, v) => enc.run(n, v))
    layers.push({ z: view.getFloat32(6), exposure: view.getFloat32(10), bottom: i - 1 < h.settings.bottomLayers, image: enc.finish() })
  }
  return buildCtb(h, layers, seed)
}

function randomSeed() {
  const a = new Uint32Array(1)
  crypto.getRandomValues(a)
  return 255 + (a[0]! % (0x7fffffff - 255))
}

/** Reads a .ctb back (for tests): header numbers and each layer's unscrambled image. */
export function readCtb(file: Uint8Array) {
  const v = new DataView(file.buffer, file.byteOffset, file.byteLength)
  const magic = v.getUint32(0, true)
  const version = v.getUint32(4, true)
  const resX = v.getUint32(52, true)
  const resY = v.getUint32(56, true)
  const tableAt = v.getUint32(64, true)
  const count = v.getUint32(68, true)
  const seed = v.getUint32(100, true)
  const layers: { z: number; exposure: number; image: Uint8Array; exOk: boolean }[] = []
  for (let i = 0; i < count; i++) {
    const o = tableAt + i * LAYER_DEF
    const addr = v.getUint32(o + 12, true)
    const size = v.getUint32(o + 16, true)
    const image = file.slice(addr, addr + size)
    ctbCrypt(image, seed, i)
    const ex = addr - LAYER_DEF_EX
    const exOk = v.getUint32(ex + 12, true) === addr && v.getUint32(ex + 36, true) === LAYER_DEF_EX + size
    layers.push({ z: v.getFloat32(o, true), exposure: v.getFloat32(o + 4, true), image, exOk })
  }
  return { magic, version, resX, resY, count, seed, layers }
}
