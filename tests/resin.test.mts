// Run with: node tests/resin.test.mts
import assert from 'node:assert/strict'
import { BoxGeometry, CylinderGeometry, TorusGeometry, TorusKnotGeometry } from 'three'
import { checksum, decodeLayer, GOO_HEADER_SIZE, LayerEncoder, readLayers } from '../src/engine/resin/goo.ts'
import { DEFAULT_RESIN, RESIN_PRINTERS, type ResinPrinter } from '../src/engine/resin/printers.ts'
import { ResinFitError, sliceResin } from '../src/engine/resin/slice.ts'
import { exposureTest, TEST_LEVELS } from '../src/engine/resin/exposureTest.ts'

let passed = 0
function test(name: string, fn: () => void) {
  try {
    fn()
    passed++
    console.log(`ok  ${name}`)
  } catch (err) {
    console.error(`FAIL ${name}`)
    throw err
  }
}

// A small test printer: 0.1 mm pixels so results are easy to reason about.
const tiny: ResinPrinter = { id: 't', name: 'Test', resX: 400, resY: 200, sizeX: 40, sizeY: 20, sizeZ: 50 }
const binary = { ...DEFAULT_RESIN, layerHeight: 0.1, antialias: false }

function geo(g: BoxGeometry | CylinderGeometry | TorusGeometry | TorusKnotGeometry, offset: [number, number, number] = [0, 0, 0]) {
  const n = g.toNonIndexed()
  n.translate(...offset)
  return new Float32Array(n.getAttribute('position').array)
}
const concat = (...a: Float32Array[]) => {
  const out = new Float32Array(a.reduce((s, x) => s + x.length, 0))
  let o = 0
  for (const x of a) {
    out.set(x, o)
    o += x.length
  }
  return out
}
const join = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((s, x) => s + x.length, 0))
  let o = 0
  for (const x of parts) {
    out.set(x, o)
    o += x.length
  }
  return out
}
/** Decodes one layer into a full image. */
function image(file: Uint8Array, n: number) {
  const { resX, resY, layers } = readLayers(file)
  const px = new Uint8Array(resX * resY)
  let at = 0
  decodeLayer(layers[n]!.image, (len, v) => {
    px.fill(v, at, at + len)
    at += len
  })
  return { px, count: at, resX, resY }
}
const lit = (px: Uint8Array) => px.reduce((s, v) => s + v / 255, 0)

test('RLE round-trips every run size and grey levels', () => {
  const enc = new LayerEncoder()
  const runs: [number, number][] = [
    [3, 0], [20, 255], [5000, 0], [1, 128], [1, 7], [300000, 255], [2_000_000, 0], [2, 200], [15, 255], [16, 0],
  ]
  for (const [l, v] of runs) enc.run(l, v)
  const data = enc.finish()
  const out: [number, number][] = []
  decodeLayer(data, (l, v) => out.push([l, v]))
  assert.deepEqual(out, runs)
  assert.equal(checksum(new Uint8Array([1, 2, 3])), ~6 & 0xff)
})

test('same-value runs merge, including across rows', () => {
  const enc = new LayerEncoder()
  enc.run(10, 0)
  enc.run(10, 0)
  enc.run(4, 255)
  const out: [number, number][] = []
  decodeLayer(enc.finish(), (l, v) => out.push([l, v]))
  assert.deepEqual(out, [[20, 0], [4, 255]])
})

test('a 10 mm cube slices to 100 layers of 100×100 lit pixels', () => {
  const r = sliceResin({ positions: geo(new BoxGeometry(10, 10, 10)), printer: tiny, settings: binary, softwareVersion: 'test' })
  assert.equal(r.layers, 100)
  const file = join(r.parts)
  assert.equal(file.length, r.bytes)
  const { layers, endingOk, resX, resY } = readLayers(file)
  assert.equal(resX, 400)
  assert.equal(resY, 200)
  assert.ok(endingOk)
  assert.equal(layers.length, 100)
  assert.ok(layers.every((l) => l.checksumOk))
  assert.equal(layers[0]!.exposure, binary.bottomExposure)
  assert.equal(layers[50]!.exposure, binary.exposure)
  assert.ok(Math.abs(layers[99]!.z - 10) < 1e-4)
  const { px, count } = image(file, 50)
  assert.equal(count, 400 * 200)
  assert.equal(lit(px), 100 * 100)
  // Centred on the plate: columns 150..249, rows 50..149.
  assert.equal(px[100 * 400 + 150], 255)
  assert.equal(px[100 * 400 + 149], 0)
  assert.equal(px[50 * 400 + 200], 255)
  assert.equal(px[49 * 400 + 200], 0)
  assert.ok(Math.abs(r.volumeMm3 - 1000) < 1)
})

test('header is the documented size', () => {
  const r = sliceResin({ positions: geo(new BoxGeometry(2, 2, 2)), printer: tiny, settings: binary, softwareVersion: 'test' })
  assert.equal(r.parts[0]!.length, GOO_HEADER_SIZE)
  assert.equal(new TextDecoder().decode(r.parts[0]!.subarray(0, 4)), 'V3.0')
})

