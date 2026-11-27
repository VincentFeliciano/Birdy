// Run with: node tests/arrange.test.mts
import assert from 'node:assert/strict'
import { packRows } from '../src/engine/geometry/arrange.ts'

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

type R = { x0: number; x1: number; y0: number; y1: number }
const rects = (items: { w: number; d: number }[], places: { x: number; y: number }[]): R[] =>
  items.map((it, i) => ({ x0: places[i]!.x - it.w / 2, x1: places[i]!.x + it.w / 2, y0: places[i]!.y - it.d / 2, y1: places[i]!.y + it.d / 2 }))
const overlap = (a: R, b: R, gap: number) => a.x0 < b.x1 + gap - 1e-9 && b.x0 < a.x1 + gap - 1e-9 && a.y0 < b.y1 + gap - 1e-9 && b.y0 < a.y1 + gap - 1e-9

test('items keep their gap and stay inside the reported size', () => {
  const items = [
    { w: 40, d: 30 },
    { w: 20, d: 20 },
    { w: 60, d: 10 },
    { w: 35, d: 50 },
    { w: 10, d: 10 },
    { w: 80, d: 25 },
  ]
  const { places, width, depth } = packRows(items, 120, 5)
  const r = rects(items, places)
  for (let i = 0; i < r.length; i++) {
    assert.ok(r[i]!.x0 >= -1e-9 && r[i]!.x1 <= width + 1e-9 && r[i]!.y0 >= -1e-9 && r[i]!.y1 <= depth + 1e-9)
    for (let j = i + 1; j < r.length; j++) assert.ok(!overlap(r[i]!, r[j]!, 5), `${i} and ${j} overlap`)
  }
  assert.ok(width <= 120)
})

test('identical copies fill a row before starting the next', () => {
  const items = Array.from({ length: 6 }, () => ({ w: 30, d: 30 }))
  const { width, depth } = packRows(items, 100, 5)
  assert.equal(width, 30 * 3 + 5 * 2)
  assert.equal(depth, 30 * 2 + 5)
})

test('one wide item that is wider than the plate still gets placed', () => {
  const { places, width } = packRows([{ w: 300, d: 10 }], 200, 5)
  assert.deepEqual(places[0], { x: 150, y: 5 })
  assert.equal(width, 300)
})

console.log(`\n${passed} arrange tests passed`)
