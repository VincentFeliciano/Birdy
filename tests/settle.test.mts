// Run with: node tests/settle.test.mts
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { centreOfMass, settle } from '../src/engine/geometry/settle.ts'

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

function tris(g: THREE.BufferGeometry, m?: THREE.Matrix4) {
  const n = g.index ? g.toNonIndexed() : g
  if (m) n.applyMatrix4(m)
  return new Float32Array(n.getAttribute('position').array)
}
const rot = (x: number, y: number, z: number) => new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler((x * Math.PI) / 180, (y * Math.PI) / 180, (z * Math.PI) / 180))
/** Applies the settle rotation and returns the triangles' lowest points and the down-face normal check. */
function after(p: Float32Array) {
  const r = settle(p)
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(p.slice(), 3))
  g.applyQuaternion(r.rotation)
  return { r, out: new Float32Array(g.getAttribute('position').array) }
}
/** Vertices within tol of the lowest z. */
function onFloor(p: Float32Array, tol = 1e-3) {
  let lo = Infinity
  for (let i = 2; i < p.length; i += 3) lo = Math.min(lo, p[i]!)
  const set = new Set<string>()
  for (let i = 0; i < p.length; i += 3) if (p[i + 2]! - lo < tol) set.add(`${p[i]!.toFixed(2)},${p[i + 1]!.toFixed(2)}`)
  return set.size
}

test('centre of mass of a closed box is its middle', () => {
  const c = centreOfMass(tris(new THREE.BoxGeometry(10, 20, 30).translate(1, 2, 3)))
  assert.ok(c.distanceTo(new THREE.Vector3(1, 2, 3)) < 1e-6)
})

test('a box already flat does not move', () => {
  const { r } = after(tris(new THREE.BoxGeometry(10, 20, 30)))
  assert.equal(r.tips, 0)
  assert.ok(r.rotation.angleTo(new THREE.Quaternion()) < 1e-9)
})

test('a tilted box tips onto a face', () => {
  const { r, out } = after(tris(new THREE.BoxGeometry(20, 20, 20), rot(25, 10, 0)))
  assert.ok(r.tips >= 1)
  assert.equal(onFloor(out), 4)
})

test('a tall block leaning a little falls back onto its base, not onto its side', () => {
  // 10 x 10 x 40 standing, leaning 8° about x: the centre of mass is still over the base.
  const { out } = after(tris(new THREE.BoxGeometry(10, 10, 40), rot(8, 0, 0)))
  let lo = Infinity, hi = -Infinity
  for (let i = 2; i < out.length; i += 3) {
    lo = Math.min(lo, out[i]!)
    hi = Math.max(hi, out[i]!)
  }
  assert.ok(Math.abs(hi - lo - 40) < 1e-3, `height ${hi - lo}`)
})

test('a tall block leaning far falls over onto its long side', () => {
  const { out } = after(tris(new THREE.BoxGeometry(10, 10, 40), rot(30, 0, 0)))
  let lo = Infinity, hi = -Infinity
  for (let i = 2; i < out.length; i += 3) {
    lo = Math.min(lo, out[i]!)
    hi = Math.max(hi, out[i]!)
  }
  assert.ok(Math.abs(hi - lo - 10) < 1e-3, `height ${hi - lo}`)
})

test('a cone on its tip settles onto its side; a torus lies flat', () => {
  const cone = after(tris(new THREE.ConeGeometry(10, 30, 32).rotateX(Math.PI / 2 + 0.2)))
  assert.ok(cone.r.tips >= 1)
  const torus = after(tris(new THREE.TorusGeometry(15, 4, 24, 64), rot(40, 20, 0)))
  let lo = Infinity, hi = -Infinity
  for (let i = 2; i < torus.out.length; i += 3) {
    lo = Math.min(lo, torus.out[i]!)
    hi = Math.max(hi, torus.out[i]!)
  }
  assert.ok(hi - lo < 8.1, `torus height ${hi - lo}`)
})

console.log(`\n${passed} settle tests passed`)
