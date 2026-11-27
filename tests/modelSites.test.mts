import assert from 'node:assert/strict'
import { modelPage } from '../src/types/modelSites.ts'

let n = 0
function test(name: string, fn: () => void) {
  fn()
  n++
  console.log(`ok  ${name}`)
}

test('Thingiverse things point to their files tab', () => {
  const p = modelPage('https://www.thingiverse.com/thing:763622')!
  assert.equal(p.site, 'thingiverse')
  assert.equal(p.files, 'https://www.thingiverse.com/thing:763622/files')
  assert.equal(modelPage('https://www.thingiverse.com/thing:763622/files')?.files, null)
  assert.equal(modelPage('https://www.thingiverse.com/thing:763622/comments')?.id, '763622')
  assert.equal(modelPage('https://www.thingiverse.com/search?q=benchy'), null)
  assert.equal(modelPage('https://www.thingiverse.com/thing:abc'), null)
})

test('Printables models point to their files tab', () => {
  const p = modelPage('https://www.printables.com/model/3161-3d-benchy')!
  assert.equal(p.site, 'printables')
  assert.equal(p.files, 'https://www.printables.com/model/3161-3d-benchy/files')
  assert.equal(modelPage('https://www.printables.com/de/model/3161-3d-benchy/comments')?.files, 'https://www.printables.com/model/3161-3d-benchy/files')
  assert.equal(modelPage('https://www.printables.com/model/3161-3d-benchy/files')?.files, null)
  assert.equal(modelPage('https://www.printables.com/model'), null)
})

test('MakerWorld models are recognised', () => {
  assert.equal(modelPage('https://makerworld.com/en/models/1234567-cute-frog#profileId-1')?.id, '1234567')
  assert.equal(modelPage('https://makerworld.com/models/42')?.site, 'makerworld')
  assert.equal(modelPage('https://makerworld.com/en/u/someone'), null)
})

test('other sites, look-alikes and plain http are ignored', () => {
  assert.equal(modelPage('https://thingiverse.com.evil.example/thing:1'), null)
  assert.equal(modelPage('http://www.thingiverse.com/thing:1'), null)
  assert.equal(modelPage('https://example.com/model/1'), null)
  assert.equal(modelPage('not a url'), null)
})

console.log(`\n${n} model site tests passed`)
