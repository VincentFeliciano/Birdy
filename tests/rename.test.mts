// Run with: node tests/rename.test.mts
import assert from 'node:assert/strict'
import { replacePathPrefix } from '../electron/path-prefix.ts'
import { plainChromeUserAgent } from '../electron/user-agent.ts'

const from = 'C:\\Users\\me\\OneDrive\\Documents\\Birdy'
const to = 'C:\\Users\\me\\OneDrive\\Documents\\Boaty'
const json = JSON.stringify({
  a: `${from}\\Library\\Toys\\cube.stl`,
  b: `${from}\\Exports`,
  c: from,
  d: 'C:/Users/me/OneDrive/Documents/Birdy/Models/x.stl',
  keep: `${from} Models\\y.stl`,
  other: 'C:\\Users\\me\\Documents\\Birdy\\z.stl',
  name: 'Birdy',
})
const out = JSON.parse(replacePathPrefix(json, from, to))
assert.equal(out.a, `${to}\\Library\\Toys\\cube.stl`)
assert.equal(out.b, `${to}\\Exports`)
assert.equal(out.c, to)
assert.equal(out.d, 'C:/Users/me/OneDrive/Documents/Boaty/Models/x.stl')
assert.equal(out.keep, `${from} Models\\y.stl`, 'only whole folder names change')
assert.equal(out.other, 'C:\\Users\\me\\Documents\\Birdy\\z.stl', 'other folders are left alone')
assert.equal(out.name, 'Birdy')
// Case differences in the drive or folder still match (Windows paths).
assert.equal(JSON.parse(replacePathPrefix(JSON.stringify({ p: from.toLowerCase() + '\\a' }), from, to)).p, `${to}\\a`)

const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Boaty/0.5.0 Chrome/140.0.0.0 Electron/45.0.0 Safari/537.36'
assert.equal(plainChromeUserAgent(ua), 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36')
console.log('rename tests passed')
