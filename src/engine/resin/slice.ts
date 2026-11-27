// Resin slicer: cuts a triangle mesh into layers and rasterises each layer straight into the
// printer's run-length encoding, a row at a time, so a 12K layer never exists as a full bitmap.

import { gooHeader, GOO_ENDING, LayerEncoder, layerRecord, type HeaderInfo } from './goo.ts'
import { estimateSeconds, type ResinPrinter, type ResinSettings } from './printers.ts'

export interface ResinJob {
  /** World-space, non-indexed triangles (x,y,z per vertex). */
  positions: Float32Array
  printer: ResinPrinter
  settings: ResinSettings
  softwareVersion: string
  smallPreview?: Uint8ClampedArray
  bigPreview?: Uint8ClampedArray
}

/** A spot that starts in mid-air: lit in its layer with nothing lit under it in the layer before. */
export interface ResinIsland {
  /** 0-based layer where it starts. */
  layer: number
  /** Centre in the model's coordinates as sliced (mm). */
  x: number
  y: number
  z: number
  areaMm2: number
  /** Centre and radius in layer-image pixels, for the layer preview. */
  col: number
  row: number
  radiusPx: number
}

/** Islands smaller than this many pixels are sampling noise, not real features. */
const MIN_ISLAND_PX = 3
const MAX_ISLANDS = 1000

export interface ResinOutput {
  /** The .goo file in pieces: header, one record per layer, ending. */
  parts: Uint8Array[]
  layers: number
  printSeconds: number
  volumeMm3: number
  weightG: number
  bytes: number
  /** Model size as sliced (mm). */
  size: { x: number; y: number; z: number }
  /** Unsupported islands, at most MAX_ISLANDS of them; `islandCount` has the full count. */
  islands: ResinIsland[]
  islandCount: number
}

export class ResinFitError extends Error {}

