// Exposure test print: five identical test pieces side by side, each lit at a different
// brightness, so one print shows which exposure suits a resin. A .goo file has one exposure time per
// layer, so the pieces get different grey levels: a dimmer piece receives less light in the same time.

import { gooHeader, GOO_ENDING, LayerEncoder, layerRecord } from './goo.ts'
import { estimateSeconds, layerExposure, type ResinPrinter, type ResinSettings } from './printers.ts'
import type { ResinOutput } from './slice.ts'

/** Share of the chosen exposure each piece gets, left to right. */
export const TEST_LEVELS = [0.6, 0.8, 1, 1.2, 1.4]
/** Test piece size (mm), gap between pieces, base and feature heights. */
const PIECE = 10
const GAP = 3
const BASE_MM = 1
const FEATURE_MM = 4
/** Pin and hole diameters (mm). */
export const TEST_SIZES = [0.3, 0.5, 0.7, 0.9]

/** Lit areas of a test piece, in mm from its corner (u right, v up). */
function lit(u: number, v: number, base: boolean, index: number) {
  if (u < 0 || v < 0 || u >= PIECE || v >= PIECE) return false
  if (base) return true
  // Frame round the edge.
  if (u < 0.8 || v < 0.8 || u >= PIECE - 0.8 || v >= PIECE - 0.8) return true
  // Counting dots: piece n has n of them.
  for (let k = 0; k <= index; k++) {
    const x = 1.6 + k * 1.1
    if (u >= x && u < x + 0.6 && v >= 1.2 && v < 1.8) return true
  }
  // Pins of growing size.
  for (let k = 0; k < TEST_SIZES.length; k++) {
    const dx = u - (2 + k * 2), dy = v - 3.2
    if (dx * dx + dy * dy <= (TEST_SIZES[k]! / 2) ** 2) return true
  }
  // A solid block with holes of the same sizes.
  if (u >= 1.3 && u < PIECE - 1.3 && v >= 5 && v < 8.6) {
    for (let k = 0; k < TEST_SIZES.length; k++) {
      const dx = u - (2 + k * 2), dy = v - 6.8
      if (dx * dx + dy * dy <= (TEST_SIZES[k]! / 2) ** 2) return false
    }
    return true
  }
  return false
}

/** Builds the test print as a .goo file for `printer`, around the exposure in `settings`. */
export function exposureTest(printer: ResinPrinter, settings: ResinSettings, softwareVersion: string): ResinOutput & { times: number[] } {
  const s = { ...settings }
  const pr = printer
  const n = TEST_LEVELS.length
  const width = n * PIECE + (n - 1) * GAP
  if (width > pr.sizeX || PIECE > pr.sizeY) throw new Error(`The test needs a ${width} × ${PIECE} mm plate.`)
  const times = TEST_LEVELS.map((f) => Math.round(s.exposure * f * 10) / 10)
  const longest = Math.max(...times)
  // Every layer is exposed for the longest time; each piece's grey level scales it down.
  s.exposure = longest
  const grey = times.map((t) => Math.max(1, Math.min(255, Math.round((255 * t) / longest))))
  const pxW = pr.sizeX / pr.resX
  const pxH = pr.sizeY / pr.resY
  const left = (pr.sizeX - width) / 2
  const top = (pr.sizeY - PIECE) / 2
  // Each piece's lit spans per pixel row, computed once for the base and once for the features.
  const rowsOf = (base: boolean) => {
    const rows: [number, number, number][][] = []
    const r0 = Math.floor(top / pxH)
    const r1 = Math.ceil((top + PIECE) / pxH)
    for (let r = 0; r < pr.resY; r++) {
      const spans: [number, number, number][] = []
      if (r >= r0 && r < r1) {
        const v = PIECE - ((r + 0.5) * pxH - top)
        for (let i = 0; i < n; i++) {
          const x0 = left + i * (PIECE + GAP)
          // Columns the piece covers; mirrored images run right to left.
          const c0 = Math.floor((s.mirror ? pr.sizeX - x0 - PIECE : x0) / pxW)
          const c1 = Math.ceil((s.mirror ? pr.sizeX - x0 : x0 + PIECE) / pxW)
          let start = -1
          for (let c = c0; c <= c1; c++) {
            // Plate position of pixel column c's centre.
            const xmm = s.mirror ? pr.sizeX - (c + 0.5) * pxW : (c + 0.5) * pxW
            const on = c < c1 && lit(xmm - x0, v, base, i)
            if (on && start < 0) start = c
            if (!on && start >= 0) {
              spans.push([start, c, grey[i]!])
              start = -1
            }
          }
        }
      }
      rows.push(spans.sort((a, b) => a[0] - b[0]))
    }
    return rows
  }
  const baseRows = rowsOf(true)
  const featureRows = rowsOf(false)
  const layers = Math.round((BASE_MM + FEATURE_MM) / s.layerHeight)
  const baseLayers = Math.round(BASE_MM / s.layerHeight)
  const parts: Uint8Array[] = [new Uint8Array(0)]
  let bytes = 0
  let litPx = 0
  for (let l = 0; l < layers; l++) {
    const rows = l < baseLayers ? baseRows : featureRows
    const enc = new LayerEncoder()
    for (const spans of rows) {
      let pos = 0
      for (const [a, b, g] of spans) {
        enc.run(a - pos, 0)
        enc.run(b - a, l < baseLayers ? 255 : g)
        pos = b
      }
      enc.run(pr.resX - pos, 0)
    }
    const image = enc.finish()
    litPx += enc.lit
    const bottom = l < s.bottomLayers
    const rec = layerRecord(s, { z: (l + 1) * s.layerHeight, exposure: layerExposure(s, l), bottom }, image)
    parts.push(rec)
    bytes += rec.length
  }
  const volumeMm3 = litPx * pxW * pxH * s.layerHeight
  const printSeconds = estimateSeconds(s, layers)
  const weightG = (volumeMm3 / 1000) * s.density
  parts[0] = gooHeader({ printer: pr, settings: s, layers, printSeconds, volumeMm3, weightG, softwareVersion, date: new Date() })
  parts.push(GOO_ENDING)
  bytes += parts[0].length + GOO_ENDING.length
  return { parts, layers, printSeconds, volumeMm3, weightG, bytes, size: { x: width, y: PIECE, z: BASE_MM + FEATURE_MM }, islands: [], islandCount: 0, times }
}
