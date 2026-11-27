// Run with: node tests/solidify.test.mts
import assert from 'node:assert/strict'
import * as THREE from 'three'
import Module from 'manifold-3d'
import { volumeOf, toManifold } from '../src/engine/geometry/csg.ts'
import { hollowSolid, rebuildSolid } from '../src/engine/geometry/solidify.ts'

const wasm = await Module()
wasm.setup()
let passed = 0
function test(name: string, fn: () => void) {
  try {
    const t = performance.now()
    fn()
    passed++
    console.log(`ok  ${name} (${Math.round(performance.now() - t)} ms)`)
  } catch (err) {
    console.error(`FAIL ${name}`)
    throw err
  }
}
const tri = (g: THREE.BufferGeometry) => new Float32Array(g.toNonIndexed().getAttribute('position').array)
const join = (...a: Float32Array[]) => {
  const o = new Float32Array(a.reduce((s, x) => s + x.length, 0))
  let i = 0
  for (const x of a) {
    o.set(x, i)
    i += x.length
  }
  return o
}

test('a box with a missing face is rebuilt closed, about the same volume', () => {
  const open = tri(new THREE.BoxGeometry(20, 20, 20)).slice(0, -18)
  const out = rebuildSolid(wasm, open, 0.5)
  const m = toManifold(wasm, out)
  m.delete()
  assert.ok(Math.abs(volumeOf(out) - 8000) < 8000 * 0.05, `volume ${volumeOf(out)}`)
})

test('two overlapping boxes become one solid with no inner walls', () => {
  const out = rebuildSolid(wasm, join(tri(new THREE.BoxGeometry(20, 20, 20)), tri(new THREE.BoxGeometry(20, 20, 20).translate(10, 0, 0))), 0.5)
  assert.ok(Math.abs(volumeOf(out) - 12000) < 12000 * 0.05, `volume ${volumeOf(out)}`)
})

test('hollowing a 30 mm cube with 2 mm walls leaves about 30³ − 26³', () => {
  const out = hollowSolid(wasm, tri(new THREE.BoxGeometry(30, 30, 30)), 2, 0.5)
  const want = 27000 - 26 ** 3
  assert.ok(Math.abs(volumeOf(out) - want) < want * 0.12, `volume ${volumeOf(out)} want ${want}`)
})

test('a part thinner than two walls cannot be hollowed', () => {
  assert.throws(() => hollowSolid(wasm, tri(new THREE.BoxGeometry(30, 30, 3)), 2, 0.5), /thicker/)
})

console.log(`\n${passed} solidify tests passed`)
