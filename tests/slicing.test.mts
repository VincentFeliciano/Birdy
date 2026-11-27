// Run with: node tests/slicing.test.mts  (Node 22.6+ strips the types)
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import {
  bedFromSettings,
  buildJobPreset,
  customPreset,
  fitsMachine,
  parseConfigBlock,
  matchMachine,
  overrideKeys,
  parseCatalogLog,
  parseDuration,
  parseIni,
  pickFilament,
  pickProcess,
  resolveIniPreset,
  settingNumber,
  stripConfChecksum,
  summarizeGcode,
  withConfChecksum,
} from '../electron/slicing/presets.ts'
import { digestHeader } from '../electron/digest.ts'
import { normalizeFeature, parseGcode } from '../src/engine/gcode/parseGcode.ts'
import { createHash } from 'node:crypto'

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

const D = 'F:\\data\\system'
const logLine = (name: string, vendor: string, kind: string) =>
  `Slic3r::PresetBundle::commit_vendor_preset, got preset ${name}, filament_id , from ${D}/${vendor}/${kind}/${name}.json`
const LOG = [
  'cli mode, Current OrcaSlicer Version 2.5.2',
  logLine('Anycubic i3 Mega S 0.4 nozzle', 'Anycubic', 'machine'),
  logLine('Anycubic Kobra 2 0.4 nozzle', 'Anycubic', 'machine'),
  logLine('0.20mm Standard @Anycubic i3MegaS', 'Anycubic', 'process'),
  logLine('0.15mm Optimal @Anycubic i3MegaS', 'Anycubic', 'process'),
  logLine('0.20mm Standard @Anycubic Kobra2', 'Anycubic', 'process'),
  logLine('Bambu Lab X1 Carbon 0.4 nozzle', 'BBL', 'machine'),
  logLine('Bambu Lab X1 Carbon 0.2 nozzle', 'BBL', 'machine'),
  logLine('0.20mm Standard @BBL X1C', 'BBL', 'process'),
  logLine('0.10mm Standard @BBL X1C 0.2 nozzle', 'BBL', 'process'),
  logLine('Bambu PLA Basic @BBL X1C', 'BBL', 'filament'),
  logLine('Generic PLA @System', 'OrcaFilamentLibrary', 'filament'),
  logLine('Generic PETG @System', 'OrcaFilamentLibrary', 'filament'),
  logLine('MyMarlin 0.4 nozzle', 'Custom', 'machine'),
  logLine('0.20mm Standard @MyKlipper', 'Custom', 'process'),
  // Same preset logged twice and an unrelated line: both ignored.
  logLine('Generic PLA @System', 'OrcaFilamentLibrary', 'filament'),
  'Slic3r::PresetCollection::select_preset: machine select success',
].join('\n')
const catalog = parseCatalogLog(LOG)
const byName = (n: string) => [...catalog.machines, ...catalog.processes, ...catalog.filaments].find((p) => p.name === n)!

test('catalog: parses presets by vendor and kind, de-duplicated', () => {
  assert.deepEqual(catalog.vendors, ['Anycubic', 'BBL', 'Custom'])
  assert.equal(catalog.machines.length, 5)
  assert.equal(catalog.processes.length, 6)
  assert.equal(catalog.filaments.length, 3)
  assert.equal(byName('Bambu PLA Basic @BBL X1C').vendor, 'BBL')
})

