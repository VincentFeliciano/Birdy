// Run with: node tests/models.test.mts
// Unpacking downloaded archives into the Models folder, including hostile archives.
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32, deflateRawSync } from 'node:zlib'
import { importIntoModels, listModels } from '../electron/models-import.ts'
import { safeRelativePath } from '../electron/zip.ts'

let passed = 0
async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn()
    passed++
    console.log(`ok  ${name}`)
  } catch (err) {
    console.error(`FAIL ${name}`)
    throw err
  }
}

interface FakeEntry {
  name: string
  data: Buffer
  store?: boolean
  /** Lie about the uncompressed size in the directory (zip bomb style). */
  claimSize?: number
  badCrc?: boolean
  encrypted?: boolean
}

/** Writes a real ZIP file. */
function makeZip(path: string, entries: FakeEntry[]) {
  const locals: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8')
    const body = e.store ? e.data : deflateRawSync(e.data)
    const crc = e.badCrc ? (crc32(e.data) ^ 1) >>> 0 : crc32(e.data) >>> 0
    const size = e.claimSize ?? e.data.length
    const flags = 0x800 | (e.encrypted ? 1 : 0)
    const method = e.store ? 0 : 8
    const loc = Buffer.alloc(30)
    loc.writeUInt32LE(0x04034b50, 0)
    loc.writeUInt16LE(20, 4)
    loc.writeUInt16LE(flags, 6)
    loc.writeUInt16LE(method, 8)
    loc.writeUInt32LE(crc, 14)
    loc.writeUInt32LE(body.length, 18)
    loc.writeUInt32LE(size, 22)
    loc.writeUInt16LE(name.length, 26)
    const cen = Buffer.alloc(46)
    cen.writeUInt32LE(0x02014b50, 0)
    cen.writeUInt16LE(20, 4)
    cen.writeUInt16LE(20, 6)
    cen.writeUInt16LE(flags, 8)
    cen.writeUInt16LE(method, 10)
    cen.writeUInt32LE(crc, 16)
    cen.writeUInt32LE(body.length, 20)
    cen.writeUInt32LE(size, 24)
    cen.writeUInt16LE(name.length, 28)
    cen.writeUInt32LE(offset, 42)
    locals.push(loc, name, body)
    central.push(cen, name)
    offset += 30 + name.length + body.length
  }
  const cd = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  writeFileSync(path, Buffer.concat([...locals, cd, end]))
}

const stl = (label: string) => Buffer.from(`solid ${label}\nendsolid ${label}\n`.repeat(20))
const work = mkdtempSync(join(tmpdir(), 'birdy-models-'))
const fresh = () => mkdtempSync(join(work, 'm-'))
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(join(dir, d.name)).map((f) => `${d.name}/${f}`) : [d.name]))

