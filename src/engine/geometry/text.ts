// Text as solid geometry: letters are drawn with an installed font on an (offscreen) canvas, their
// outlines traced with marching squares, and the outlines extruded with Manifold. Then the text is
// raised from, or sunk into, the top or front of a model.

import type { Manifold as ManifoldT } from 'manifold-3d'
import { toManifold, toTriangles, CsgError, type Wasm } from './csg.ts'

export type TextPlace = 'top' | 'front'
export type TextMode = 'emboss' | 'engrave' | 'separate'

export interface TextOptions {
  text: string
  font: string
  bold: boolean
  /** Height of capital letters (mm). */
  size: number
  /** How far it stands out or cuts in (mm). */
  depth: number
  place: TextPlace
  mode: TextMode
}

type Pt = [number, number]

/** Closed outlines of `text` in mm (y up, baseline at 0, centred on x). */
export function textOutlines(opts: Pick<TextOptions, 'text' | 'font' | 'bold' | 'size'>): Pt[][] {
  const px = 160 // pixels per cap height: enough for smooth curves at print sizes
  const font = `${opts.bold ? 'bold ' : ''}${px * 1.4}px "${opts.font.replace(/["\\]/g, '')}", sans-serif`
  const probe = new OffscreenCanvas(8, 8).getContext('2d')!
  probe.font = font
  const lines = opts.text.split(/\r?\n/).slice(0, 8)
  const metrics = lines.map((l) => probe.measureText(l || ' '))
  const capM = probe.measureText('H')
  const cap = capM.actualBoundingBoxAscent || px
  const lineH = cap * 1.5
  const pad = 8
  const width = Math.ceil(Math.max(...metrics.map((m) => m.actualBoundingBoxLeft + m.actualBoundingBoxRight)) + pad * 2)
  const asc = Math.max(...metrics.map((m) => m.actualBoundingBoxAscent))
  const desc = Math.max(...metrics.map((m) => m.actualBoundingBoxDescent))
  const height = Math.ceil(asc + desc + lineH * (lines.length - 1) + pad * 2)
  if (width * height > 40_000_000) throw new CsgError('That text is too long. Use fewer letters or lines.')
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.font = font
  ctx.fillStyle = '#fff'
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'center'
  lines.forEach((l, i) => ctx.fillText(l, width / 2, pad + asc + i * lineH))
  const alpha = ctx.getImageData(0, 0, width, height).data
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= width || y >= height ? 0 : alpha[(y * width + x) * 4 + 3]!)
  const loops = marchingSquares(at, width, height, 128)
  // Pixels to mm: cap height maps to `size`; y flips so up is up; baseline of the last line at 0.
  const s = opts.size / cap
  const baseY = pad + asc + (lines.length - 1) * lineH
  return loops.map((loop) => loop.map(([x, y]) => [(x - width / 2) * s, (baseY - y) * s] as Pt))
}

