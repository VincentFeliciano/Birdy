// Resin (MSLA) printers and the exposure settings Boaty slices with.

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
  /** The file the printer reads: Elegoo .goo (default) or Chitubox .ctb. */
  format?: ResinFormat
}

export type ResinFormat = 'goo' | 'ctb'
export const RESIN_FORMATS: Record<ResinFormat, { ext: string; label: string }> = {
  goo: { ext: 'goo', label: 'Elegoo .goo' },
  ctb: { ext: 'ctb', label: 'Chitubox .ctb' },
}
export const formatOf = (p: ResinPrinter): ResinFormat => p.format ?? 'goo'

/**
 * Resin printers and the file each one reads (.goo unless `format` says otherwise). Values are the published screen specs; the printer refuses
 * a file whose resolution doesn't match its screen, so "Custom" lets people type their own.
 */
export const RESIN_PRINTERS: ResinPrinter[] = [
  { id: 'saturn4ultra16k', name: 'Elegoo Saturn 4 Ultra 16K', resX: 15120, resY: 6230, sizeX: 211.68, sizeY: 118.37, sizeZ: 220 },
  { id: 'saturn4ultra', name: 'Elegoo Saturn 4 Ultra (12K)', resX: 11520, resY: 5120, sizeX: 218.88, sizeY: 122.88, sizeZ: 220 },
  { id: 'saturn4', name: 'Elegoo Saturn 4 (12K)', resX: 11520, resY: 5120, sizeX: 218.88, sizeY: 122.88, sizeZ: 210 },
  { id: 'saturn3ultra', name: 'Elegoo Saturn 3 Ultra (12K)', resX: 11520, resY: 5120, sizeX: 218.88, sizeY: 122.88, sizeZ: 250 },
  { id: 'mars5ultra', name: 'Elegoo Mars 5 Ultra (9K)', resX: 8520, resY: 4320, sizeX: 153.36, sizeY: 77.76, sizeZ: 165 },
  { id: 'mars5', name: 'Elegoo Mars 5 (4K)', resX: 4098, resY: 2560, sizeX: 143.43, sizeY: 89.6, sizeZ: 150 },
  // Printers with a Chitubox mainboard read .ctb files.
  { id: 'saturn3-ctb', name: 'Elegoo Saturn 3 (12K) · .ctb', resX: 11520, resY: 5120, sizeX: 218.88, sizeY: 122.88, sizeZ: 250, format: 'ctb' },
  { id: 'saturn2', name: 'Elegoo Saturn 2 (8K)', resX: 7680, resY: 4320, sizeX: 218.88, sizeY: 123.12, sizeZ: 250, format: 'ctb' },
  { id: 'saturn', name: 'Elegoo Saturn (4K)', resX: 3840, resY: 2400, sizeX: 192, sizeY: 120, sizeZ: 200, format: 'ctb' },
  { id: 'mars4-9k', name: 'Elegoo Mars 4 (9K)', resX: 8520, resY: 4320, sizeX: 153.36, sizeY: 77.76, sizeZ: 175, format: 'ctb' },
  { id: 'mars3', name: 'Elegoo Mars 3 / 3 Pro (4K)', resX: 4098, resY: 2560, sizeX: 143.43, sizeY: 89.6, sizeZ: 175, format: 'ctb' },
  { id: 'sonic-mini-8k', name: 'Phrozen Sonic Mini 8K', resX: 7500, resY: 3240, sizeX: 165, sizeY: 71.28, sizeZ: 180, format: 'ctb' },
  { id: 'sonic-mini-4k', name: 'Phrozen Sonic Mini 4K', resX: 3840, resY: 2160, sizeX: 134.4, sizeY: 75.6, sizeZ: 130, format: 'ctb' },
  { id: 'sonic-mighty-8k', name: 'Phrozen Sonic Mighty 8K', resX: 7680, resY: 4320, sizeX: 218.88, sizeY: 123.12, sizeZ: 235, format: 'ctb' },
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
  /**
   * Two-stage motion (Chitubox's TSMC): after the first lift, a second lift of this many mm at its
   * own speed; on the way back, the last `retract2Distance` mm at `retract2Speed`. 0 turns it off.
   */
  lift2Distance: number
  lift2Speed: number
  retract2Distance: number
  retract2Speed: number
  /** Waits (s) before the lift, at the top, and after the plate returns. */
  restBeforeLift: number
  restAfterLift: number
  restAfterRetract: number
  /** Layers after the bottom ones whose exposure steps down evenly to the normal exposure. */
  transitionLayers: number
  /** Smooth edges with grey pixels (anti-aliasing). */
  antialias: boolean
  /** Grey levels used for smoothing: 2, 4, 8 or 16, or 0 for every level (256). */
  aaLevel: number
  /** UV light power, 0–255 (255 = full), for normal and bottom layers. */
  lightPwm: number
  bottomLightPwm: number
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
  lift2Distance: 0,
  lift2Speed: 180,
  retract2Distance: 0,
  retract2Speed: 60,
  restBeforeLift: 0,
  restAfterLift: 0,
  restAfterRetract: 0,
  transitionLayers: 0,
  antialias: true,
  aaLevel: 0,
  lightPwm: 255,
  bottomLightPwm: 255,
  mirror: false,
  density: 1.1,
}

