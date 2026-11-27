import assert from 'node:assert/strict'
import { mapSdcpStatus } from '../electron/sdcp.ts'

let n = 0
function test(name: string, fn: () => void) {
  fn()
  n++
  console.log(`ok  ${name}`)
}

test('idle printer is ready', () => {
  const s = mapSdcpStatus({ CurrentStatus: [0], PrintInfo: { Status: 0 } }, 'Saturn')
  assert.equal(s.state, 'idle')
  assert.equal(s.progress, null)
})

test('printing reports layer progress and time left', () => {
  const s = mapSdcpStatus({ CurrentStatus: [1], PrintInfo: { Status: 3, CurrentLayer: 100, TotalLayer: 400, CurrentTicks: 300_000, TotalTicks: 1_200_000, Filename: 'a.goo' } }, 'Saturn')
  assert.equal(s.state, 'printing')
  assert.equal(s.progress, 0.25)
  assert.equal(s.elapsed, 300)
  assert.equal(s.remaining, 900)
  assert.match(s.detail, /Exposing · layer 100 of 400/)
  assert.equal(s.file, 'a.goo')
})

test('paused, finished and file errors', () => {
  assert.equal(mapSdcpStatus({ CurrentStatus: [1], PrintInfo: { Status: 6, TotalLayer: 10, CurrentLayer: 5 } }, 'x').state, 'paused')
  const done = mapSdcpStatus({ CurrentStatus: [0], PrintInfo: { Status: 9, TotalLayer: 10, CurrentLayer: 10 } }, 'x')
  assert.equal(done.state, 'done')
  assert.equal(done.remaining, null)
  const bad = mapSdcpStatus({ CurrentStatus: [0], PrintInfo: { Status: 0, ErrorNumber: 3 } }, 'x')
  assert.equal(bad.state, 'error')
  assert.match(bad.detail, /resolution/)
})

test('a plain number for CurrentStatus works too', () => {
  assert.equal(mapSdcpStatus({ CurrentStatus: 2 }, 'x').detail, 'Receiving a file')
})

console.log(`\n${n} SDCP tests passed`)