test('overlapping parts merge (model plus support) and inside-out faces still fill', () => {
  const a = geo(new BoxGeometry(10, 10, 10))
  const b = geo(new BoxGeometry(10, 10, 10), [5, 0, 0])
  const r = sliceResin({ positions: concat(a, b), printer: tiny, settings: binary, softwareVersion: 'test' })
  assert.equal(lit(image(join(r.parts), 50).px), 150 * 100)
  // Reverse every triangle's winding.
  const inv = a.slice()
  for (let t = 0; t < inv.length; t += 9) for (let k = 0; k < 3; k++) [inv[t + 3 + k], inv[t + 6 + k]] = [inv[t + 6 + k]!, inv[t + 3 + k]!]
  const r2 = sliceResin({ positions: inv, printer: tiny, settings: binary, softwareVersion: 'test' })
  assert.equal(lit(image(join(r2.parts), 50).px), 100 * 100)
})

test('a hollow tube keeps its hole', () => {
  const outer = geo(new CylinderGeometry(8, 8, 10, 64).rotateX(Math.PI / 2))
  const inner = geo(new CylinderGeometry(4, 4, 10, 64).rotateX(Math.PI / 2))
  // Inner wall faces inward: flip it.
  for (let t = 0; t < inner.length; t += 9) for (let k = 0; k < 3; k++) [inner[t + 3 + k], inner[t + 6 + k]] = [inner[t + 6 + k]!, inner[t + 3 + k]!]
  // The caps of the two cylinders overlap; drop cap triangles (normals along z) and keep walls only.
  const walls = (p: Float32Array) => {
    const out: number[] = []
    for (let t = 0; t < p.length; t += 9) {
      const zs = [p[t + 2], p[t + 5], p[t + 8]]
      if (zs[0] === zs[1] && zs[1] === zs[2]) continue
      for (let k = 0; k < 9; k++) out.push(p[t + k]!)
    }
    return new Float32Array(out)
  }
  const r = sliceResin({ positions: concat(walls(outer), walls(inner)), printer: tiny, settings: binary, softwareVersion: 'test' })
  const { px } = image(join(r.parts), 50)
  assert.equal(px[100 * 400 + 200], 0, 'centre of the hole is dark')
  assert.equal(px[100 * 400 + 200 + 60], 255, 'the wall is lit')
  const area = lit(px) * 0.01
  assert.ok(Math.abs(area - Math.PI * (64 - 16)) < 2, `ring area ${area}`)
})

test('anti-aliasing adds grey edge pixels but keeps the area', () => {
  const pos = geo(new CylinderGeometry(5, 5, 4, 96).rotateX(Math.PI / 2))
  const r = sliceResin({ positions: pos, printer: tiny, settings: { ...binary, antialias: true }, softwareVersion: 'test' })
  const { px } = image(join(r.parts), 20)
  assert.ok(px.some((v) => v > 0 && v < 255))
  assert.ok(Math.abs(lit(px) * 0.01 - Math.PI * 25) < 0.5)
})

test('mirroring flips columns', () => {
  const pos = concat(geo(new BoxGeometry(10, 10, 10)), geo(new BoxGeometry(2, 2, 2), [7, 0, -4]))
  const a = image(join(sliceResin({ positions: pos, printer: tiny, settings: binary, softwareVersion: 't' }).parts), 5).px
  const b = image(join(sliceResin({ positions: pos, printer: tiny, settings: { ...binary, mirror: true }, softwareVersion: 't' }).parts), 5).px
  for (let r = 0; r < 200; r += 7) for (let c = 0; c < 400; c += 3) assert.equal(a[r * 400 + c], b[r * 400 + 399 - c])
})

test('models that do not fit are refused with a helpful note', () => {
  assert.throws(
    () => sliceResin({ positions: geo(new BoxGeometry(15, 35, 5)), printer: tiny, settings: binary, softwareVersion: 't' }),
    (e: Error) => e instanceof ResinFitError && /Turning it 90°/.test(e.message),
  )
  assert.throws(() => sliceResin({ positions: geo(new BoxGeometry(5, 5, 60)), printer: tiny, settings: binary, softwareVersion: 't' }), ResinFitError)
})

test('a block floating above a pillar is one island at the layer it starts', () => {
  const pillar = geo(new BoxGeometry(4, 4, 10), [-8, 0, 5])
  const floating = geo(new BoxGeometry(4, 4, 4), [8, 0, 8])
  const r = sliceResin({ positions: concat(pillar, floating), printer: tiny, settings: binary, softwareVersion: 't' })
  assert.equal(r.islandCount, 1)
  const isl = r.islands[0]!
  assert.equal(isl.layer, 60)
  assert.ok(Math.abs(isl.x - 8) < 0.1 && Math.abs(isl.y) < 0.1, `at ${isl.x},${isl.y}`)
  assert.ok(Math.abs(isl.z - 6.05) < 0.06, `z ${isl.z}`)
  assert.ok(Math.abs(isl.areaMm2 - 16) < 0.5, `area ${isl.areaMm2}`)
})

