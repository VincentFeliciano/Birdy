// Automatic supports for resin prints: lifts the model off the plate and grows tree-less "pin"
// supports (contact tip, shaft, foot) under every downward-facing area and every lowest point,
// standing on a raft. Everything is closed triangle solids; the slicer merges overlaps.

export interface SupportSettings {
  enabled: boolean
  /** Gap between the plate and the model's lowest point (mm). */
  lift: number
  /** Distance between support points under flat overhangs (mm). */
  spacing: number
  /** Diameter of the contact tip (mm). */
  tip: number
  /** Surfaces closer than this to horizontal (degrees) get supports. */
  angle: number
}

export const DEFAULT_SUPPORTS: SupportSettings = { enabled: false, lift: 5, spacing: 3, tip: 0.4, angle: 45 }

export interface SupportResult {
  /** Model (lifted) plus supports and raft. */
  positions: Float32Array
  /** Supports and raft only, in the same coordinates, for the 3D preview. */
  supports: Float32Array
  count: number
  /** Supports that stand on the model instead of the raft. */
  onModel: number
  /** Where each support touches the model: x, y pairs (so drain holes can keep clear of them). */
  contacts: Float32Array
  /** How far the model was raised (mm). */
  lift: number
}

const SIDES = 8
const RAFT = 0.8
const MAX_SUPPORTS = 6000
/** Contact points closer than this (in XY, as a fraction of the spacing) are merged. */
const MERGE = 0.6

class Tris {
  data = new Float32Array(1 << 16)
  n = 0
  push(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number) {
    if (this.n + 9 > this.data.length) {
      const g = new Float32Array(this.data.length * 2)
      g.set(this.data)
      this.data = g
    }
    const d = this.data
    let i = this.n
    d[i++] = ax; d[i++] = ay; d[i++] = az
    d[i++] = bx; d[i++] = by; d[i++] = bz
    d[i++] = cx; d[i++] = cy; d[i++] = cz
    this.n = i
  }
  out() {
    return this.data.slice(0, this.n)
  }
}

const COS = Array.from({ length: SIDES + 1 }, (_, i) => Math.cos((i / SIDES) * Math.PI * 2))
const SIN = Array.from({ length: SIDES + 1 }, (_, i) => Math.sin((i / SIDES) * Math.PI * 2))

/** A closed frustum (cone piece) with outward-facing triangles, from z0 (radius r0) up to z1 (radius r1). */
function frustum(t: Tris, x: number, y: number, z0: number, r0: number, z1: number, r1: number) {
  if (z1 <= z0) return
  for (let i = 0; i < SIDES; i++) {
    const bx0 = x + COS[i]! * r0, by0 = y + SIN[i]! * r0
    const bx1 = x + COS[i + 1]! * r0, by1 = y + SIN[i + 1]! * r0
    const tx0 = x + COS[i]! * r1, ty0 = y + SIN[i]! * r1
    const tx1 = x + COS[i + 1]! * r1, ty1 = y + SIN[i + 1]! * r1
    t.push(bx0, by0, z0, bx1, by1, z0, tx1, ty1, z1)
    t.push(bx0, by0, z0, tx1, ty1, z1, tx0, ty0, z1)
    t.push(x, y, z1, tx0, ty0, z1, tx1, ty1, z1)
    t.push(x, y, z0, bx1, by1, z0, bx0, by0, z0)
  }
}

/** A closed prism over a convex polygon (counter-clockwise from above). */
function prism(t: Tris, poly: [number, number][], z0: number, z1: number) {
  const n = poly.length
  const [ox, oy] = poly[0]!
  for (let i = 1; i < n - 1; i++) {
    const [ax, ay] = poly[i]!
    const [bx, by] = poly[i + 1]!
    t.push(ox, oy, z1, ax, ay, z1, bx, by, z1)
    t.push(ox, oy, z0, bx, by, z0, ax, ay, z0)
  }
  for (let i = 0; i < n; i++) {
    const [ax, ay] = poly[i]!
    const [bx, by] = poly[(i + 1) % n]!
    t.push(ax, ay, z0, bx, by, z0, bx, by, z1)
    t.push(ax, ay, z0, bx, by, z1, ax, ay, z1)
  }
}

/** Convex hull (counter-clockwise), grown outward by `grow` mm and rounded with a few points per corner. */
function hull(pts: [number, number][], grow: number): [number, number][] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: [number, number][] = []
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0) lower.pop()
    lower.push(q)
  }
  const upper: [number, number][] = []
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i]!
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0) upper.pop()
    upper.push(q)
  }
  const h = lower.slice(0, -1).concat(upper.slice(0, -1))
  // Grow: a circle of points around each hull corner, then hull again.
  const ring: [number, number][] = []
  for (const [x, y] of h.length ? h : p) for (let i = 0; i < 12; i++) ring.push([x + Math.cos((i / 12) * Math.PI * 2) * grow, y + Math.sin((i / 12) * Math.PI * 2) * grow])
  if (grow === 0) return h
  return hull(ring, 0)
}