/** Slices `job` into a .goo file. `progress` gets 0..1; return false from it to stop. */
export function sliceResin(job: ResinJob, progress?: (done: number) => boolean | void): ResinOutput {
  const { positions: p, printer: pr, settings: s } = job
  const triCount = Math.floor(p.length / 9)
  if (!triCount) throw new ResinFitError('The model has no triangles to slice.')
  if (!(s.layerHeight >= 0.01 && s.layerHeight <= 0.3)) throw new ResinFitError('Layer height must be between 0.01 and 0.3 mm.')

  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i]!, y = p[i + 1]!, z = p[i + 2]!
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
  }
  const size = { x: maxX - minX, y: maxY - minY, z: maxZ - minZ }
  if (!(size.z > 0)) throw new ResinFitError('The model is flat; there is nothing to slice.')
  if (size.x > pr.sizeX || size.y > pr.sizeY) {
    const turned = size.y <= pr.sizeX && size.x <= pr.sizeY ? ' Turning it 90° on the plate would make it fit.' : ' Scale it down or split it.'
    throw new ResinFitError(
      `The model is ${size.x.toFixed(1)} × ${size.y.toFixed(1)} mm but the ${pr.name} plate is ${pr.sizeX} × ${pr.sizeY} mm.${turned}`,
    )
  }
  if (size.z > pr.sizeZ) throw new ResinFitError(`The model is ${size.z.toFixed(1)} mm tall; the ${pr.name} prints up to ${pr.sizeZ} mm.`)

  // Centre the model on the plate and stand it on the plate. Pixel space: column 0 is the plate's
  // left edge (−X), row 0 its back edge (+Y).
  const pxW = pr.sizeX / pr.resX
  const pxH = pr.sizeY / pr.resY
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const col = s.mirror ? (x: number) => pr.resX - (x - cx + pr.sizeX / 2) / pxW : (x: number) => (x - cx + pr.sizeX / 2) / pxW
  const row = (y: number) => (pr.sizeY / 2 - (y - cy)) / pxH
  const flip = s.mirror ? -1 : 1

  // Triangles sorted by their lowest point so each layer only looks at the ones it can cut.
  const tMin = new Float64Array(triCount)
  const tMax = new Float64Array(triCount)
  for (let t = 0; t < triCount; t++) {
    const o = t * 9
    tMin[t] = Math.min(p[o + 2]!, p[o + 5]!, p[o + 8]!) - minZ
    tMax[t] = Math.max(p[o + 2]!, p[o + 5]!, p[o + 8]!) - minZ
  }
  const order = new Uint32Array(triCount)
  for (let t = 0; t < triCount; t++) order[t] = t
  order.sort((a, b) => tMin[a]! - tMin[b]!)

  const h = s.layerHeight
  const layerCount = Math.max(1, Math.ceil(size.z / h - 1e-6))
  const parts: Uint8Array[] = [new Uint8Array(0)]
  let bytes = 0
  let litPixels = 0

  let active: number[] = []
  let next = 0
  // Crossings of the current layer: per segment (c1, r1, c2, r2) and winding sign.
  let seg = new Float64Array(4096 * 4)
  let segW = new Int8Array(4096)
  const rowCount = new Int32Array(pr.resY + 1)
  let xs = new Float64Array(4096)
  let ws = new Int8Array(4096)
  // Lit pixel spans (binary, by pixel centre) of this layer and the one below, for island checks.
  let cur = new SpanSet(pr.resY)
  let prev = new SpanSet(pr.resY)
  const islands: ResinIsland[] = []
  let islandCount = 0
  const toX = s.mirror ? (c: number) => (pr.resX - c) * pxW + cx - pr.sizeX / 2 : (c: number) => c * pxW + cx - pr.sizeX / 2
  const toY = (r: number) => cy + pr.sizeY / 2 - r * pxH

  for (let l = 0; l < layerCount; l++) {
    const z = (l + 0.5) * h
    while (next < triCount && tMin[order[next]!]! <= z) active.push(order[next++]!)
    active = active.filter((t) => tMax[t]! > z)

    // 1. Cut every active triangle with the plane z.
    let nSeg = 0
    for (const t of active) {
      const o = t * 9
      const az = p[o + 2]! - minZ, bz = p[o + 5]! - minZ, cz = p[o + 8]! - minZ
      const ua = az > z, ub = bz > z, uc = cz > z
      if (ua === ub && ub === uc) continue
      // Sign of the face normal's x part says whether a ray along +x enters or leaves the solid.
      const ux = p[o + 3]! - p[o]!, uy = p[o + 4]! - p[o + 1]!, uz = bz - az
      const vx = p[o + 6]! - p[o]!, vy = p[o + 7]! - p[o + 1]!, vz = cz - az
      const nx = uy * vz - uz * vy
      if (nx === 0) continue
      let k = 0
      const pts = [0, 0, 0, 0]
      const edge = (i: number, j: number, zi: number, zj: number) => {
        const f = (z - zi) / (zj - zi)
        pts[k++] = p[o + i]! + (p[o + j]! - p[o + i]!) * f
        pts[k++] = p[o + i + 1]! + (p[o + j + 1]! - p[o + i + 1]!) * f
      }
      if (ua !== ub) edge(0, 3, az, bz)
      if (ub !== uc) edge(3, 6, bz, cz)
      if (k < 4 && uc !== ua) edge(6, 0, cz, az)
      if (k < 4) continue
      if (nSeg * 4 + 4 > seg.length) {
        const grown = new Float64Array(seg.length * 2)
        grown.set(seg)
        seg = grown
        const grownW = new Int8Array(segW.length * 2)
        grownW.set(segW)
        segW = grownW
      }
      seg[nSeg * 4] = col(pts[0]!)
      seg[nSeg * 4 + 1] = row(pts[1]!)
      seg[nSeg * 4 + 2] = col(pts[2]!)
      seg[nSeg * 4 + 3] = row(pts[3]!)
      segW[nSeg] = (nx > 0 ? -1 : 1) * flip
      nSeg++
    }

    // 2. Bucket the crossings by pixel row (counting sort), sampling each row at its centre.
    rowCount.fill(0)
    let total = 0
    for (let i = 0; i < nSeg; i++) {
      const r1 = seg[i * 4 + 1]!, r2 = seg[i * 4 + 3]!
      const lo = Math.max(0, Math.ceil(Math.min(r1, r2) - 0.5))
      const hi = Math.min(pr.resY, Math.ceil(Math.max(r1, r2) - 0.5))
      for (let r = lo; r < hi; r++) rowCount[r + 1]!++
      if (hi > lo) total += hi - lo
    }
    for (let r = 0; r < pr.resY; r++) rowCount[r + 1]! += rowCount[r]!
    if (total > xs.length) {
      xs = new Float64Array(total * 2)
      ws = new Int8Array(total * 2)
    }
    const fill = rowCount.slice(0, pr.resY)
    for (let i = 0; i < nSeg; i++) {
      const c1 = seg[i * 4]!, r1 = seg[i * 4 + 1]!, c2 = seg[i * 4 + 2]!, r2 = seg[i * 4 + 3]!
      const lo = Math.max(0, Math.ceil(Math.min(r1, r2) - 0.5))
      const hi = Math.min(pr.resY, Math.ceil(Math.max(r1, r2) - 0.5))
      for (let r = lo; r < hi; r++) {
        const f = (r + 0.5 - r1) / (r2 - r1)
        const at = fill[r]!++
        xs[at] = c1 + (c2 - c1) * f
        ws[at] = segW[i]!
      }
    }

    // 3. Sweep each row: inside wherever the winding number is non-zero, so overlapping parts
    //    (a model and its supports) merge instead of cancelling out.
    const enc = new LayerEncoder()
    const emit = rowEmitter(enc, pr.resX, s.antialias)
    cur.reset()
    for (let r = 0; r < pr.resY; r++) {
      cur.startRow(r)
      const a = rowCount[r]!
      const b = rowCount[r + 1]!
      if (b > a) {
        sortPairs(xs, ws, a, b)
        let wind = 0
        let start = 0
        for (let i = a; i < b; i++) {
          const was = wind
          wind += ws[i]!
          if (was === 0 && wind !== 0) start = xs[i]!
          else if (was !== 0 && wind === 0) {
            emit.span(start, xs[i]!)
            cur.add(Math.max(0, Math.ceil(start - 0.5)), Math.min(pr.resX, Math.ceil(xs[i]! - 0.5)))
          }
        }
      }
      emit.endRow()
    }
    cur.endLayer()
    if (l > 0) {
      for (const g of findIslands(cur, prev)) {
        if (g.pixels < MIN_ISLAND_PX) continue
        islandCount++
        if (islands.length >= MAX_ISLANDS) continue
        const area = g.pixels * pxW * pxH
        islands.push({
          layer: l,
          x: toX(g.col),
          y: toY(g.row),
          z: minZ + (l + 0.5) * h,
          areaMm2: area,
          col: g.col,
          row: g.row,
          radiusPx: Math.max(g.halfW, g.halfH),
        })
      }
    }
    ;[cur, prev] = [prev, cur]
    const image = enc.finish()
    litPixels += enc.lit
    const record = layerRecord(s, { z: (l + 1) * h, exposure: l < s.bottomLayers ? s.bottomExposure : s.exposure, bottom: l < s.bottomLayers }, image)
    parts.push(record)
    bytes += record.length
    if (progress && progress((l + 1) / layerCount) === false) throw new Error('canceled')
  }

  const volumeMm3 = litPixels * pxW * pxH * h
  const printSeconds = estimateSeconds(s, layerCount)
  const weightG = (volumeMm3 / 1000) * s.density
  const info: HeaderInfo = {
    printer: pr,
    settings: s,
    layers: layerCount,
    printSeconds,
    volumeMm3,
    weightG,
    smallPreview: job.smallPreview,
    bigPreview: job.bigPreview,
    softwareVersion: job.softwareVersion,
    date: new Date(),
  }
  parts[0] = gooHeader(info)
  parts.push(GOO_ENDING)
  bytes += parts[0].length + GOO_ENDING.length
  return { parts, layers: layerCount, printSeconds, volumeMm3, weightG, bytes, size, islands, islandCount }
}