test('fitsMachine: matches processes and filaments to the printer by name', () => {
  const i3 = byName('Anycubic i3 Mega S 0.4 nozzle')
  const x1c = byName('Bambu Lab X1 Carbon 0.4 nozzle')
  const x1c02 = byName('Bambu Lab X1 Carbon 0.2 nozzle')
  assert.ok(fitsMachine(byName('0.20mm Standard @Anycubic i3MegaS'), i3))
  assert.ok(!fitsMachine(byName('0.20mm Standard @Anycubic Kobra2'), i3))
  assert.ok(!fitsMachine(byName('0.20mm Standard @BBL X1C'), i3))
  assert.ok(fitsMachine(byName('0.20mm Standard @BBL X1C'), x1c))
  assert.ok(!fitsMachine(byName('0.20mm Standard @BBL X1C'), x1c02), 'nozzle size must match')
  assert.ok(fitsMachine(byName('0.10mm Standard @BBL X1C 0.2 nozzle'), x1c02))
  assert.ok(fitsMachine(byName('Generic PLA @System'), i3))
  assert.ok(fitsMachine(byName('Bambu PLA Basic @BBL X1C'), x1c))
  assert.ok(!fitsMachine(byName('Bambu PLA Basic @BBL X1C'), i3))
  // An imported printer is matched through the preset it is based on.
  const mine = { name: 'My Mega', vendor: 'Anycubic', kind: 'machine' as const, user: true, base: 'Anycubic i3 Mega S 0.4 nozzle' }
  assert.ok(fitsMachine(byName('0.20mm Standard @Anycubic i3MegaS'), mine))
})

test('overrides: map to OrcaSlicer keys and value formats', () => {
  assert.deepEqual(overrideKeys('process', { layerHeight: 0.16, infill: 25, walls: 3, supports: 'tree', brim: true, brimWidth: 5 }), {
    layer_height: '0.16',
    sparse_infill_density: '25%',
    wall_loops: '3',
    enable_support: '1',
    support_type: 'tree(auto)',
    brim_type: 'outer_only',
    brim_width: '5',
  })
  assert.deepEqual(overrideKeys('process', { supports: 'off', brim: false }), { enable_support: '0', brim_type: 'no_brim' })
  const f = overrideKeys('filament', { nozzleTemp: 215, bedTemp: 60 })
  assert.deepEqual(f.nozzle_temperature, ['215'])
  assert.deepEqual(f.hot_plate_temp_initial_layer, ['60'])
  assert.deepEqual(overrideKeys('machine', { infill: 50 }), {})
})

test('job preset: inherits a system preset, or carries an imported one', () => {
  const sys = buildJobPreset('process', { name: '0.20mm Standard @BBL X1C' }, { infill: 15 }, '2.5.2.0')
  assert.equal(sys.inherits, '0.20mm Standard @BBL X1C')
  assert.equal(sys.name, 'Birdy job process')
  assert.equal(sys.from, 'User')
  assert.equal(sys.version, '2.5.2.0')
  assert.equal(sys.sparse_infill_density, '15%')
  const user = buildJobPreset(
    'machine',
    { name: 'My X1C', userJson: { name: 'My X1C', inherits: 'Bambu Lab X1 Carbon 0.4 nozzle', setting_id: 'abc', birdy_vendor: 'BBL', printable_height: '240' } },
    {},
    '2.5.2.0',
  )
  assert.equal(user.inherits, 'Bambu Lab X1 Carbon 0.4 nozzle')
  assert.equal(user.printable_height, '240')
  assert.equal(user.type, 'machine')
  assert.ok(!('setting_id' in user) && !('birdy_vendor' in user))
})

