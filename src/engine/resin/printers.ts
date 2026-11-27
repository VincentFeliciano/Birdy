// Resin (MSLA) printers and the exposure settings Birdy slices with.

export interface ResinPrinter {
  id: string
  name: string
  /** LCD resolution in pixels: x is the long side. */
  resX: number
  resY: number
  /** Printable area in mm (matches the LCD) and maximum height. */
  sizeX: number
  sizeY: number
  sizeZ: number
}

/**
 * Elegoo printers that read .goo files. Values are the published screen specs; the printer refuses
 * a file whose resolution doesn't match its screen, so "Custom" lets people type their own.
 */
export const RESIN_PRINTERS: ResinPrinter[] = [
  { id: 'saturn4ultra16k', name: 'Elegoo Saturn 4 Ultra 16K', resX: 15120, resY: 6230, sizeX: 211.68, sizeY: 118.37, sizeZ: 220 },
  { id: 'saturn4ultra', name: 'Elegoo Saturn 4 Ultra (12K)', resX: 11520, resY: 5120, sizeX: 218.88, sizeY: 122.88, sizeZ: 220 },
  { id: 'saturn4', name: 'Elegoo Saturn 4 (12K)', resX: 11520, resY: 5120, sizeX: 218.88, sizeY: 122.88, sizeZ: 210 },
  { id: 'saturn3ultra', name: 'Elegoo Saturn 3 Ultra (12K)', resX: 11520, resY: 5120, sizeX: 218.88, sizeY: 122.88, sizeZ: 250 },
  { id: 'mars5ultra', name: 'Elegoo Mars 5 Ultra (9K)', resX: 8520, resY: 4320, sizeX: 153.36, sizeY: 77.76, sizeZ: 165 },
  { id: 'mars5', name: 'Elegoo Mars 5 (4K)', resX: 4098, resY: 2560, sizeX: 143.43, sizeY: 89.6, sizeZ: 150 },
]

export interface ResinSettings {
  /** Layer height in mm. */
  layerHeight: number
  /** Normal layer exposure in seconds. */
  exposure: number
  /** Exposure of the first (bottom) layers in seconds, so the print sticks to the plate. */
  bottomExposure: number
  bottomLayers: number
  /** Light-off wait between layers in seconds. */
  lightOff: number
  liftDistance: number
  /** mm/min */
  liftSpeed: number
  bottomLiftDistance: number
  bottomLiftSpeed: number
  retractSpeed: number
  /** Smooth edges with grey pixels (anti-aliasing). */
  antialias: boolean
  /** Mirror the layer images left-to-right. */
  mirror: boolean
  /** g/ml, for the weight estimate. */
  density: number
}

export const DEFAULT_RESIN: ResinSettings = {
  layerHeight: 0.05,
  exposure: 2.5,
  bottomExposure: 30,
  bottomLayers: 5,
  lightOff: 0.5,
  liftDistance: 5,
  liftSpeed: 60,
  bottomLiftDistance: 6,
  bottomLiftSpeed: 45,
  retractSpeed: 150,
  antialias: true,
  mirror: false,
  density: 1.1,
}

/** Seconds one layer takes: exposure, light-off wait, then the lift and the return. */
export function layerSeconds(s: ResinSettings, bottom: boolean) {
  const exp = bottom ? s.bottomExposure : s.exposure
  const dist = bottom ? s.bottomLiftDistance : s.liftDistance
  const lift = bottom ? s.bottomLiftSpeed : s.liftSpeed
  return exp + s.lightOff + (dist / Math.max(1, lift)) * 60 + (dist / Math.max(1, s.retractSpeed)) * 60
}

export function estimateSeconds(s: ResinSettings, layers: number) {
  const bottom = Math.min(layers, s.bottomLayers)
  return bottom * layerSeconds(s, true) + (layers - bottom) * layerSeconds(s, false)
}
