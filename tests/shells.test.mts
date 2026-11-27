// Run with: node tests/shells.test.mts
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { splitShells } from '../src/engine/geometry/shells.ts'

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
const big = tri(new THREE.BoxGeometry(20, 20, 20))
const small = tri(new THREE.BoxGeometry(2, 2, 2).translate(30, 0, 0))
const sphere = tri(new THREE.SphereGeometry(5, 16, 8).translate(-30, 0, 0))
const shells = splitShells(join(small, big, sphere))
assert.equal(shells.length, 3)
assert.equal(shells[0]!.length, sphere.length, 'largest first')
assert.equal(shells[2]!.length, small.length)
assert.equal(splitShells(big).length, 1)
assert.equal(splitShells(new Float32Array(0)).length, 0)
console.log('ok  shells split largest first, single body stays whole\n\nshells tests passed')
