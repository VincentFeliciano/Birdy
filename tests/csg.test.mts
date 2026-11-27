// Run with: node tests/csg.test.mts
import assert from 'node:assert/strict'
import * as THREE from 'three'
import Module from 'manifold-3d'
import { booleanOp, CsgError, cutByPlane, simplifySolid, volumeOf } from '../src/engine/geometry/csg.ts'

const wasm = await Module()
wasm.setup()
let passed = 0
async function test(name: string, fn: () => void) {
  try {
    fn()
    passed++
    console.log(`ok  ${name}`)
  } catch (err) {
    console.error(`FAIL ${name}`)
    throw err
  }
}
const tri = (g: THREE.BufferGeometry) => new Float32Array(g.toNonIndexed().getAttribute('position').array)
const a = tri(new THREE.BoxGeometry(20, 20, 20))
const b = tri(new THREE.BoxGeometry(20, 20, 20).translate(10, 0, 0))
const near = (x: number, y: number, tol = 0.01) => Math.abs(x - y) <= Math.abs(y) * tol + 1e-6

await test('union of two overlapping boxes is 20 x 20 x 30 worth of volume', () => {
  assert.ok(near(volumeOf(booleanOp(wasm, 'union', [a, b])), 12000))
})
await test('difference keeps the part of the first not in the second', () => {
  assert.ok(near(volumeOf(booleanOp(wasm, 'difference', [a, b])), 4000))
})
await test('intersection keeps only the shared volume', () => {
  assert.ok(near(volumeOf(booleanOp(wasm, 'intersect', [a, b])), 4000))
})
await test('boxes that do not touch have no intersection', () => {
  const far = tri(new THREE.BoxGeometry(5, 5, 5).translate(50, 0, 0))
  assert.throws(() => booleanOp(wasm, 'intersect', [a, far]), CsgError)
})
await test('an open mesh is refused with a clear message', () => {
  assert.throws(() => booleanOp(wasm, 'union', [a.slice(0, -18), b]), /closed solid/)
})
await test('a plane cut gives two closed halves that add up', () => {
  const [up, down] = cutByPlane(wasm, a, [0, 0, 1], 4)
  assert.ok(near(volumeOf(up), 20 * 20 * 6))
  assert.ok(near(volumeOf(down), 20 * 20 * 14))
  let top = -Infinity
  for (let i = 2; i < down.length; i += 3) top = Math.max(top, down[i]!)
  assert.ok(Math.abs(top - 4) < 1e-4)
})
await test('a plane that misses leaves one side empty', () => {
  const [up, down] = cutByPlane(wasm, a, [0, 0, 1], 50)
  assert.equal(up.length, 0)
  assert.ok(near(volumeOf(down), 8000))
})
await test('simplify drops triangles on a dense sphere and keeps its volume', () => {
  const s = tri(new THREE.SphereGeometry(10, 96, 64))
  const out = simplifySolid(wasm, s, 0.05)
  assert.ok(out.length < s.length * 0.8, `${out.length / 9} of ${s.length / 9}`)
  assert.ok(near(volumeOf(out), volumeOf(s), 0.02))
})
console.log(`\n${passed} csg tests passed`)
