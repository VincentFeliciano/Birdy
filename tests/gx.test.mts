import assert from 'node:assert/strict'
import { gxInfoFromGcode, gxThumbnail, printerModelOf, toGx, wantsGx } from '../electron/gx.ts'

let n = 0
function test(name: string, fn: () => void) {
  fn()
  n++
  console.log(`ok  ${name}`)
}

test('older Flashforge models get .gx, the Klipper ones and others .gcode', () => {
  for (const m of ['Flashforge Adventurer 3 Series', 'Flashforge Adventurer 4 Series', 'FlashForge Finder', 'Flashforge Guider 2s', 'FlashForge Creator Pro', 'Flashforge Dreamer'])
    assert.equal(wantsGx(m), true, m)
  for (const m of ['Flashforge Adventurer 5M', 'Flashforge Adventurer 5M Pro', 'Flashforge AD5X', 'Flashforge Guider 3 Ultra', 'Anycubic i3 Mega S', 'Bambu Lab P1S', '', null])
    assert.equal(wantsGx(m), false, String(m))
})

const gcode = [
  '; HEADER_BLOCK_START',
  '; estimated printing time (normal mode) = 1h 2m 3s',
  'G28',
  'G1 X10 Y10 E1',
  '; filament used [mm] = 1234.56',
  '; CONFIG_BLOCK_START',
  '; hot_plate_temp = 60,60',
  '; layer_height = 0.18',
  '; nozzle_temperature = 210',
  '; printer_model = Flashforge Adventurer 3 Series',
  '; sparse_infill_speed = 70',
  '; wall_loops = 3',
  '; CONFIG_BLOCK_END',
  '',
].join('\n')

test('header numbers come from the G-code comments', () => {
  assert.deepEqual(gxInfoFromGcode(gcode), { printSeconds: 3723, filamentMm: 1234.56, layerHeightMm: 0.18, shells: 3, speedMmS: 70, bedTemp: 60, nozzleTemp: 210 })
  assert.equal(printerModelOf(gcode), 'Flashforge Adventurer 3 Series')
})

test('the 80×60 preview is a complete 24-bit BMP, rows bottom-up', () => {
  const grey = new Uint8Array(80 * 60)
  grey[0] = 200 // top-left pixel
  const bmp = gxThumbnail(grey)
  const v = new DataView(bmp.buffer)
  assert.equal(bmp.length, 14454)
  assert.equal(String.fromCharCode(bmp[0]!, bmp[1]!), 'BM')
  assert.equal(v.getUint32(2, true), 14454)
  assert.equal(v.getUint32(10, true), 54)
  assert.equal(v.getInt32(18, true), 80)
  assert.equal(v.getInt32(22, true), 60)
  assert.equal(v.getUint16(28, true), 24)
  // Bottom-up: the top-left pixel is the first pixel of the last stored row.
  const lastRow = 54 + 59 * 80 * 3
  assert.deepEqual([...bmp.subarray(lastRow, lastRow + 3)], [200, 200, 200])
})

test('the file matches the xgcode 1.0 layout', () => {
  const body = new TextEncoder().encode(gcode)
  const gx = toGx(body, gxInfoFromGcode(gcode))
  const v = new DataView(gx.buffer)
  assert.deepEqual([...gx.subarray(0, 16)], [...new TextEncoder().encode('xgcode 1.0\n'), 0, 0, 0, 0, 0])
  assert.equal(v.getUint32(0x10, true), 58)
  assert.equal(v.getUint32(0x14, true), 14512)
  assert.equal(v.getUint32(0x18, true), 14512)
  assert.equal(v.getUint32(0x1c, true), 3723)
  assert.equal(v.getUint32(0x20, true), 1235)
  assert.equal(v.getUint16(0x28, true), 0x0b)
  assert.equal(v.getUint16(0x2a, true), 180)
  assert.equal(v.getUint16(0x2e, true), 3)
  assert.equal(v.getUint16(0x30, true), 70)
  assert.equal(v.getUint16(0x32, true), 60)
  assert.equal(v.getUint16(0x34, true), 210)
  assert.equal(String.fromCharCode(gx[58]!, gx[59]!), 'BM')
  assert.deepEqual(gx.subarray(14512), body, 'the G-code follows unchanged')
})

console.log(`${n} gx tests passed`)