/** Settings saved before a field existed get its default. */
export const withResinDefaults = (s: Partial<ResinSettings>): ResinSettings => ({ ...DEFAULT_RESIN, ...s })

/** Exposure (s) of layer `l` (0 = first): bottom, then the transition steps, then normal. */
export function layerExposure(s: ResinSettings, l: number): number {
  if (l < s.bottomLayers) return s.bottomExposure
  const t = Math.max(0, Math.round(s.transitionLayers || 0))
  const i = l - s.bottomLayers
  if (i < t) return Math.round((s.bottomExposure - ((s.bottomExposure - s.exposure) * (i + 1)) / (t + 1)) * 100) / 100
  return s.exposure
}

/** How the plate moves on one layer: both lift stages and both return stages (mm, mm/min). */
export function layerMotion(s: ResinSettings, bottom: boolean) {
  const lift1 = bottom ? s.bottomLiftDistance : s.liftDistance
  const speed1 = bottom ? s.bottomLiftSpeed : s.liftSpeed
  const lift2 = Math.max(0, s.lift2Distance || 0)
  const total = lift1 + lift2
  const retract2 = Math.min(total, Math.max(0, s.retract2Distance || 0))
  return {
    lift1,
    speed1,
    lift2,
    speed2: lift2 ? s.lift2Speed : 0,
    retract1: total - retract2,
    retractSpeed1: s.retractSpeed,
    retract2,
    retractSpeed2: retract2 ? s.retract2Speed : 0,
  }
}

/** Seconds one layer takes: exposure, waits, then the lift and the return (both stages). */
export function layerSeconds(s: ResinSettings, bottom: boolean, exposure = bottom ? s.bottomExposure : s.exposure) {
  const m = layerMotion(s, bottom)
  const t = (d: number, v: number) => (d > 0 ? (d / Math.max(1, v)) * 60 : 0)
  return (
    exposure +
    s.lightOff +
    (s.restBeforeLift || 0) +
    (s.restAfterLift || 0) +
    (s.restAfterRetract || 0) +
    t(m.lift1, m.speed1) +
    t(m.lift2, m.speed2) +
    t(m.retract1, m.retractSpeed1) +
    t(m.retract2, m.retractSpeed2)
  )
}

export function estimateSeconds(s: ResinSettings, layers: number) {
  let total = 0
  for (let l = 0; l < layers; l++) total += layerSeconds(s, l < s.bottomLayers, layerExposure(s, l))
  return total
}