test('overhangs, arches and a T shape are not islands', () => {
  const stem = geo(new BoxGeometry(2, 2, 8), [0, 0, 4])
  const bar = geo(new BoxGeometry(16, 2, 2), [0, 0, 9])
  const t = sliceResin({ positions: concat(stem, bar), printer: tiny, settings: binary, softwareVersion: 't' })
  assert.equal(t.islandCount, 0)
  const ring = geo(new TorusGeometry(6, 1.5, 24, 96).rotateX(Math.PI / 2))
  const k = sliceResin({ positions: ring, printer: tiny, settings: binary, softwareVersion: 't' })
  assert.equal(k.islandCount, 0, 'an upright ring is an arch, held up from below')
  // Upside-down bowl rim: a ring lying flat on top of a thin post starts mid-air on both sides.
  const post = geo(new BoxGeometry(1, 1, 6), [0, 0, 3])
  const flat = geo(new TorusGeometry(6, 1, 16, 96), [0, 0, 7])
  const f = sliceResin({ positions: concat(post, flat), printer: tiny, settings: binary, softwareVersion: 't' })
  assert.equal(f.islandCount, 1, 'a flat ring above a post is one island')
})

test('two floating parts in the same layer are two islands', () => {
  const base = geo(new BoxGeometry(2, 2, 2), [0, 0, 1])
  const a = geo(new BoxGeometry(3, 3, 3), [-10, 0, 6])
  const b = geo(new BoxGeometry(3, 3, 3), [10, 0, 6])
  const r = sliceResin({ positions: concat(base, a, b), printer: tiny, settings: binary, softwareVersion: 't' })
  assert.equal(r.islandCount, 2)
  assert.deepEqual(r.islands.map((i) => i.layer), [45, 45])
})

test('exposure test: five pieces at stepped grey levels with pins, holes and counting dots', () => {
  const pr: ResinPrinter = { id: 'e', name: 'Exp', resX: 1200, resY: 400, sizeX: 120, sizeY: 40, sizeZ: 50 }
  const r = exposureTest(pr, { ...DEFAULT_RESIN, exposure: 2, layerHeight: 0.05 }, 't')
  assert.deepEqual(r.times, TEST_LEVELS.map((f) => Math.round(2 * f * 10) / 10))
  assert.equal(r.layers, 100)
  const file = join(r.parts)
  const { layers, endingOk } = readLayers(file)
  assert.ok(endingOk && layers.every((l) => l.checksumOk))
  assert.ok(Math.abs(layers[60]!.exposure - 2.8) < 1e-5, 'feature layers use the longest time')
  const { px, count } = image(file, 60)
  assert.equal(count, 1200 * 400)
  // Pieces are 10 mm (100 px) with 3 mm gaps, centred: 62 mm wide in all, so the first starts at column 290.
  const greys = new Set<number>()
  for (let i = 0; i < 5; i++) {
    const c0 = 290 + i * 130
    // Frame pixel near the piece's left edge, middle row.
    greys.add(px[200 * 1200 + c0 + 3]!)
    // Counting dots: v = 1.2..1.8 mm up from the piece bottom (rows 232-237), one per index.
    let dots = 0
    for (let k = 0; k < 5; k++) if (px[234 * 1200 + c0 + 19 + k * 11]) dots++
    assert.equal(dots, i + 1, `piece ${i} dots`)
  }
  assert.deepEqual([...greys], TEST_LEVELS.map((f) => Math.round((255 * f) / 1.4)))
  // The 0.9 mm hole in the block is open, its neighbourhood solid (piece 3, centre at u=8, v=6.8).
  const c0 = 290 + 2 * 130
  assert.equal(px[181 * 1200 + c0 + 80], 0)
  assert.ok(px[181 * 1200 + c0 + 70]! > 0)
  // Base layers are solid at full brightness.
  const base = image(file, 5).px
  assert.equal(base[200 * 1200 + c0 + 50], 255)
})

test('a 12K knot slices in reasonable time', () => {
  const pr = RESIN_PRINTERS.find((p) => p.id === 'saturn4ultra')!
  const pos = geo(new TorusKnotGeometry(15, 5, 256, 32), [0, 0, 0])
  const t0 = performance.now()
  const r = sliceResin({ positions: pos, printer: pr, settings: DEFAULT_RESIN, softwareVersion: 't' })
  const ms = performance.now() - t0
  const { layers } = readLayers(join(r.parts))
  assert.ok(layers.every((l) => l.checksumOk))
  const { count } = image(join(r.parts), Math.floor(r.layers / 2))
  assert.equal(count, pr.resX * pr.resY)
  console.log(`    ${r.layers} layers, ${(r.bytes / 1e6).toFixed(1)} MB, ${ms.toFixed(0)} ms, ${(r.volumeMm3 / 1000).toFixed(1)} ml`)
})

console.log(`\n${passed} resin tests passed`)
