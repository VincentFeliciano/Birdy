// Run with: node tests/orient.test.mts
import assert from 'node:assert/strict'
import { BoxGeometry, ConeGeometry, Euler, Matrix4, Vector3 } from 'three'
import type { BufferGeometry } from 'three'
import { rankOrientations } from '../src/engine/geometry/orient.ts'

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

const tris = (g: BufferGeometry) => new Float32Array(g.toNonIndexed().getAttribute('position').array)
const concat = (...a: Float32Array[]) => {
  const out = new Float32Array(a.reduce((s, x) => s + x.length, 0))
  let o = 0
  for (const x of a) {
    out.set(x, o)
    o += x.length
  }
  return out
}
const down = (p: Float32Array) => new Vector3(...rankOrientations(p)[0]!.down)

test('a tilted box goes back onto one of its faces', () => {
  const g = new BoxGeometry(30, 20, 10).applyMatrix4(new Matrix4().makeRotationFromEuler(new Euler(0.5, 0.3, 0.2)))
  const best = rankOrientations(tris(g))[0]!
  assert.ok(best.overhang < 1, `overhang ${best.overhang}`)
  // Lies on its largest face (30 × 20), so the height is the 10 mm side.
  assert.ok(Math.abs(best.height - 10) < 0.01, `height ${best.height}`)
  assert.ok(Math.abs(best.contact - 600) < 1, `contact ${best.contact}`)
})

test('a cone standing on its tip is turned onto its base', () => {
  // ConeGeometry points up +Y; turn it so the tip points down −Z.
  const g = new ConeGeometry(10, 30, 64).rotateX(-Math.PI / 2)
  const d = down(tris(g))
  // The base faced +Z; standing on it means +Z must become down.
  assert.ok(d.z > 0.99, `down ${d.toArray()}`)
})

test('a T upside down is flipped so the bar lies on the plate', () => {
  const stem = new BoxGeometry(4, 4, 20).translate(0, 0, 10)
  const bar = new BoxGeometry(30, 10, 4).translate(0, 0, 22)
  const d = down(concat(tris(stem), tris(bar)))
  // Standing on the bar (+Z down) leaves no overhang; standing on the stem leaves the bar's underside hanging.
  assert.ok(d.z > 0.99, `down ${d.toArray()}`)
})

test('a model already the right way up stays that way', () => {
  const g = new BoxGeometry(20, 20, 5).translate(0, 0, 2.5)
  const d = down(tris(g))
  assert.ok(d.z < -0.99, `down ${d.toArray()}`)
})

console.log(`\n${passed} orient tests passed`)
