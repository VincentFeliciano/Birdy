// Run with: node tests/analysis.test.mts
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { checkPrintability } from '../src/engine/geometry/printCheck.ts'

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
const tris = (...gs: THREE.BufferGeometry[]) => {
  const parts = gs.map((g) => new Float32Array((g.index ? g.toNonIndexed() : g).getAttribute('position').array))
  const out = new Float32Array(parts.reduce((s, x) => s + x.length, 0))
  let o = 0
  for (const x of parts) {
    out.set(x, o)
    o += x.length
  }
  return out
}
const check = (p: Float32Array, minWall?: number) => checkPrintability({ positions: p, bed: { x: 256, y: 256, z: 256 }, fileWarnings: [], isPointCloud: false, minWall })

test('a clean box: no crossings, no thin walls, vertex count', () => {
  const r = check(tris(new THREE.BoxGeometry(20, 20, 20).translate(0, 0, 10)))
  assert.equal(r.stats.vertices, 8)
  assert.equal(r.stats.intersecting, 0)
  assert.equal(r.stats.overlappingParts, 0)
  assert.equal(r.stats.thinPct, 0)
  assert.ok(!r.issues.some((i) => i.code === 'intersect' || i.code === 'thin'))
})

test('two separate boxes passing into each other are an overlapping pair', () => {
  const r = check(tris(new THREE.BoxGeometry(20, 20, 20).translate(0, 0, 10), new THREE.BoxGeometry(20, 20, 20).translate(10, 5, 10)))
  assert.equal(r.stats.components, 2)
  assert.equal(r.stats.overlappingParts, 1)
  assert.equal(r.stats.intersecting, 0)
  assert.ok(r.issues.some((i) => i.code === 'overlap'))
})

test('one surface folding through itself is found and marked', () => {
  // A box whose top corner is pulled down through the bottom: the moved faces pierce the floor.
  const g = new THREE.BoxGeometry(20, 20, 20).translate(0, 0, 10).toNonIndexed()
  const pos = g.getAttribute('position') as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) if (pos.getX(i) > 9 && pos.getY(i) > 9 && pos.getZ(i) > 19) pos.setZ(i, -8)
  const r = check(new Float32Array(pos.array))
  assert.ok((r.stats.intersecting ?? 0) > 0, `intersecting ${r.stats.intersecting}`)
  assert.ok(r.marks?.intersectFaces?.length)
  assert.ok(r.issues.some((i) => i.code === 'intersect' && i.mark === 'intersectFaces'))
})

test('a 0.5 mm plate is a thin wall; a 5 mm one is not', () => {
  const thin = check(tris(new THREE.BoxGeometry(30, 30, 0.5).translate(0, 0, 0.25)))
  assert.ok((thin.stats.thinPct ?? 0) > 90, `thin ${thin.stats.thinPct}`)
  assert.ok(Math.abs((thin.stats.thinnest ?? 0) - 0.5) < 0.01)
  assert.ok(thin.issues.some((i) => i.code === 'thin' && i.level === 'warn'))
  const thick = check(tris(new THREE.BoxGeometry(30, 30, 5).translate(0, 0, 2.5)))
  assert.equal(thick.stats.thinPct, 0)
  const resin = check(tris(new THREE.BoxGeometry(30, 30, 0.5).translate(0, 0, 0.25)), 0.4)
  assert.equal(resin.stats.thinPct, 0)
})

test('an open mesh is not measured for thickness', () => {
  const g = new THREE.BoxGeometry(20, 20, 20).toNonIndexed()
  const p = new Float32Array(g.getAttribute('position').array).slice(0, -18)
  assert.equal(check(p).stats.thinPct, null)
})

console.log(`\n${passed} analysis tests passed`)