try {
  await test('copies a downloaded model into the Models folder, once', async () => {
    const root = fresh()
    const src = join(work, 'Benchy (2).stl')
    writeFileSync(src, stl('benchy'))
    const r = await importIntoModels(root, src)
    assert.deepEqual(r, { kind: 'file', rel: 'Benchy.stl', models: 1, openRel: 'Benchy.stl', existing: false, skipped: [] })
    assert.ok(existsSync(src), 'the download itself is left alone')
    const again = await importIntoModels(root, src)
    assert.equal(again!.existing, true)
    assert.deepEqual(files(root), ['Benchy.stl'])
  })

  await test('a different file with the same name gets its own name', async () => {
    const root = fresh()
    const a = join(work, 'part.stl')
    writeFileSync(a, stl('a'))
    await importIntoModels(root, a)
    writeFileSync(a, stl('bb'))
    const r = await importIntoModels(root, a)
    assert.equal(r!.rel, 'part (2).stl')
  })

  await test('unpacks only the models, dropping wrapper folders (Thingiverse layout)', async () => {
    const root = fresh()
    const zip = join(work, 'Planter-123.zip')
    makeZip(zip, [
      { name: 'Planter-123/', data: Buffer.alloc(0), store: true },
      { name: 'Planter-123/files/pot.stl', data: stl('pot') },
      { name: 'Planter-123/files/saucer.STL', data: stl('saucer'), store: true },
      { name: 'Planter-123/files/parts/drip ring.3mf', data: stl('ring') },
      { name: 'Planter-123/images/photo.jpg', data: Buffer.from('jpeg') },
      { name: 'Planter-123/README.txt', data: Buffer.from('hi') },
      { name: '__MACOSX/Planter-123/files/._pot.stl', data: Buffer.from('junk') },
    ])
    const r = await importIntoModels(root, zip)
    assert.equal(r!.rel, 'Planter-123')
    assert.equal(r!.models, 3)
    assert.equal(r!.openRel, null, 'several models: the panel opens instead of one model')
    assert.deepEqual(files(join(root, 'Planter-123')).sort(), ['parts/drip ring.3mf', 'pot.stl', 'saucer.STL'])
    assert.deepEqual(readFileSync(join(root, 'Planter-123', 'pot.stl')), stl('pot'))
    assert.deepEqual(r!.skipped, [])

    const again = await importIntoModels(root, zip)
    assert.equal(again!.existing, true)
    assert.equal(readdirSync(root).length, 1)

    const list = await listModels(root, '')
    assert.deepEqual(list.map((e) => [e.name, e.kind, e.models]), [['Planter-123', 'dir', 3]])
    const inner = await listModels(root, 'Planter-123')
    assert.deepEqual(inner.map((e) => e.name), ['parts', 'pot.stl', 'saucer.STL'])
  })

  await test('a single-model archive opens that model', async () => {
    const root = fresh()
    const zip = join(work, 'clip.zip')
    makeZip(zip, [{ name: 'clip.stl', data: stl('clip') }])
    const r = await importIntoModels(root, zip)
    assert.equal(r!.openRel, 'clip/clip.stl')
  })

  await test('never writes outside the Models folder (zip slip)', async () => {
    const root = fresh()
    const zip = join(work, 'evil.zip')
    makeZip(zip, [
      { name: '../escape.stl', data: stl('x') },
      { name: 'a/../../escape2.stl', data: stl('x') },
      { name: '/abs.stl', data: stl('x') },
      { name: 'C:/Windows/evil.stl', data: stl('x') },
      { name: 'ok\\..\\..\\back.stl', data: stl('x') },
      { name: 'CON.stl', data: stl('x') },
      { name: 'good.stl', data: stl('good') },
    ])
    const r = await importIntoModels(root, zip)
    assert.equal(r!.models, 1)
    assert.deepEqual(files(root), ['evil/good.stl'])
    assert.ok(!existsSync(join(work, 'escape.stl')) && !existsSync(join(root, '..', 'escape2.stl')))
    assert.equal(r!.skipped.length, 6)
  })

  await test('stops zip bombs, damaged entries and encrypted ones', async () => {
    const root = fresh()
    const zip = join(work, 'bad.zip')
    makeZip(zip, [
      { name: 'bomb.stl', data: Buffer.alloc(5_000_000), claimSize: 1000 },
      { name: 'corrupt.stl', data: stl('c'), badCrc: true },
      { name: 'locked.stl', data: stl('l'), encrypted: true },
      { name: 'fine.stl', data: stl('fine') },
    ])
    const r = await importIntoModels(root, zip)
    assert.equal(r!.models, 1)
    assert.deepEqual(files(root), ['bad/fine.stl'])
    assert.match(r!.skipped.join('\n'), /bomb\.stl: larger than it claims/)
    assert.match(r!.skipped.join('\n'), /corrupt\.stl: damaged entry/)
    assert.match(r!.skipped.join('\n'), /locked\.stl: password protected/)
  })

  await test('an archive with no models adds nothing', async () => {
    const root = fresh()
    const zip = join(work, 'docs.zip')
    makeZip(zip, [{ name: 'manual.pdf', data: Buffer.from('%PDF') }])
    const r = await importIntoModels(root, zip)
    assert.equal(r!.models, 0)
    assert.deepEqual(readdirSync(root), [])
  })

  await test('a file that only pretends to be a ZIP is refused cleanly', async () => {
    const root = fresh()
    const fake = join(work, 'fake.zip')
    writeFileSync(fake, 'not a zip at all, just text')
    await assert.rejects(importIntoModels(root, fake), /not a ZIP/)
  })

  await test('entry names are made safe', () => {
    assert.deepEqual(safeRelativePath('a/b/c.stl'), ['a', 'b', 'c.stl'])
    assert.deepEqual(safeRelativePath('./a//b.stl'), ['a', 'b.stl'])
    assert.equal(safeRelativePath('../a.stl'), null)
    assert.equal(safeRelativePath('.hidden/a.stl'), null)
    assert.deepEqual(safeRelativePath('we?ird*name.stl'), ['we_ird_name.stl'])
    assert.equal(safeRelativePath('aux.stl'), null)
  })

  await test('other files are ignored', async () => {
    assert.equal(await importIntoModels(fresh(), join(work, 'x.exe')), null)
  })
} finally {
  rmSync(work, { recursive: true, force: true })
}

console.log(`\n${passed} models tests passed`)
