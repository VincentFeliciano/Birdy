// Run with: node tests/formats.test.mts
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { unzipSync, strFromU8 } from 'three/examples/jsm/libs/fflate.module.js'
import { worldPositions, write3mf } from '../src/engine/exporters/threemf.ts'

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

const box = (x: number) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10))
  m.position.x = x
  return m
}

test('3MF keeps each part, welds vertices and stores colours', () => {
  const a = box(0)
  const b = box(30)
  const data = write3mf([
    { name: 'Left <A>', positions: worldPositions(a) },
    { name: 'Right', positions: worldPositions(b), color: '#ff8800' },
  ], 'Two boxes')
  const files = unzipSync(data)
  assert.ok(files['[Content_Types].xml'] && files['_rels/.rels'])
  const xml = strFromU8(files['3D/3dmodel.model']!)
  assert.match(xml, /unit="millimeter"/)
  assert.equal((xml.match(/<object /g) ?? []).length, 2)
  assert.equal((xml.match(/<item /g) ?? []).length, 2)
  // A box is 8 corners and 12 triangles once welded.
  const first = xml.split('<object ')[1]!
  assert.equal((first.match(/<vertex /g) ?? []).length, 8)
  assert.equal((first.match(/<triangle /g) ?? []).length, 12)
  assert.match(xml, /name="Left &lt;A&gt;"/)
  assert.match(xml, /displaycolor="#FF8800"/)
  assert.match(xml, /<metadata name="Title">Two boxes<\/metadata>/)
  // Moved part keeps its position.
  assert.match(xml.split('<object ')[2]!, /x="35"/)
})

test('a mirrored part is written the right way out', () => {
  const m = box(0)
  m.scale.x = -1
  const p = worldPositions(m)
  let v = 0
  for (let o = 0; o < p.length; o += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = p.subarray(o, o + 9)
    v += (ax! * (by! * cz! - bz! * cy!) - ay! * (bx! * cz! - bz! * cx!) + az! * (bx! * cy! - by! * cx!)) / 6
  }
  assert.ok(Math.abs(v - 1000) < 1e-3, `volume ${v}`)
})

test('an empty plate is refused', () => {
  assert.throws(() => write3mf([{ name: 'x', positions: new Float32Array(0) }]))
})

console.log(`\n${passed} format tests passed`)