/** Buckets triangles by XY so vertical rays only test the ones they can hit. */
class Columns {
  cells: Map<number, number[]> = new Map()
  p: Float32Array
  minX: number
  minY: number
  cell: number
  constructor(p: Float32Array, minX: number, minY: number, cell: number) {
    this.p = p
    this.minX = minX
    this.minY = minY
    this.cell = cell
    const n = p.length / 9
    for (let t = 0; t < n; t++) {
      const o = t * 9
      const x0 = Math.min(p[o]!, p[o + 3]!, p[o + 6]!), x1 = Math.max(p[o]!, p[o + 3]!, p[o + 6]!)
      const y0 = Math.min(p[o + 1]!, p[o + 4]!, p[o + 7]!), y1 = Math.max(p[o + 1]!, p[o + 4]!, p[o + 7]!)
      for (let i = this.ix(x0); i <= this.ix(x1); i++)
        for (let j = this.iy(y0); j <= this.iy(y1); j++) {
          const k = i * 65536 + j
          let a = this.cells.get(k)
          if (!a) this.cells.set(k, (a = []))
          a.push(t)
        }
    }
  }
  ix(x: number) {
    return Math.floor((x - this.minX) / this.cell)
  }
  iy(y: number) {
    return Math.floor((y - this.minY) / this.cell)
  }
  /** Every crossing of the vertical line at (x, y): height and the face normal's z (unit). */
  hits(x: number, y: number): { z: number; nz: number }[] {
    const p = this.p
    const out: { z: number; nz: number }[] = []
    for (const t of this.cells.get(this.ix(x) * 65536 + this.iy(y)) ?? []) {
      const o = t * 9
      const ax = p[o]!, ay = p[o + 1]!, az = p[o + 2]!
      const bx = p[o + 3]!, by = p[o + 4]!, bz = p[o + 5]!
      const cx = p[o + 6]!, cy = p[o + 7]!, cz = p[o + 8]!
      const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
      if (Math.abs(d) < 1e-12) continue
      const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d
      const l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d
      const l3 = 1 - l1 - l2
      if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue
      const ux = bx - ax, uy = by - ay, uz = bz - az
      const vx = cx - ax, vy = cy - ay, vz = cz - az
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
      const len = Math.hypot(nx, ny, nz) || 1
      out.push({ z: l1 * az + l2 * bz + l3 * cz, nz: nz / len })
    }
    return out.sort((a, b) => a.z - b.z)
  }
}

/** Lifts the model and adds supports under everything that needs them. */
/** A drain hole the supports must keep out of (x, y in the model's coordinates, radius in mm). */
export interface DrainHole {
  x: number
  y: number
  r: number
}

/**
 * Supports for `model`. With `holes`, no pin touches inside a drain hole and a ring of pins holds
 * the floor around each one instead, so cutting the hole leaves nothing hanging.
 */