/** Lit pixel spans of one layer, [a, b) per row, rows in order. */
class SpanSet {
  a = new Int32Array(1024)
  b = new Int32Array(1024)
  n = 0
  /** rowStart[r]..rowStart[r+1] are row r's spans. */
  rowStart: Int32Array
  private row = -1
  private rows: number
  constructor(rows: number) {
    this.rows = rows
    this.rowStart = new Int32Array(rows + 1)
  }
  reset() {
    this.n = 0
    this.row = -1
  }
  startRow(r: number) {
    while (this.row < r) this.rowStart[++this.row] = this.n
  }
  add(a: number, b: number) {
    if (b <= a) return
    // Spans arrive in order; join one that touches the last.
    if (this.n > this.rowStart[this.row]! && this.b[this.n - 1]! >= a) {
      if (b > this.b[this.n - 1]!) this.b[this.n - 1] = b
      return
    }
    if (this.n === this.a.length) {
      const na = new Int32Array(this.n * 2)
      na.set(this.a)
      this.a = na
      const nb = new Int32Array(this.n * 2)
      nb.set(this.b)
      this.b = nb
    }
    this.a[this.n] = a
    this.b[this.n] = b
    this.n++
  }
  endLayer() {
    this.startRow(this.rows)
  }
}

interface SpanGroup {
  pixels: number
  col: number
  row: number
  halfW: number
  halfH: number
}

/**
 * Groups the layer's spans into connected regions (8-neighbour) and returns the ones that touch
 * nothing lit in the layer below.
 */
