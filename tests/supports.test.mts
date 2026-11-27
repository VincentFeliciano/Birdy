// Run with: node tests/supports.test.mts
import assert from 'node:assert/strict'
import { BoxGeometry, TorusGeometry, TorusKnotGeometry } from 'three'
import { DEFAULT_RESIN, type ResinPrinter } from '../src/engine/resin/printers.ts'
import { sliceResin } from '../src/engine/resin/slice.ts'
import { DEFAULT_SUPPORTS, generateSupports } from '../src/engine/resin/supports.ts'
import { sliceSupported } from '../src/engine/resin/pipeline.ts'

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

const printer: ResinPrinter = { id: 't', name: 'Test', resX: 600, resY: 400, sizeX: 60, sizeY: 40, sizeZ: 60 }
const settings = { ...DEFAULT_RESIN, layerHeight: 0.1, antialias: false }
const on = { ...DEFAULT_SUPPORTS, enabled: true }

function geo(g: BoxGeometry | TorusGeometry | TorusKnotGeometry, offset: [number, number, number] = [0, 0, 0]) {
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
/** Signed volume by the divergence theorem: positive for closed, outward-facing solids. */
function volume(p: Float32Array) {
  let v = 0
  for (let o = 0; o < p.length; o += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = p.subarray(o, o + 9)
    v += (ax! * (by! * cz! - bz! * cy!) - ay! * (bx! * cz! - bz! * cx!) + az! * (bx! * cy! - by! * cx!)) / 6
  }
  return v
}
const minZ = (p: Float32Array) => {
  let m = Infinity
  for (let i = 2; i < p.length; i += 3) m = Math.min(m, p[i]!)
  return m
}

test('supports are closed, outward-facing solids', () => {
  const r = generateSupports(geo(new BoxGeometry(10, 10, 10), [0, 0, 5]), on)
  assert.ok(r.count >= 9, `count ${r.count}`)
  assert.ok(volume(r.supports) > 0)
  assert.equal(r.onModel, 0)
})

test('the model is lifted and everything stands on the plate', () => {
  const r = generateSupports(geo(new BoxGeometry(10, 10, 10), [0, 0, 5]), { ...on, lift: 6 })
  const model = r.positions.subarray(0, r.positions.length - r.supports.length)
  assert.ok(Math.abs(minZ(model) - 6) < 1e-4)
  assert.ok(Math.abs(minZ(r.supports) + 0.15) < 0.2, `support bottom ${minZ(r.supports)}`)
})

test('a ring hanging over a post has an island without supports and none with them', () => {
  const ring = geo(new TorusGeometry(8, 1.5, 16, 48), [0, 0, 12])
  const post = geo(new BoxGeometry(2, 2, 9), [8, 0, 4.5])
  const model = concat(ring, post)
  const bare = sliceResin({ positions: model, printer, settings, softwareVersion: 'test' })
  assert.ok(bare.islandCount >= 1, `bare islands ${bare.islandCount}`)
  const r = generateSupports(model, on)
  const held = sliceResin({ positions: r.positions, printer, settings, softwareVersion: 'test' })
  assert.equal(held.islandCount, 0)
  assert.ok(held.volumeMm3 > bare.volumeMm3)
})

test('a shelf above part of the model gets supports standing on the model', () => {
  const base = geo(new BoxGeometry(30, 10, 2), [0, 0, 1])
  const wall = geo(new BoxGeometry(2, 10, 14), [-14, 0, 9])
  const shelf = geo(new BoxGeometry(30, 10, 2), [0, 0, 15])
  const r = generateSupports(concat(base, wall, shelf), on)
  assert.ok(r.onModel > 0, `on model ${r.onModel}`)
  assert.ok(r.count > r.onModel)
})

test('settings are clamped to sane ranges', () => {
  const r = generateSupports(geo(new BoxGeometry(10, 10, 10), [0, 0, 5]), { ...on, lift: 500, spacing: 0.01, tip: 9 })
  assert.equal(r.lift, 30)
  assert.ok(r.count < 200)
})

const hollow = { wall: 2, drain: false, diameter: 3, holes: 1 }
const cube20 = () => geo(new BoxGeometry(20, 20, 20), [0, 0, 10])

test('hollowing leaves walls of the chosen thickness', () => {
  const solid = sliceResin({ positions: cube20(), printer, settings, softwareVersion: 'test' })
  const hol = sliceResin({ positions: cube20(), printer, settings, softwareVersion: 'test', hollow })
  const shell = 20 ** 3 - 16 ** 3
  assert.ok(Math.abs(solid.volumeMm3 - 8000) < 80, `solid ${solid.volumeMm3}`)
  assert.ok(hol.volumeMm3 > shell * 0.98 && hol.volumeMm3 < shell * 1.25, `hollow ${hol.volumeMm3} vs ${shell}`)
  assert.ok(hol.hollow?.cavity)
  assert.ok(Math.abs(hol.hollow!.savedMm3 - (solid.volumeMm3 - hol.volumeMm3)) < 1)
  assert.equal(hol.islandCount, 0)
})

test('parts thinner than two walls stay solid', () => {
  const bar = geo(new BoxGeometry(30, 3.5, 10), [0, 0, 5])
  const a = sliceResin({ positions: bar, printer, settings, softwareVersion: 'test' })
  const b = sliceResin({ positions: bar, printer, settings, softwareVersion: 'test', hollow })
  assert.equal(b.volumeMm3, a.volumeMm3)
  assert.equal(b.hollow?.cavity, false)
})

test('drain holes open through the floor when the model is lifted, not into the plate', () => {
  const flat = sliceResin({ positions: cube20(), printer, settings, softwareVersion: 'test', hollow: { ...hollow, drain: true } })
  assert.equal(flat.hollow?.holes, 0)
  assert.equal(flat.hollow?.blocked, 1)
  const lifted = generateSupports(cube20(), on)
  const noHole = sliceResin({ positions: lifted.positions, printer, settings, softwareVersion: 'test', hollow })
  const withHole = sliceResin({ positions: lifted.positions, printer, settings, softwareVersion: 'test', hollow: { ...hollow, drain: true } })
  assert.equal(withHole.hollow?.holes, 1)
  // A 3 mm hole through a ~2 mm floor removes roughly π·1.5²·2 ≈ 14 mm³.
  const removed = noHole.volumeMm3 - withHole.volumeMm3
  assert.ok(removed > 8 && removed < 40, `removed ${removed}`)
  assert.equal(withHole.islandCount, 0)
})

test('a drain hole on a supported, hollowed knot moves the pins aside and leaves no islands', () => {
  const big: ResinPrinter = { id: 'b', name: 'Big', resX: 2400, resY: 2400, sizeX: 96, sizeY: 96, sizeZ: 80 }
  const knot = geo(new TorusKnotGeometry(16, 6, 160, 24, 2, 3))
  const job = { printer: big, settings: { ...settings, layerHeight: 0.05 }, softwareVersion: 'test', hollow: { wall: 2, drain: true, diameter: 3, holes: 1 } }
  const out = sliceSupported(job, knot, on)
  assert.equal(out.hollow?.holes, 1)
  const [hx, hy] = out.hollow!.centres[0]!
  const c = out.support!.contacts
  for (let i = 0; i < c.length; i += 2) assert.ok(Math.hypot(c[i]! - hx, c[i + 1]! - hy) > 1.5, 'no pin inside the hole')
  assert.equal(out.islandCount, 0, JSON.stringify(out.islands.slice(0, 3)))
})

console.log(`\n${passed} support and hollowing tests passed`)
