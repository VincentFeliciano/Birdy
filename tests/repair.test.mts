// Run with: node tests/repair.test.mts
import assert from 'node:assert/strict'
import { BoxGeometry, ExtrudeGeometry, Shape } from 'three'
import { checkPrintability } from '../src/engine/geometry/printCheck.ts'
import { describeRepair, repairMesh } from '../src/engine/geometry/repair.ts'

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

const bed = { x: 256, y: 256, z: 256 }
const check = (positions: Float32Array) => checkPrintability({ positions, bed, fileWarnings: [], isPointCloud: false })

/** Outward-facing 20 mm cube resting on the plate, as non-indexed triangles. */
function cube(size = 20, offset: [number, number, number] = [0, 0, size / 2]) {
  const g = new BoxGeometry(size, size, size).toNonIndexed()
  g.translate(...offset)
  return new Float32Array(g.getAttribute('position').array)
}
const tris = (p: Float32Array) => p.length / 9
const without = (p: Float32Array, drop: number[]) => {
  const out: number[] = []
  for (let t = 0; t < tris(p); t++) if (!drop.includes(t)) out.push(...p.subarray(t * 9, t * 9 + 9))
  return new Float32Array(out)
}
const flip = (p: Float32Array, faces: number[]) => {
  const q = p.slice()
  for (const t of faces) {
    for (let k = 0; k < 3; k++) {
      q[t * 9 + 3 + k] = p[t * 9 + 6 + k]!
      q[t * 9 + 6 + k] = p[t * 9 + 3 + k]!
    }
  }
  return q
}
const concat = (...ps: Float32Array[]) => {
  const out = new Float32Array(ps.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of ps) {
    out.set(p, o)
    o += p.length
  }
  return out
}
const codes = (p: Float32Array) => check(p).issues.map((i) => i.code)

test('a clean cube comes back unchanged', () => {
  const r = repairMesh(cube())
  assert.equal(r.summary.trianglesAfter, 12)
  assert.equal(r.summary.holesFilled + r.summary.flippedFaces + r.summary.invertedParts + r.summary.removedDuplicates, 0)
  assert.equal(check(r.positions).verdict, 'ready')
  assert.match(describeRepair(r.summary), /Nothing to repair/)
})

test('fills a missing side (square hole)', () => {
  const broken = without(cube(), [0, 1])
  assert.ok(codes(broken).includes('holes'))
  const r = repairMesh(broken)
  assert.equal(r.summary.holesFilled, 1)
  assert.equal(r.summary.facesAdded, 2)
  const c = check(r.positions)
  assert.ok(c.stats.watertight)
  assert.ok(!codes(r.positions).includes('inverted'))
  assert.ok(Math.abs(c.stats.volumeCm3! - 8) < 1e-3)
})

test('fills a concave hole flat (L-shaped prism with no bottom)', () => {
  const L = new Shape()
  L.moveTo(0, 0).lineTo(30, 0).lineTo(30, 10).lineTo(10, 10).lineTo(10, 30).lineTo(0, 30).lineTo(0, 0)
  const g = new ExtrudeGeometry(L, { depth: 10, bevelEnabled: false }).toNonIndexed()
  const full = new Float32Array(g.getAttribute('position').array)
  const bottom: number[] = []
  for (let t = 0; t < tris(full); t++) if ([2, 5, 8].every((k) => Math.abs(full[t * 9 + k]!) < 1e-6)) bottom.push(t)
  assert.equal(bottom.length, 4)
  const r = repairMesh(without(full, bottom))
  assert.equal(r.summary.holesFilled, 1)
  assert.equal(r.summary.facesAdded, 4, 'ear-clipped, not fanned from a centre outside the shape')
  const c = check(r.positions)
  assert.ok(c.stats.watertight)
  assert.ok(Math.abs(c.stats.volumeCm3! - 5) < 1e-3, `volume ${c.stats.volumeCm3}`)
})

test('makes flipped faces agree with their neighbours', () => {
  const broken = flip(cube(), [3, 7])
  assert.ok(codes(broken).includes('flipped'))
  const r = repairMesh(broken)
  assert.equal(r.summary.flippedFaces, 2)
  assert.ok(!codes(r.positions).includes('flipped'))
  assert.ok(check(r.positions).stats.watertight)
})

test('turns an inside-out model right side out', () => {
  const broken = flip(cube(), [...Array(12).keys()])
  assert.ok(codes(broken).includes('inverted'))
  const r = repairMesh(broken)
  assert.equal(r.summary.invertedParts, 1)
  assert.ok(!codes(r.positions).includes('inverted'))
})

test('keeps a deliberate cavity (hollow cube) as it is', () => {
  const inner = flip(cube(10, [0, 0, 10]), [...Array(12).keys()])
  const r = repairMesh(concat(cube(), inner))
  assert.equal(r.summary.invertedParts, 0)
  assert.ok(Math.abs(check(r.positions).stats.volumeCm3! - 7) < 1e-3)
})

test('welds hairline cracks between faces', () => {
  const p = cube()
  // Nudge one copy of a shared corner by 0.0004 mm: the check sees open edges.
  for (let i = 0; i < p.length; i += 3) {
    if (p[i] === 10 && p[i + 1] === 10 && p[i + 2] === 20) {
      p[i] += 0.0004
      break
    }
  }
  assert.ok(!check(p).stats.watertight)
  const r = repairMesh(p)
  assert.ok(check(r.positions).stats.watertight)
  assert.equal(r.summary.facesAdded, 0)
})

test('welds points that straddle a weld-grid line', () => {
  // 0.0005 sits on the grid line between cells; the copies land in different cells.
  const p = cube(20, [0.0005 - 10, 0, 10])
  for (let i = 0; i < p.length; i += 3) {
    if (Math.abs(p[i]! - 0.0005) < 1e-7 && p[i + 1] === 10 && p[i + 2] === 20) {
      p[i] = 0.00049
      break
    }
  }
  const r = repairMesh(p)
  assert.ok(check(r.positions).stats.watertight)
  assert.equal(r.summary.facesAdded, 0)
})

test('removes corrupt, zero-area and duplicate triangles', () => {
  const c = cube()
  const nan = new Float32Array(9).fill(Number.NaN)
  const flat = new Float32Array([0, 0, 0, 1, 1, 1, 2, 2, 2])
  const dupe = c.slice(0, 9)
  const r = repairMesh(concat(c, nan, flat, dupe))
  assert.equal(r.summary.removedInvalid, 1)
  assert.equal(r.summary.removedDegenerate, 1)
  assert.equal(r.summary.removedDuplicates, 1)
  assert.equal(r.summary.trianglesAfter, 12)
  assert.equal(check(r.positions).verdict, 'ready')
})

test('removes internal double walls (a face and its exact reverse)', () => {
  const c = cube()
  const wall = new Float32Array([-5, -5, 10, 5, -5, 10, 5, 5, 10])
  const r = repairMesh(concat(c, wall, flip(wall, [0])))
  assert.equal(r.summary.removedDuplicates, 2)
  assert.equal(r.summary.trianglesAfter, 12)
})

test('reports touching parts it cannot separate', () => {
  // Two cubes sharing one edge: four faces meet there.
  const r = repairMesh(concat(cube(), cube(20, [20, 20, 10])))
  assert.ok(r.summary.remainingNonManifoldEdges > 0)
  assert.match(describeRepair(r.summary), /more than two faces/)
})

console.log(`\n${passed} repair tests passed`)