/** Iso-contours of a grey image at `iso`, as closed loops with sub-pixel corners. */
function marchingSquares(at: (x: number, y: number) => number, w: number, h: number, iso: number): Pt[][] {
  // Each cell-edge crossing gets a key; segments join keys, and every key ends up with two links.
  const links = new Map<string, string[]>()
  const pts = new Map<string, Pt>()
  const edgePoint = (x0: number, y0: number, x1: number, y1: number): string => {
    const a = at(x0, y0), b = at(x1, y1)
    const t = (iso - a) / (b - a)
    const key = x0 === x1 ? `v${x0},${Math.min(y0, y1)}` : `h${Math.min(x0, x1)},${y0}`
    if (!pts.has(key)) pts.set(key, [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t])
    return key
  }
  for (let y = -1; y < h; y++)
    for (let x = -1; x < w; x++) {
      const tl = at(x, y) >= iso ? 1 : 0, tr = at(x + 1, y) >= iso ? 1 : 0
      const br = at(x + 1, y + 1) >= iso ? 1 : 0, bl = at(x, y + 1) >= iso ? 1 : 0
      const c = tl * 8 + tr * 4 + br * 2 + bl
      if (c === 0 || c === 15) continue
      const T = () => edgePoint(x, y, x + 1, y)
      const R = () => edgePoint(x + 1, y, x + 1, y + 1)
      const B = () => edgePoint(x, y + 1, x + 1, y + 1)
      const L = () => edgePoint(x, y, x, y + 1)
      // Inside kept on one side consistently, so loops come out with outer and hole winding opposite.
      const seg = (a: string, b: string) => {
        links.get(a)?.push(b) ?? links.set(a, [b])
        links.get(b)?.push(a) ?? links.set(b, [a])
      }
      switch (c) {
        case 1: seg(L(), B()); break
        case 2: seg(B(), R()); break
        case 3: seg(L(), R()); break
        case 4: seg(R(), T()); break
        case 5: seg(L(), T()); seg(R(), B()); break
        case 6: seg(B(), T()); break
        case 7: seg(L(), T()); break
        case 8: seg(T(), L()); break
        case 9: seg(T(), B()); break
        case 10: seg(T(), R()); seg(B(), L()); break
        case 11: seg(T(), R()); break
        case 12: seg(R(), L()); break
        case 13: seg(R(), B()); break
        case 14: seg(B(), L()); break
      }
    }
  const loops: Pt[][] = []
  const seen = new Set<string>()
  for (const start of links.keys()) {
    if (seen.has(start)) continue
    const loop: Pt[] = []
    let prev = ''
    let k: string | undefined = start
    while (k && !seen.has(k)) {
      seen.add(k)
      loop.push(pts.get(k)!)
      const ns: string[] = links.get(k) ?? []
      const nk: string | undefined = ns[0] !== prev ? ns[0] : ns[1]
      prev = k
      k = nk
    }
    if (loop.length >= 3) loops.push(loop)
  }
  return loops
}

function extrudeText(wasm: Wasm, loops: Pt[][], height: number): ManifoldT {
  const raw = wasm.CrossSection.ofPolygons(loops as never, 'EvenOdd')
  const cs = raw.simplify(0.01)
  raw.delete()
  if (cs.isEmpty()) {
    cs.delete()
    throw new CsgError('Nothing to write: the text came out empty.')
  }
  const m = wasm.Manifold.extrude(cs, height)
  cs.delete()
  return m
}

/** Where a vertical (top) or +Y (front) ray from (a, b) first meets the solid, from outside. */
function surfaceAt(p: Float32Array, place: TextPlace, a: number, b: number): number | null {
  let best: number | null = null
  // Top: rays straight down at (x=a, y=b) – want the highest hit. Front: rays along +Y at (x=a, z=b) – want the lowest y.
  const [i, j, k] = place === 'top' ? [0, 1, 2] : [0, 2, 1]
  for (let o = 0; o + 8 < p.length; o += 9) {
    const ax = p[o + i]!, ay = p[o + j]!, bx = p[o + 3 + i]!, by = p[o + 3 + j]!, cx = p[o + 6 + i]!, cy = p[o + 6 + j]!
    const d = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay)
    if (Math.abs(d) < 1e-12) continue
    const u = ((bx - a) * (cy - b) - (cx - a) * (by - b)) / d
    const v = ((cx - a) * (ay - b) - (ax - a) * (cy - b)) / d
    if (u < 0 || v < 0 || u + v > 1) continue
    const hit = u * p[o + k]! + v * p[o + 3 + k]! + (1 - u - v) * p[o + 6 + k]!
    if (best === null || (place === 'top' ? hit > best : hit < best)) best = hit
  }
  return best
}

/**
 * Text added to (emboss), cut into (engrave) or placed beside (separate) the solid. Returns the new
 * solid (or for 'separate', the text on its own, standing on the plate next to the model).
 */