test('summary: reads Bambu-style and generic G-code comments', () => {
  const bbl = [
    '; HEADER_BLOCK_START',
    '; model printing time: 8m 55s; total estimated time: 16m 11s',
    '; total layer number: 100',
    '; max_z_height: 20.00',
    '; HEADER_BLOCK_END',
    '; filament used [mm] = 1308.91',
    '; filament used [g] = 3.97',
    '; printable_area = 0x0,256x0,256x256,0x256',
    '; printer_model = Bambu Lab X1 Carbon',
    '; printable_height = 250',
  ].join('\n')
  const s = summarizeGcode(bbl)
  assert.equal(s.printTime, '16m 11s')
  assert.equal(s.printSeconds, 971)
  assert.equal(s.layers, 100)
  assert.equal(s.filamentG, 3.97)
  assert.equal(s.filamentMm, 1308.91)
  assert.deepEqual(s.bed, [[0, 0], [256, 0], [256, 256], [0, 256]])
  assert.equal(s.printerModel, 'Bambu Lab X1 Carbon')
  assert.equal(s.bedHeight, 250)
  assert.equal(s.maxZ, 20)
  const gen = summarizeGcode('; total layer number: 12\n; estimated printing time (normal mode) = 1h 2m 3s\n; total filament used [g] = 4.73\n')
  assert.equal(gen.printSeconds, 3723)
  assert.equal(gen.filamentG, 4.73)
  assert.equal(gen.bed, null)
  assert.equal(parseDuration('1d 0h 0m 5s'), 86405)
  assert.equal(parseDuration('soon'), null)
})

