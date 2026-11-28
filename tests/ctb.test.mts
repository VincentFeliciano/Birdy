// Run with: node tests/ctb.test.mts
import assert from 'node:assert/strict'
import { TorusKnotGeometry } from 'three'
import { CtbLayerEncoder, ctbCrypt, ctbPreview, decodeCtbLayer, gooToCtb, readCtb } from '../src/engine/resin/ctb.ts'
import { decodeLayer, readLayers } from '../src/engine/resin/goo.ts'
import { DEFAULT_RESIN, formatOf, RESIN_PRINTERS, type ResinPrinter } from '../src/engine/resin/printers.ts'
import { sliceResin } from '../src/engine/resin/slice.ts'

let passed = 0
function test(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`ok  ${name}`)
}

const join = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((s, x) => s + x.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}
const runsOf = (decode: (run: (n: number, v: number) => void) => void) => {
  const out: number[] = []
  decode((n, v) => out.push(n, v))
  return out
}
/** Expands runs to pixels so differently merged runs compare equal. */
const pixels = (decode: (run: (n: number, v: number) => void) => void, total: number) => {
  const px = new Uint8Array(total)
  let o = 0
  decode((n, v) => {
    px.fill(v, o, o + n)
    o += n
  })
  assert.equal(o, total, 'runs cover the whole screen')
  return px
}

test('run lengths use 1 to 4 length bytes', () => {
  for (const len of [1, 2, 0x7f, 0x80, 0x3fff, 0x4000, 0x1fffff, 0x200000, 5_000_000]) {
    const enc = new CtbLayerEncoder()
    enc.run(len, 255)
    enc.run(3, 0)
    assert.deepEqual(runsOf((r) => decodeCtbLayer(enc.finish(), r)).slice(0, 2), len === 1 ? [1, 255] : [len, 255], `length ${len}`)
  }
})

test('grey is kept to 7 bits; black stays black and white stays white', () => {
  const enc = new CtbLayerEncoder()
  enc.run(4, 0)
  enc.run(1, 128)
  enc.run(2, 255)
  enc.run(1, 254)
  assert.deepEqual(runsOf((r) => decodeCtbLayer(enc.finish(), r)), [4, 0, 1, 129, 3, 255])
})

test('scrambling is undone by scrambling again, and depends on the layer', () => {
  const data = new Uint8Array(23).map((_, i) => i * 7)
  const a = data.slice()
  ctbCrypt(a, 0x12345678, 3)
  assert.notDeepEqual(a, data)
  const b = data.slice()
  ctbCrypt(b, 0x12345678, 4)
  assert.notDeepEqual(a, b)
  ctbCrypt(a, 0x12345678, 3)
  assert.deepEqual(a, data)
  const plain = data.slice()
  ctbCrypt(plain, 0, 3)
  assert.deepEqual(plain, data, 'key 0 means not scrambled')
})

test('preview: runs of one colour are coded as a word plus a count', () => {
  const rgba = new Uint8ClampedArray(4 * 4 * 4).fill(255)
  const img = ctbPreview(rgba, 4)
  const v = new DataView(img.buffer)
  assert.equal(img.length, 4)
  assert.equal(v.getUint16(0, true), 0xffdf | 0x20, 'white (0xffdf) with the run bit (0x20) set')
  assert.equal(v.getUint16(2, true), 15 | 0x3000, '16 pixels: count 15')
})

test('a sliced model converts to .ctb with every layer identical (to 7-bit grey)', () => {
  const printer: ResinPrinter = { id: 't', name: 'Test Printer', resX: 400, resY: 200, sizeX: 40, sizeY: 20, sizeZ: 50, format: 'ctb' }
  const settings = { ...DEFAULT_RESIN, layerHeight: 0.1, bottomLayers: 3 }
  const knot = new TorusKnotGeometry(5, 1.5, 64, 12).toNonIndexed()
  knot.translate(0, 0, 8)
  const out = sliceResin({ positions: new Float32Array(knot.getAttribute('position').array), printer, settings, softwareVersion: 'test' })
  const goo = readLayers(join(out.parts))
  const ctbParts = gooToCtb(
    out.parts,
    { printer, settings, layers: out.layers, printSeconds: out.printSeconds, volumeMm3: out.volumeMm3, weightG: out.weightG, softwareVersion: 'test', date: new Date(0) },
    0x2468ace,
  )
  const file = join(ctbParts)
  const ctb = readCtb(file)
  assert.equal(ctb.magic, 0x12fd0086)
  assert.equal(ctb.version, 3)
  assert.equal(ctb.resX, 400)
  assert.equal(ctb.resY, 200)
  assert.equal(ctb.count, out.layers)
  assert.equal(ctb.seed, 0x2468ace)
  const total = printer.resX * printer.resY
  let lit = 0
  for (let i = 0; i < ctb.count; i++) {
    const c = ctb.layers[i]!
    assert.ok(c.exOk, `layer ${i}: its own settings block points at its image`)
    assert.ok(Math.abs(c.z - goo.layers[i]!.z) < 1e-6)
    assert.equal(c.exposure, i < 3 ? settings.bottomExposure : settings.exposure)
    const want = pixels((r) => decodeLayer(goo.layers[i]!.image, r), total).map((v) => (v >> 1 ? ((v >> 1) << 1) | 1 : 0))
    const got = pixels((r) => decodeCtbLayer(c.image, r), total)
    assert.deepEqual(got, want, `layer ${i}`)
    lit += got.reduce((s, v) => s + (v ? 1 : 0), 0)
  }
  assert.ok(lit > 1000, 'the model is actually in the layers')
  // Header numbers
  const v = new DataView(file.buffer)
  assert.ok(Math.abs(v.getFloat32(32, true) - 0.1) < 1e-6, 'layer height')
  assert.equal(v.getUint32(48, true), 3, 'bottom layers')
})

test('printers that read .ctb are marked; the Elegoo .goo ones are unchanged', () => {
  assert.equal(formatOf(RESIN_PRINTERS.find((p) => p.id === 'saturn4ultra')!), 'goo')
  assert.equal(formatOf(RESIN_PRINTERS.find((p) => p.id === 'saturn2')!), 'ctb')
  assert.ok(RESIN_PRINTERS.filter((p) => formatOf(p) === 'ctb').every((p) => p.resX > p.resY && p.sizeX > p.sizeY), 'long side is X, like the .goo printers')
})

console.log(`${passed} ctb tests passed`)