export function writeText(wasm: Wasm, solid: Float32Array, opts: TextOptions): Float32Array {
  if (!opts.text.trim()) throw new CsgError('Type some text first.')
  const loops = textOutlines(opts)
  if (!loops.length) throw new CsgError("That font didn't draw anything for this text.")
  // Text box in its own plane.
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity
  for (const l of loops)
    for (const [u, v] of l) {
      minU = Math.min(minU, u)
      maxU = Math.max(maxU, u)
      minV = Math.min(minV, v)
      maxV = Math.max(maxV, v)
    }
  const midV = (minV + maxV) / 2
  const centred = loops.map((l) => l.map(([u, v]) => [u, v - midV] as Pt))
  const halfU = (maxU - minU) / 2, halfV = (maxV - minV) / 2

  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
  for (let o = 0; o + 2 < solid.length; o += 3)
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a]!, solid[o + a]!)
      hi[a] = Math.max(hi[a]!, solid[o + a]!)
    }
  const cx = (lo[0]! + hi[0]!) / 2, cy = (lo[1]! + hi[1]!) / 2, cz = (lo[2]! + hi[2]!) / 2

  if (opts.mode === 'separate') {
    const t = extrudeText(wasm, centred, opts.depth)
    const placed = t.translate(cx, lo[1]! - halfV - 6, 0)
    t.delete()
    try {
      return toTriangles(placed)
    } finally {
      placed.delete()
    }
  }

  // Sample the surface under the text's corners and middle, so it sits on (or cuts into) it evenly.
  const [ca, cb] = opts.place === 'top' ? [cx, cy] : [cx, cz]
  const hits: number[] = []
  for (const [du, dv] of [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1], [-1, 0], [1, 0]] as const) {
    const h = surfaceAt(solid, opts.place, ca + du * halfU * 0.9, cb + dv * halfV * 0.9)
    if (h !== null) hits.push(h)
  }
  if (!hits.length) throw new CsgError(opts.place === 'top' ? 'The text would hang off the model. Make it smaller.' : 'The text would hang off the front of the model. Make it smaller.')
  if (hits.length < 7) throw new CsgError('The text is wider than that face of the model. Make it smaller or shorter.')
  const sink = 0.4
  let length: number, start: number
  if (opts.place === 'top') {
    const low = Math.min(...hits), high = Math.max(...hits)
    if (opts.mode === 'emboss') ((start = low - sink), (length = high - low + sink + opts.depth))
    else ((start = high - opts.depth - (high - low)), (length = hi[2]! - start + 1))
  } else {
    // Front faces −Y: the text's depth runs along +Y (into the model) from its start.
    const near = Math.min(...hits), far = Math.max(...hits)
    if (opts.mode === 'emboss') ((start = near - opts.depth), (length = far - near + sink + opts.depth))
    else ((start = lo[1]! - 1), (length = far - lo[1]! + 1 + opts.depth))
  }
  const t = extrudeText(wasm, centred, length)
  let placed: ManifoldT
  if (opts.place === 'top') placed = t.translate(cx, cy, start)
  else {
    // Turned +90° about X: (u, v, w) → (u, −w, v). Seen from the front (looking along +Y) u runs
    // right and v up, so it reads correctly; the extrusion runs toward −Y, ending at start + length.
    const turned = t.rotate([90, 0, 0])
    placed = turned.translate(cx, start + length, cz)
    turned.delete()
  }
  t.delete()
  const own: { delete(): void }[] = [placed]
  try {
    const base = toManifold(wasm, solid)
    own.push(base)
    const r = opts.mode === 'emboss' ? base.add(placed) : base.subtract(placed)
    own.push(r)
    if (r.isEmpty()) throw new CsgError('Nothing would be left.')
    return toTriangles(r)
  } finally {
    for (const o of own) o.delete()
  }
}