test('conf checksum: MD5 of the JSON body, upper case', () => {
  const md5 = (s: string) => createHash('md5').update(s).digest('hex')
  const text = withConfChecksum('{\n    "vendors": {}\n}\n', md5)
  assert.match(text, /^\{\n {4}"vendors": \{\}\n\}\n# MD5 checksum [0-9A-F]{32}\n$/)
  assert.ok(text.includes(md5('{\n    "vendors": {}\n}').toUpperCase()))
  assert.equal(stripConfChecksum(text), '{\n    "vendors": {}\n}')
})

test('ini: parses sections and resolves PrusaSlicer inheritance', () => {
  const bundle = parseIni(
    [
      '[vendor]',
      'name = Test',
      '[printer:*common*]',
      'bed_shape = 0x0,200x0,200x200,0x200',
      'max_print_height = 200',
      'nozzle_diameter = 0.4',
      '[printer:*big*]',
      'bed_shape = 0x0,300x0,300x300,0x300',
      '[printer:Big One]',
      'inherits = *common*; *big*',
      'max_print_height = 400',
    ].join('\n'),
  )
  const p = resolveIniPreset(bundle, 'printer', 'Big One')!
  assert.equal(p.bed_shape, '0x0,300x0,300x300,0x300')
  assert.equal(p.max_print_height, '400')
  assert.equal(p.nozzle_diameter, '0.4')
  assert.equal(p.inherits, undefined)
  assert.equal(resolveIniPreset(bundle, 'printer', 'Missing'), null)
  assert.equal(settingNumber('15%'), 15)
  assert.equal(settingNumber('[210]'), 210)
  assert.equal(settingNumber(undefined), undefined)
})

test('import matching: printer names from other slicers find the engine preset', () => {
  assert.equal(matchMachine(catalog.machines, 'Anycubic i3 Mega S')?.name, 'Anycubic i3 Mega S 0.4 nozzle')
  assert.equal(matchMachine(catalog.machines, 'Anycubic i3 Mega S', '0.6'), null)
  assert.equal(matchMachine(catalog.machines, 'Totally Unknown Printer'), null)
  const i3 = byName('Anycubic i3 Mega S 0.4 nozzle')
  assert.equal(pickProcess(catalog.processes, i3, 0.15)?.name, '0.15mm Optimal @Anycubic i3MegaS')
  assert.equal(pickProcess(catalog.processes, i3)?.name, '0.20mm Standard @Anycubic i3MegaS')
  assert.equal(pickFilament(catalog.filaments, 'petg')?.name, 'Generic PETG @System')
  assert.equal(pickFilament(catalog.filaments, 'UNOBTAINIUM')?.name, 'Generic PLA @System')
})

test('digest auth: matches the RFC 2617 worked example', () => {
  const h = digestHeader(
    'Digest realm="testrealm@host.com", qop="auth,auth-int", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41"',
    'GET',
    '/dir/index.html',
    'Mufasa',
    'Circle Of Life',
    '0a4f113b',
  )
  assert.match(h, /response="6629fae49393a05397450978507c4ef1"/)
  assert.match(h, /qop=auth, nc=00000001, cnonce="0a4f113b"/)
  assert.match(h, /opaque="5ccc069c403ebaf9f0171e9517f40e41"/)
})

test('gcode: Bambu-style layers, features, relative E and travel', () => {
  const g = [
    'M83',
    'G90',
    'G1 X0 Y0 Z0.2 F600',
    '; CHANGE_LAYER',
    '; Z_HEIGHT: 0.2',
    '; FEATURE: Outer wall',
    'G1 X10 Y0 E0.5',
    'G1 X10 Y10 E0.5',
    'G1 E-0.8 ; retract',
    'G1 X20 Y20 F9000 ; travel',
    '; FEATURE: Sparse infill',
    'G1 X30 Y20 E.4',
    '; CHANGE_LAYER',
    '; Z_HEIGHT: 0.4',
    'G1 Z0.4',
    '; FEATURE: Outer wall',
    'G1 X30 Y30 E0.4',
  ].join('\n')
  const p = parseGcode(g)
  assert.equal(p.layerEnds.length, 2)
  assert.deepEqual([...p.layerEnds], [3, 4])
  assert.deepEqual([...p.layerZ].map((z) => Math.round(z * 10) / 10), [0.2, 0.4])
  assert.equal(p.features[p.featureOf[0]!], 'Outer wall')
  assert.equal(p.features[p.featureOf[2]!], 'Sparse infill')
  assert.equal(p.features[p.featureOf[3]!], 'Outer wall')
  assert.ok(p.travels.length >= 6, 'travel recorded')
  assert.deepEqual(p.max.map((v) => Math.round(v * 10) / 10), [30, 30, 0.4])
})

test('gcode: generic markers, absolute E with G92, arcs', () => {
  const g = [
    'M82',
    'G92 E0',
    ';LAYER_CHANGE',
    ';Z:0.3',
    'G1 Z0.3',
    'G1 X10 Y0',
    ';TYPE:External perimeter',
    'G1 X20 Y0 E1',
    'G1 X20 Y10 E1 ; no new filament: travel',
    'G92 E0',
    ';TYPE:Perimeter',
    'G3 X10 Y20 I-10 J0 E2 ; quarter circle around (10,10)... centre is (10,10)',
  ].join('\n')
  const p = parseGcode(g, { arcStepDeg: 10 })
  assert.equal(p.layerEnds.length, 1)
  assert.equal(p.features[p.featureOf[0]!], 'Outer wall')
  const arcSegs = p.featureOf.length - 1
  assert.ok(arcSegs >= 9, `arc subdivided (${arcSegs})`)
  const last = p.positions.length - 3
  assert.ok(Math.abs(p.positions[last]! - 10) < 1e-4 && Math.abs(p.positions[last + 1]! - 20) < 1e-4, 'arc ends at its target')
  // Every arc point stays on the circle of radius 10 around (10, 10).
  for (let i = 6; i < p.positions.length; i += 3) {
    const r = Math.hypot(p.positions[i]! - 10, p.positions[i + 1]! - 10)
    assert.ok(Math.abs(r - 10) < 1e-3, `arc radius ${r}`)
  }
})

test('gcode: files without layer comments split layers by height', () => {
  const p = parseGcode(['G1 Z0.2', 'G1 X5 E1', 'G1 Z0.4', 'G1 X0 E2', 'G1 Z1.4', 'G1 X9 F9000', 'G1 Z0.6', 'G1 X5 E3'].join('\n'))
  assert.deepEqual([...p.layerZ].map((z) => Math.round(z * 10) / 10), [0.2, 0.4, 0.6])
})

test('gcode: Cura markers and feature names', () => {
  const p = parseGcode(';LAYER:0\nG0 Z0.2\n;TYPE:WALL-OUTER\nG1 X5 Y0 E1\n;LAYER:1\nG0 Z0.4\n;TYPE:SKIN\nG1 X5 Y5 E2\n')
  assert.equal(p.layerEnds.length, 2)
  assert.equal(p.features[p.featureOf[0]!], 'Outer wall')
  assert.equal(p.features[p.featureOf[1]!], 'Top surface')
  assert.equal(normalizeFeature('support material interface'), 'Support')
  assert.equal(normalizeFeature('Custom'), 'Custom')
})

// Real OrcaSlicer output, when a local slice from development is present.
const real = ['.tmp/t2/out/plate_1.gcode', '.tmp/t1/out/plate_1.gcode'].filter((f) => existsSync(f))
for (const f of real) {
  test(`gcode: real OrcaSlicer file ${f}`, () => {
    const text = readFileSync(f, 'utf8')
    const s = summarizeGcode(text)
    const p = parseGcode(text)
    assert.equal(s.layers, 100)
    // The start sequence may add a purge-line "layer" before layer 1.
    assert.ok(p.layerEnds.length >= 100 && p.layerEnds.length <= 101, `layers ${p.layerEnds.length}`)
    assert.ok(p.features.includes('Outer wall') && p.features.includes('Sparse infill'))
    assert.ok(Math.abs(p.max[2] - 20) < 0.01, `top at ${p.max[2]}`)
  })
}

test('settings come back from the G-code config block, with real newlines', () => {
  const g = 'G1 X1\n; CONFIG_BLOCK_START\n; printable_area = 0x0,300x0,300x300,0x300\n; printable_height = 305\n; machine_start_gcode = G28\\nG1 Z5\n; layer_height = 0.2\n; CONFIG_BLOCK_END\n'
  const s = parseConfigBlock(g)
  assert.equal(s.printable_height, '305')
  assert.equal(s.machine_start_gcode, 'G28\nG1 Z5')
  assert.deepEqual(bedFromSettings(s), { x: 300, y: 300, z: 305 })
  assert.equal(bedFromSettings({ printable_area: 'nonsense' }), null)
})

test('custom presets keep plain settings and Birdy notes, never identity keys', () => {
  const p = customPreset('machine', 'Mine', 'MyMarlin 0.4 nozzle', { retraction_length: '4.5', name: 'evil', 'bad key': '1', inherits: 'x' }, { birdy_max_bed: 90, other: 1 })
  assert.equal(p.name, 'Mine')
  assert.equal(p.inherits, 'MyMarlin 0.4 nozzle')
  assert.equal(p.retraction_length, '4.5')
  assert.equal(p.birdy_max_bed, 90)
  assert.ok(!('bad key' in p) && !('other' in p))
})

test('a preset made for a custom printer fits it, whatever it inherits', () => {
  const machine = { name: 'Anycubic Mega X 0.4 nozzle', vendor: 'Anycubic', kind: 'machine' as const, user: true, base: 'Anycubic i3 Mega S 0.4 nozzle' }
  assert.ok(fitsMachine({ name: 'PLA @Anycubic Mega X 0.4 nozzle', vendor: 'Anycubic', kind: 'filament', user: true }, machine))
  assert.ok(fitsMachine({ name: '0.20mm Standard @Anycubic i3MegaS', vendor: 'Anycubic', kind: 'process' }, machine))
  assert.ok(!fitsMachine({ name: 'PLA @Someone Else', vendor: 'My printers', kind: 'filament', user: true }, machine))
})

test('job process and filament files are usable with any printer', () => {
  const p = buildJobPreset('process', { name: '0.20mm Standard @Anycubic Kobra' }, {}, '2.5.0.0')
  assert.deepEqual(p.compatible_printers, [])
  assert.equal(p.compatible_printers_condition, '')
  const m = buildJobPreset('machine', { name: 'Anycubic Kobra Max 0.4 nozzle' }, {}, '2.5.0.0')
  assert.ok(!('compatible_printers' in m))
})

console.log(`\n${passed} slicing tests passed`)