export function findIslands(cur: SpanSet, prev: SpanSet): SpanGroup[] {
  const n = cur.n
  if (!n) return []
  const parent = new Int32Array(n)
  for (let i = 0; i < n; i++) parent[i] = i
  const find = (i: number) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!
      i = parent[i]!
    }
    return i
  }
  const rows = cur.rowStart.length - 1
  // Join spans in neighbouring rows that touch, including diagonally.
  for (let r = 1; r < rows; r++) {
    let i = cur.rowStart[r - 1]!
    const iEnd = cur.rowStart[r]!
    let j = cur.rowStart[r]!
    const jEnd = cur.rowStart[r + 1]!
    while (i < iEnd && j < jEnd) {
      if (cur.a[i]! <= cur.b[j]! && cur.a[j]! <= cur.b[i]!) {
        const ri = find(i), rj = find(j)
        if (ri !== rj) parent[ri] = rj
      }
      if (cur.b[i]! < cur.b[j]!) i++
      else j++
    }
  }
  // A region is held up if any of its pixels sits on a lit pixel of the layer below.
  const held = new Uint8Array(n)
  for (let r = 0; r < rows; r++) {
    let i = cur.rowStart[r]!
    const iEnd = cur.rowStart[r + 1]!
    let j = prev.rowStart[r]!
    const jEnd = prev.rowStart[r + 1]!
    while (i < iEnd && j < jEnd) {
      if (cur.a[i]! < prev.b[j]! && prev.a[j]! < cur.b[i]!) held[i] = 1
      if (cur.b[i]! < prev.b[j]!) i++
      else j++
    }
  }
  for (let i = 0; i < n; i++) if (held[i]) held[find(i)] = 1
  const groups = new Map<number, { px: number; sc: number; sr: number; c0: number; c1: number; r0: number; r1: number }>()
  for (let r = 0; r < rows; r++) {
    for (let i = cur.rowStart[r]!; i < cur.rowStart[r + 1]!; i++) {
      const root = find(i)
      if (held[root]) continue
      const a = cur.a[i]!, b = cur.b[i]!
      const len = b - a
      let g = groups.get(root)
      if (!g) groups.set(root, (g = { px: 0, sc: 0, sr: 0, c0: a, c1: b, r0: r, r1: r + 1 }))
      g.px += len
      g.sc += (len * (a + b)) / 2
      g.sr += len * (r + 0.5)
      if (a < g.c0) g.c0 = a
      if (b > g.c1) g.c1 = b
      g.r1 = r + 1
    }
  }
  return [...groups.values()].map((g) => ({
    pixels: g.px,
    col: g.sc / g.px,
    row: g.sr / g.px,
    halfW: (g.c1 - g.c0) / 2,
    halfH: (g.r1 - g.r0) / 2,
  }))
}

/** Sorts xs[a..b) ascending, carrying ws along. */
function sortPairs(xs: Float64Array, ws: Int8Array, a: number, b: number) {
  if (b - a < 48) {
    for (let i = a + 1; i < b; i++) {
      const x = xs[i]!, w = ws[i]!
      let j = i - 1
      while (j >= a && xs[j]! > x) {
        xs[j + 1] = xs[j]!
        ws[j + 1] = ws[j]!
        j--
      }
      xs[j + 1] = x
      ws[j + 1] = w
    }
    return
  }
  const idx = Array.from({ length: b - a }, (_, i) => a + i).sort((i, j) => xs[i]! - xs[j]!)
  const sx = idx.map((i) => xs[i]!)
  const sw = idx.map((i) => ws[i]!)
  xs.set(sx, a)
  ws.set(sw, a)
}

/**
 * Turns the inside spans of one row (in pixel units) into runs. With anti-aliasing, edge pixels
 * get a grey level matching how much of them the span covers; without, a pixel is lit when the
 * span covers its centre.
 */
function rowEmitter(enc: LayerEncoder, width: number, aa: boolean) {
  let pos = 0
  let pendPx = -1
  let pendCov = 0
  const gapTo = (x: number) => {
    if (x > pos) enc.run(x - pos, 0)
    pos = Math.max(pos, x)
  }
  const flush = () => {
    if (pendPx < 0) return
    const v = Math.round(Math.min(1, pendCov) * 255)
    gapTo(pendPx)
    enc.run(1, v)
    pos = pendPx + 1
    pendPx = -1
  }
  const partial = (px: number, cov: number) => {
    if (px === pendPx) {
      pendCov += cov
      return
    }
    flush()
    pendPx = px
    pendCov = cov
  }
  const full = (from: number, to: number) => {
    flush()
    if (to <= from) return
    gapTo(from)
    enc.run(to - from, 255)
    pos = to
  }
  return {
    span(a: number, b: number) {
      a = Math.max(0, a)
      b = Math.min(width, b)
      if (b <= a) return
      if (!aa) {
        full(Math.max(pos, Math.ceil(a - 0.5)), Math.ceil(b - 0.5))
        return
      }
      const ia = Math.floor(a)
      const ib = Math.floor(b)
      if (ia === ib) {
        partial(ia, b - a)
        return
      }
      partial(ia, ia + 1 - a)
      full(ia + 1, ib)
      if (b > ib && ib < width) partial(ib, b - ib)
    },
    endRow() {
      flush()
      gapTo(width)
      pos = 0
    },
  }
}