export function generateSupports(model: Float32Array, s: SupportSettings, holes: DrainHole[] = []): SupportResult {
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity
  for (let i = 0; i < model.length; i += 3) {
    minX = Math.min(minX, model[i]!)
    maxX = Math.max(maxX, model[i]!)
    minY = Math.min(minY, model[i + 1]!)
    maxY = Math.max(maxY, model[i + 1]!)
    minZ = Math.min(minZ, model[i + 2]!)
  }
  const lift = Math.max(2, Math.min(30, s.lift))
  const spacing = Math.max(1, Math.min(10, s.spacing))
  const tipR = Math.max(0.1, Math.min(1.5, s.tip)) / 2
  const cosLimit = Math.cos((Math.max(10, Math.min(80, s.angle)) * Math.PI) / 180)
  // Raised model: its lowest point at `lift` above the plate (z = 0).
  const p = new Float32Array(model.length)
  for (let i = 0; i < model.length; i += 3) {
    p[i] = model[i]!
    p[i + 1] = model[i + 1]!
    p[i + 2] = model[i + 2]! - minZ + lift
  }
  const cols = new Columns(p, minX, minY, Math.max(spacing, 2))

  // Contact points: (x, y, z of the surface to hold up, z it stands on: 0 = raft).
  const points: { x: number; y: number; z: number; base: number }[] = []
  const near = new Map<number, number[]>()
  const key = (x: number, y: number) => Math.floor(x / spacing) * 65536 + Math.floor(y / spacing)
  const add = (x: number, y: number, z: number, base: number) => {
    if (points.length >= MAX_SUPPORTS) return
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++)
        for (const k of near.get(key(x + i * spacing, y + j * spacing)) ?? []) {
          const q = points[k]!
          if (Math.hypot(q.x - x, q.y - y) < spacing * MERGE && Math.abs(q.z - z) < spacing) return
        }
    const k = key(x, y)
    let a = near.get(k)
    if (!a) near.set(k, (a = []))
    a.push(points.length)
    points.push({ x, y, z, base })
  }
  /** Where a support under (x, y, z) can stand: the raft (0) or the model surface below, or null if too close. */
  const standOn = (hits: { z: number; nz: number }[], z: number) => {
    let below: number | null = null
    for (const h of hits) if (h.z < z - 1e-4 && h.nz > 0) below = h.z
    if (below === null) return 0
    return z - below >= 3 ? below : null
  }

  // 1. Every lowest point (a vertex with nothing lower around it, e.g. the bottom ring of a tube),
  //    first, so a grid pin near it never stands in for it.
  const weld = new Map<string, { x: number; y: number; z: number; low: number }>()
  const vkey = (i: number) => `${Math.round(p[i]! * 1e3)},${Math.round(p[i + 1]! * 1e3)},${Math.round(p[i + 2]! * 1e3)}`
  for (let o = 0; o < p.length; o += 9) {
    for (let v = 0; v < 3; v++) {
      const i = o + v * 3
      const k = vkey(i)
      let w = weld.get(k)
      if (!w) weld.set(k, (w = { x: p[i]!, y: p[i + 1]!, z: p[i + 2]!, low: Infinity }))
      for (let u = 0; u < 3; u++) if (u !== v) w.low = Math.min(w.low, p[o + u * 3 + 2]!)
    }
  }
  for (const w of weld.values()) {
    if (w.low < w.z - 1e-4) continue
    const hits = cols.hits(w.x, w.y)
    const base = standOn(hits, w.z)
    if (base !== null) add(w.x, w.y, w.z, base)
  }

  // 2. A grid under every surface that faces down steeply enough.
  for (let x = minX + spacing / 2; x < maxX; x += spacing)
    for (let y = minY + spacing / 2; y < maxY; y += spacing) {
      const hits = cols.hits(x, y)
      for (const h of hits) {
        if (h.nz > -cosLimit) continue
        const base = standOn(hits, h.z)
        if (base !== null) add(x, y, h.z, base)
      }
    }

  // Drain holes: clear them, then ring each with pins on the floor around it.
  if (holes.length) {
    const kept = points.filter((q) => holes.every((d) => Math.hypot(q.x - d.x, q.y - d.y) > d.r + tipR + 0.3))
    points.length = 0
    points.push(...kept)
    for (const d of holes) {
      const ring = d.r + tipR + 0.1
      const n = Math.max(6, Math.ceil((2 * Math.PI * ring) / 1))
      for (let k = 0; k < n; k++) {
        const x = d.x + ring * Math.cos((k / n) * 2 * Math.PI)
        const y = d.y + ring * Math.sin((k / n) * 2 * Math.PI)
        const hits = cols.hits(x, y)
        const under = hits.find((h) => h.nz < 0)
        if (!under) continue
        const base = standOn(hits, under.z)
        if (base !== null) points.push({ x, y, z: under.z, base })
      }
    }
  }

  // 3. Geometry: raft, then a pin per point.
  const t = new Tris()
  const onRaft = points.filter((q) => q.base === 0)
  if (onRaft.length) prism(t, hull(onRaft.map((q) => [q.x, q.y]), 2.5), 0, RAFT)
  let onModel = 0
  for (const q of points) {
    const top = q.z + 0.15
    const h = top - (q.base === 0 ? RAFT : q.base)
    const shaftR = Math.min(1.1, Math.max(tipR * 1.6, 0.45 + h * 0.012))
    const tipLen = Math.min(2.2, h * 0.4)
    frustum(t, q.x, q.y, top - tipLen, shaftR, top, tipR)
    if (q.base === 0) {
      const foot = Math.min(1.5, h * 0.2)
      frustum(t, q.x, q.y, RAFT + foot - 0.05, shaftR, top - tipLen + 0.05, shaftR)
      frustum(t, q.x, q.y, RAFT - 0.1, shaftR * 2.2, RAFT + foot, shaftR)
    } else {
      onModel++
      const foot = Math.min(1.5, h * 0.25)
      frustum(t, q.x, q.y, q.base + foot - 0.05, shaftR, top - tipLen + 0.05, shaftR)
      frustum(t, q.x, q.y, q.base - 0.15, tipR, q.base + foot, shaftR)
    }
  }
  const supports = t.out()
  const positions = new Float32Array(p.length + supports.length)
  positions.set(p)
  positions.set(supports, p.length)
  const contacts = new Float32Array(points.length * 2)
  points.forEach((q, i) => {
    contacts[i * 2] = q.x
    contacts[i * 2 + 1] = q.y
  })
  return { positions, supports, count: points.length, onModel, lift, contacts }
}
