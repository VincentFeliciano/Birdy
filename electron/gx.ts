// Flashforge .gx ("xgcode 1.0"): a 58-byte header, an 80×60 BMP preview, then the G-code as text.
// Older Flashforge printers (Adventurer 3 / 4, Finder, Guider, Creator, Dreamer, Inventor) read these;
// the Klipper-based Adventurer 5M series and AD5X take plain .gcode.
// Layout as reverse-engineered by the community (Slic3r issue #4869, the xgcode crate). Little-endian.

const MAGIC = 'xgcode 1.0\n'
const HEADER = 58
export const GX_THUMB_W = 80
export const GX_THUMB_H = 60
const BMP_HEADER = 54
const BMP_SIZE = BMP_HEADER + GX_THUMB_W * GX_THUMB_H * 3

/** Flashforge models that want .gx files (their names as OrcaSlicer's printer_model has them). */
export function wantsGx(printerModel: string | null | undefined): boolean {
  if (!printerModel || !/flash\s*forge/i.test(printerModel)) return false
  if (/\b(5M|AD5M|AD5X|Adventurer 5|Creator 5|Guider 3|Guider 4|G4)\b/i.test(printerModel)) return false
  return /Adventurer [34]|Finder|Guider|Creator|Dreamer|Inventor/i.test(printerModel)
}

export interface GxInfo {
  printSeconds: number
  filamentMm: number
  layerHeightMm: number
  shells: number
  speedMmS: number
  bedTemp: number
  nozzleTemp: number
}

/** Header numbers from OrcaSlicer's G-code comments. */
export function gxInfoFromGcode(text: string): GxInfo {
  const val = (key: string) => {
    const m = new RegExp(`^; ${key} = ([^\\r\\n]*)`, 'm').exec(text)
    const n = m ? parseFloat(m[1]!.split(',')[0]!) : NaN
    return Number.isFinite(n) ? n : 0
  }
  const time = /^; estimated printing time \(normal mode\) = ([^\r\n]+)/m.exec(text)?.[1] ?? /^; total estimated time: ([^;\r\n]+)/m.exec(text)?.[1] ?? ''
  let seconds = 0
  for (const m of time.matchAll(/(\d+(?:\.\d+)?)\s*([dhms])/g)) seconds += Number(m[1]) * { d: 86400, h: 3600, m: 60, s: 1 }[m[2] as 'd' | 'h' | 'm' | 's']
  return {
    printSeconds: Math.round(seconds),
    filamentMm: val('filament used \\[mm\\]'),
    layerHeightMm: val('layer_height'),
    shells: val('wall_loops'),
    speedMmS: val('sparse_infill_speed') || val('outer_wall_speed'),
    bedTemp: val('hot_plate_temp') || val('bed_temperature'),
    nozzleTemp: val('nozzle_temperature'),
  }
}

/**
 * The preview: a complete 24-bit BMP, 80×60, rows bottom-up. `grey` is 80×60 brightness values,
 * top row first; without it the preview is plain dark grey.
 */
export function gxThumbnail(grey?: Uint8Array): Uint8Array {
  const out = new Uint8Array(BMP_SIZE)
  const v = new DataView(out.buffer)
  out[0] = 0x42 // B
  out[1] = 0x4d // M
  v.setUint32(2, BMP_SIZE, true)
  v.setUint32(10, BMP_HEADER, true) // pixel data offset
  v.setUint32(14, 40, true) // BITMAPINFOHEADER
  v.setInt32(18, GX_THUMB_W, true)
  v.setInt32(22, GX_THUMB_H, true) // positive: bottom-up rows
  v.setUint16(26, 1, true) // planes
  v.setUint16(28, 24, true) // bits per pixel
  v.setUint32(30, 0, true) // no compression
  v.setUint32(34, GX_THUMB_W * GX_THUMB_H * 3, true)
  v.setInt32(38, 0x1274, true) // ~120 dpi, as FlashPrint writes
  v.setInt32(42, 0x1274, true)
  for (let y = 0; y < GX_THUMB_H; y++) {
    const src = GX_THUMB_H - 1 - y
    for (let x = 0; x < GX_THUMB_W; x++) {
      const g = grey ? grey[src * GX_THUMB_W + x]! : 0x30
      const o = BMP_HEADER + (y * GX_THUMB_W + x) * 3
      out[o] = out[o + 1] = out[o + 2] = g
    }
  }
  return out
}

/** Wraps G-code in a .gx file. */
export function toGx(gcode: Uint8Array, info: GxInfo, grey?: Uint8Array): Uint8Array {
  const thumb = gxThumbnail(grey)
  const gcodeAt = HEADER + thumb.length
  const out = new Uint8Array(gcodeAt + gcode.length)
  const v = new DataView(out.buffer)
  out.set(new TextEncoder().encode(MAGIC), 0) // then zero padding to 16 bytes
  v.setUint32(0x10, HEADER, true)
  v.setUint32(0x14, gcodeAt, true)
  v.setUint32(0x18, gcodeAt, true)
  const u32 = (n: number) => Math.max(0, Math.min(0xffffffff, Math.round(n)))
  const u16 = (n: number) => Math.max(0, Math.min(0xffff, Math.round(n)))
  v.setUint32(0x1c, u32(info.printSeconds), true)
  v.setUint32(0x20, u32(info.filamentMm), true) // right (only) extruder
  v.setUint32(0x24, 0, true) // left extruder
  v.setUint16(0x28, 0x0b, true) // single extruder
  v.setUint16(0x2a, u16(info.layerHeightMm * 1000), true)
  v.setUint16(0x2c, 0, true)
  v.setUint16(0x2e, u16(info.shells), true)
  v.setUint16(0x30, u16(info.speedMmS), true)
  v.setUint16(0x32, u16(info.bedTemp), true)
  v.setUint16(0x34, u16(info.nozzleTemp), true)
  v.setUint16(0x36, 0, true) // left extruder temperature
  v.setUint16(0x38, 0, true)
  out.set(thumb, HEADER)
  out.set(gcode, gcodeAt)
  return out
}

/** The printer_model OrcaSlicer recorded in the G-code. */
export const printerModelOf = (text: string) => /^; printer_model = ([^\r\n]+)/m.exec(text)?.[1]?.trim() ?? null
