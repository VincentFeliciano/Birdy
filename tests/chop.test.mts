// Run with: node tests/chop.test.mts
import assert from 'node:assert/strict'
import * as THREE from 'three'
import Module from 'manifold-3d'
import { chop } from '../src/engine/geometry/chop.ts'
import { volumeOf } from '../src/engine/geometry/csg.ts'

const wasm = await Module()
wasm.setup()
let passed = 0
function test(name: string, fn: () => void) {
  const t0 = performance.now()
  try {
    fn()
    passed++
    console.log(`ok  ${name} (${Math.round(performance.now() - t0)} ms)`)
  } catch (err) {
    console.error(`FAIL ${name}`)
    throw err
  }
}
const tri = (g: THREE.BufferGeometry) => new Float32Array(g.toNonIndexed().getAttribute('position').array)
const ext = (p: Float32Array) => {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(p, 3))
  g.computeBoundingBox()
  return g.boundingBox!.getSize(new THREE.Vector3())
}
const fitsBed = (p: Float32Array, bed: number[]) => {
  const e = ext(p)
  const s = [e.x, e.y, e.z].sort((a, b) => b - a)
  const b = [...bed].sort((a, c) => c - a)
  return s.every((v, i) => v <= b[i]! + 0.01)
}
const bed: [number, number, number] = [200, 200, 200]

test('grid: a 500 x 150 x 100 bar becomes 3 even pieces that fit', () => {
  const bar = tri(new THREE.BoxGeometry(500, 150, 100))
  const r = chop(wasm, bar, { bed, mode: 'grid', joiner: 'none' })
  assert.equal(r.pieces.length, 3)
  for (const p of r.pieces) {
    assert.ok(fitsBed(p.tris, bed))
    assert.ok(Math.abs(ext(p.tris).x - 500 / 3) < 0.1, 'even lengths, no sliver')
  }
  const total = r.pieces.reduce((s, p) => s + volumeOf(p.tris), 0)
  assert.ok(Math.abs(total - 500 * 150 * 100) < 1)
})

test('smart: a 380 mm bar needs only 2 pieces, standing pieces up is allowed', () => {
  const bar = tri(new THREE.BoxGeometry(380, 60, 60))
  const r = chop(wasm, bar, { bed, mode: 'smart', joiner: 'none' })
  assert.equal(r.pieces.length, 2)
  assert.equal(r.oversize, 0)
})

test('smart: a big sphere fits in as few pieces as the box estimate allows', () => {
  const ball = tri(new THREE.SphereGeometry(170, 48, 32))
  const r = chop(wasm, ball, { bed, mode: 'smart', joiner: 'none' })
  for (const p of r.pieces) assert.ok(fitsBed(p.tris, bed))
  assert.ok(r.pieces.length <= 8, `${r.pieces.length} pieces`)
})

test('pegs: a peg on one side, a socket with clearance on the other', () => {
  const bar = tri(new THREE.BoxGeometry(300, 40, 40))
  const r = chop(wasm, bar, { bed, mode: 'grid', joiner: 'pegs', diameter: 5, clearance: 0.2 })
  assert.equal(r.pieces.length, 2)
  assert.ok(r.joiners >= 1, 'placed at least one peg')
  const [a, b] = r.pieces.map((p) => volumeOf(p.tris))
  const half = 150 * 40 * 40
  // One side gains the peg, the other loses a slightly bigger socket.
  assert.ok(Math.max(a!, b!) > half && Math.min(a!, b!) < half)
  assert.ok(Math.max(a!, b!) - half < half - Math.min(a!, b!), 'the socket is bigger than the peg')
})

test('dowels: holes both sides and loose dowels to print', () => {
  const bar = tri(new THREE.BoxGeometry(300, 60, 60))
  const r = chop(wasm, bar, { bed, mode: 'grid', joiner: 'dowels', diameter: 5 })
  assert.ok(r.joiners >= 2)
  assert.equal(r.dowels.length, r.joiners)
  for (const p of r.pieces) assert.ok(volumeOf(p.tris) < 150 * 60 * 60)
})

test('a thin cut face gets no joiner and is counted as skipped', () => {
  const plate = tri(new THREE.BoxGeometry(300, 80, 3))
  const r = chop(wasm, plate, { bed, mode: 'grid', joiner: 'pegs', diameter: 5 })
  assert.equal(r.joiners, 0)
  assert.ok(r.skipped >= 1)
})

console.log(`\n${passed} passed`)
