// Split to fit: cuts a model that's too big for the printer into pieces that each fit, and adds
// joiners on the cut faces so the pieces line up when glued. Written for Birdy; the approach takes
// ideas from published work on the problem: balanced grid cuts that leave no slivers, a search over
// cut planes scored by piece count and fit (as in the "Chopper" paper), and connectors placed only
// where the cut face has room for them, with a clearance gap per side.
//
// Cuts are square to X, Y or Z so every cut face is flat and prints without support.

import type { CrossSection, Manifold as ManifoldT } from 'manifold-3d'
import { toManifold, toTriangles, type Wasm } from './csg.ts'

export type Axis = 0 | 1 | 2
export type Joiner = 'none' | 'pegs' | 'dowels' | 'filament'

export interface ChopOptions {
  /** Printer build volume (mm). */
  bed: [number, number, number]
  /** 'grid' cuts evenly along X, Y and Z; 'smart' searches for the fewest, best-fitting pieces. */
  mode: 'grid' | 'smart'
  joiner: Joiner
  /** Peg or dowel diameter (mm); filament uses 1.75. */
  diameter: number
  /** Gap per side between a peg and its hole (mm). */
  clearance: number
  /** Kept clear inside the bed edges (mm). */
  margin: number
  /** Allow pieces to be turned on the plate to fit (any axis may stand up). */
  rotate: boolean
}

export const CHOP_DEFAULTS: ChopOptions = { bed: [256, 256, 256], mode: 'smart', joiner: 'pegs', diameter: 5, clearance: 0.2, margin: 3, rotate: true }

export interface ChopPiece {
  tris: Float32Array
  /** Which way to pull it apart from its neighbours for the exploded view (mm). */
  offset: [number, number, number]
}

export interface ChopResult {
  pieces: ChopPiece[]
  /** Loose dowels to print alongside, if the joiner is 'dowels'. */
  dowels: Float32Array[]
  cuts: number
  joiners: number
  /** Cut-face islands too small or thin for a joiner. */
  skipped: number
  /** Pieces that still don't fit (an island the cuts can't shrink). */
  oversize: number
}

const MAX_PIECES = 64
const EXPLODE = 5

type Ext = [number, number, number]

/** Piece-count estimate for a box this size: per axis, how many bed lengths it spans. */
function estimate(ext: Ext, bed: Ext, rotate: boolean): number {
  if (!rotate) return Math.ceil(ext[0] / bed[0] - 1e-6) * Math.ceil(ext[1] / bed[1] - 1e-6) * Math.ceil(ext[2] / bed[2] - 1e-6)
  const e = [...ext].sort((a, b) => b - a)
  const b = [...bed].sort((a, c) => c - a)
  return Math.ceil(e[0]! / b[0]! - 1e-6) * Math.ceil(e[1]! / b[1]! - 1e-6) * Math.ceil(e[2]! / b[2]! - 1e-6)
}

const fits = (ext: Ext, bed: Ext, rotate: boolean) => estimate(ext, bed, rotate) <= 1

function extentOf(m: ManifoldT): { min: Ext; max: Ext; ext: Ext } {
  const b = m.boundingBox()
  const min = [b.min[0], b.min[1], b.min[2]] as Ext
  const max = [b.max[0], b.max[1], b.max[2]] as Ext
  return { min, max, ext: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] }
}

// Cross-sections are taken in Z, so other axes are turned to Z first. For axis X a point (x,y,z)
// becomes (y,z,x); for Y it becomes (z,x,y). Column-major 4x4.
const TO_Z: Record<Axis, number[]> = {
  0: [0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1],
  1: [0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1],
  2: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
}
/** A point (u, v) on the cut face at `at` along `axis`, back in model space. */
function fromFace(axis: Axis, at: number, u: number, v: number): Ext {
  if (axis === 0) return [at, u, v]
  if (axis === 1) return [v, at, u]
  return [u, v, at]
}

function sliceAt(m: ManifoldT, axis: Axis, at: number): CrossSection {
  if (axis === 2) return m.slice(at)
  const turned = m.transform(TO_Z[axis] as never)
  try {
    return turned.slice(at)
  } finally {
    turned.delete()
  }
}

type Poly = [number, number][][]
function inside(polys: Poly, x: number, y: number): boolean {
  let c = false
  for (const ring of polys)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c
    }
  return c
}

/**
 * Where joiners go on the cut face at `at`: points far enough from every edge on the face itself and
 * on slices `depth` either side (so the hole stays inside the wall), spread out, more on bigger faces.
 * Returns the sites per island and how many islands had no room.
 */
function joinerSites(m: ManifoldT, axis: Axis, at: number, radius: number, depth: number): { sites: [number, number][]; skipped: number } {
  const wall = Math.max(1.2, radius * 0.6)
  const own: { delete(): void }[] = []
  try {
    const face = sliceAt(m, axis, at)
    own.push(face)
    const islands = face.decompose()
    own.push(...islands)
    const insetAt = (h: number) => {
      const s = sliceAt(m, axis, h)
      own.push(s)
      const o = s.offset(-(radius + wall), 'Round')
      own.push(o)
      return o.toPolygons() as Poly
    }
    const below = insetAt(at - depth - wall * 0.5)
    const above = insetAt(at + depth + wall * 0.5)
    const sites: [number, number][] = []
    let skipped = 0
    for (const island of islands) {
      const area = island.area()
      if (area < 4) continue
      const inset = island.offset(-(radius + wall), 'Round')
      own.push(inset)
      const polys = inset.toPolygons() as Poly
      if (!polys.length) {
        skipped++
        continue
      }
      const b = island.bounds()
      const span = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1])
      const step = Math.max(0.5, Math.min(radius, span / 40))
      const cand: [number, number][] = []
      for (let x = b.min[0] + step / 2; x < b.max[0]; x += step)
        for (let y = b.min[1] + step / 2; y < b.max[1]; y += step)
          if (inside(polys, x, y) && inside(below, x, y) && inside(above, x, y)) cand.push([x, y])
      if (!cand.length) {
        skipped++
        continue
      }
      // More joiners on bigger faces, so a piece can't turn about a single peg.
      const want = area < 15 * radius * radius * 4 ? 1 : area < 2500 ? 2 : area < 8000 ? 3 : 4
      const minGap = radius * 2 * 3
      // First the candidate nearest the middle of the room left, then each farthest from those chosen.
      let cx = 0, cy = 0
      for (const [x, y] of cand) {
        cx += x
        cy += y
      }
      cx /= cand.length
      cy /= cand.length
      let first = cand[0]!
      let best = Infinity
      for (const p of cand) {
        const d = (p[0] - cx) ** 2 + (p[1] - cy) ** 2
        if (d < best) {
          best = d
          first = p
        }
      }
      const chosen: [number, number][] = [first]
      while (chosen.length < want) {
        let far: [number, number] | null = null
        let farD = minGap * minGap
        for (const p of cand) {
          let d = Infinity
          for (const q of chosen) d = Math.min(d, (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2)
          if (d > farD) {
            farD = d
            far = p
          }
        }
        if (!far) break
        chosen.push(far)
      }
      // With two or more, drop the middle one if the spread ones already cover the face.
      if (chosen.length >= 3) chosen.shift()
      sites.push(...chosen)
    }
    return { sites, skipped }
  } finally {
    for (const o of own) o.delete()
  }
}

/** A round peg along +axis from the face, `length` long, with a chamfered tip. */
function pegAt(wasm: Wasm, axis: Axis, at: number, site: [number, number], radius: number, length: number, sign: 1 | -1, center = false): ManifoldT {
  const tip = Math.min(0.6, radius * 0.3, length / 4)
  const body = wasm.Manifold.cylinder(length - tip, radius, radius, 32)
  const cone = wasm.Manifold.cylinder(tip, radius, radius - tip, 32).translate(0, 0, length - tip)
  let peg = body.add(cone)
  body.delete()
  cone.delete()
  if (center) {
    // A loose dowel: chamfer both ends, centred on the face.
    const flipped = peg.mirror([0, 0, 1])
    const both = peg.add(flipped)
    peg.delete()
    flipped.delete()
    peg = both
  } else {
    // Sink the base 1 mm into the piece so the peg is one solid with it, not just touching.
    const sunk = peg.translate(0, 0, -1)
    peg.delete()
    peg = sunk
    if (sign < 0) {
      const flipped = peg.mirror([0, 0, 1])
      peg.delete()
      peg = flipped
    }
  }
  // Built along Z at the origin; place it at the site, then turn Z back to the cut axis.
  const p = fromFace(axis, at, site[0], site[1])
  let placed: ManifoldT
  if (axis === 2) placed = peg.translate(p[0], p[1], p[2])
  else {
    // Inverse of TO_Z: for X (u,v,w)->(w,u,v); for Y (u,v,w)->(v,w,u).
    const back = axis === 0 ? [0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1] : [0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1]
    const turned = peg.transform(back as never)
    placed = turned.translate(p[0], p[1], p[2])
    turned.delete()
  }
  peg.delete()
  return placed
}

function holeAt(wasm: Wasm, axis: Axis, at: number, site: [number, number], radius: number, depth: number): ManifoldT {
  // A plain cylinder through the face, `depth` each side; the far ends cone in so they print without support.
  const r = radius
  const cone = Math.min(r, depth / 3)
  const mid = wasm.Manifold.cylinder(2 * (depth - cone), r, r, 32, true)
  const up = wasm.Manifold.cylinder(cone, r, 0.2, 32).translate(0, 0, depth - cone)
  const down = up.mirror([0, 0, 1])
  const z = wasm.Manifold.union([mid, up, down])
  mid.delete()
  up.delete()
  down.delete()
  const p = fromFace(axis, at, site[0], site[1])
  let placed: ManifoldT
  if (axis === 2) placed = z.translate(p[0], p[1], p[2])
  else {
    const back = axis === 0 ? [0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1] : [0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1]
    const turned = z.transform(back as never)
    placed = turned.translate(p[0], p[1], p[2])
    turned.delete()
  }
  z.delete()
  return placed
}

interface Work {
  m: ManifoldT
  offset: Ext
  /** Cuts already made through this piece's ancestors (axis, position), kept clear of later cuts so pegs aren't sliced off. */
  planes: [Axis, number][]
}

interface Candidate {
  axis: Axis
  at: number
  score: number
}

/** Scores a cut: fewer pieces, fuller beds, no slivers, no tiny glue faces. */
function scoreCut(m: ManifoldT, axis: Axis, at: number, bed: Ext, rotate: boolean, min: number): number {
  const [hi, lo] = m.splitByPlane([axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0], at)
  try {
    if (hi.isEmpty() || lo.isEmpty()) return Infinity
    let score = 0
    for (const part of [hi, lo]) {
      const { ext } = extentOf(part)
      const n = estimate(ext, bed, rotate)
      score += n
      // Slivers are weak and fiddly to glue.
      const thin = Math.min(...ext)
      if (thin < min) score += 1.5 * (1 - thin / min)
      // How much of the beds the piece would use; waste costs a little.
      const vol = Math.abs(part.volume())
      score += 0.25 * (1 - Math.min(1, vol / (n * bed[0] * bed[1] * bed[2] * 0.05 + 1)))
      // A piece that falls apart into loose bits.
      const bits = part.decompose()
      score += 0.5 * (bits.length - 1)
      for (const b of bits) b.delete()
    }
    return score
  } finally {
    hi.delete()
    lo.delete()
  }
}

/** Plans and makes the cuts; pieces come back in model space with an exploded-view offset each. */
export function chop(wasm: Wasm, solid: Float32Array, opts: Partial<ChopOptions> = {}): ChopResult {
  const o = { ...CHOP_DEFAULTS, ...opts }
  const bed: Ext = [o.bed[0] - 2 * o.margin, o.bed[1] - 2 * o.margin, o.bed[2] - o.margin]
  const radius = o.joiner === 'filament' ? 1.75 / 2 : o.diameter / 2
  const depth = o.joiner === 'filament' ? 8 : Math.max(4, o.diameter * 1.4)
  const result: ChopResult = { pieces: [], dowels: [], cuts: 0, joiners: 0, skipped: 0, oversize: 0 }
  const root = toManifold(wasm, solid)
  const queue: Work[] = [{ m: root, offset: [0, 0, 0], planes: [] }]
  const done: Work[] = []

  // Grid mode: the whole model's box divided evenly per axis (no slivers at the end).
  const gridPlanes: Candidate[] = []
  if (o.mode === 'grid') {
    const { min, ext } = extentOf(root)
    for (const axis of [0, 1, 2] as Axis[]) {
      const n = Math.ceil(ext[axis] / bed[axis] - 1e-6)
      for (let i = 1; i < n; i++) gridPlanes.push({ axis, at: min[axis] + (ext[axis] * i) / n, score: 0 })
    }
  }

  const cutOne = (w: Work, axis: Axis, at: number): Work[] => {
    const normal: [number, number, number] = [axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0]
    let m = w.m
    let loAdd: ManifoldT | null = null
    let hiSub: ManifoldT | null = null
    if (o.joiner !== 'none') {
      const r = o.joiner === 'pegs' ? radius + o.clearance : o.joiner === 'dowels' ? radius + o.clearance : radius + Math.max(0.1, o.clearance)
      const { sites, skipped } = joinerSites(m, axis, at, r, depth)
      result.skipped += skipped
      if (sites.length) {
        const holes = sites.map((s) =>
          o.joiner === 'pegs' ? pegAt(wasm, axis, at, s, r, depth, 1) : holeAt(wasm, axis, at, s, r, depth),
        )
        const cutter = wasm.Manifold.union(holes)
        for (const h of holes) h.delete()
        if (o.joiner === 'pegs') {
          // After the cut, the socket is drilled into the upper side and the peg (slightly shorter, no
          // clearance) joined to the lower side. Both start 1 mm below the face so nothing is flush with it.
          hiSub = cutter
          const pegs = sites.map((s) => pegAt(wasm, axis, at, s, radius, depth + 1 - 0.4, 1))
          loAdd = wasm.Manifold.union(pegs)
          for (const p of pegs) p.delete()
        } else {
          const drilled = m.subtract(cutter)
          m = drilled
          cutter.delete()
          if (o.joiner === 'dowels')
            for (let i = 0; i < sites.length; i++) {
              const d = pegAt(wasm, 2, 0, [0, 0], radius, depth - 0.3, 1, true)
              result.dowels.push(toTriangles(d))
              d.delete()
            }
        }
        result.joiners += sites.length
      }
    }
    const [hi0, lo0] = m.splitByPlane(normal, at)
    if (m !== w.m) m.delete()
    w.m.delete()
    let hi = hi0
    if (hiSub) {
      hi = hi0.subtract(hiSub)
      hi0.delete()
      hiSub.delete()
    }
    let lo = lo0
    if (loAdd) {
      lo = lo0.add(loAdd)
      lo0.delete()
      loAdd.delete()
    }
    result.cuts++
    const out: Work[] = []
    for (const [part, sign] of [[lo, -1], [hi, 1]] as const) {
      if (part.isEmpty()) {
        part.delete()
        continue
      }
      const offset: Ext = [...w.offset]
      offset[axis] += sign * EXPLODE
      // Loose bits become their own pieces.
      const bits = part.decompose()
      part.delete()
      for (const b of bits) {
        // Drop slivers and inside-out leftovers (empty voids) the booleans can leave.
        if (b.volume() < 1) {
          b.delete()
          continue
        }
        out.push({ m: b, offset: [...offset] as Ext, planes: [...w.planes, [axis, at]] })
      }
    }
    return out
  }

  if (o.mode === 'grid') {
    let pieces = queue.splice(0)
    for (const plane of gridPlanes) {
      const next: Work[] = []
      for (const w of pieces) {
        const { min, max } = extentOf(w.m)
        if (plane.at <= min[plane.axis] + 0.01 || plane.at >= max[plane.axis] - 0.01) next.push(w)
        else next.push(...cutOne(w, plane.axis, plane.at))
      }
      pieces = next
    }
    done.push(...pieces)
  } else {
    const min = Math.max(10, Math.min(...bed) * 0.08)
    while (queue.length) {
      const w = queue.shift()!
      const { min: lo, ext } = extentOf(w.m)
      if (fits(ext, bed, o.rotate) || done.length + queue.length >= MAX_PIECES) {
        if (!fits(ext, bed, o.rotate)) result.oversize++
        done.push(w)
        continue
      }
      let best: Candidate | null = null
      for (const axis of [0, 1, 2] as Axis[]) {
        if (ext[axis] < min * 2) continue
        // Balanced positions (k/n of the length) plus a sweep, so the search finds even splits and smarter ones.
        const ats = new Set<number>()
        const n = Math.max(2, Math.ceil(ext[axis] / Math.max(...bed) - 1e-6))
        for (let k = 1; k < n; k++) ats.add(lo[axis] + (ext[axis] * k) / n)
        for (let f = 0.15; f < 0.86; f += 0.05) ats.add(lo[axis] + ext[axis] * f)
        for (const at of ats) {
          if (w.planes.some(([a, p]) => a === axis && Math.abs(p - at) < depth + 3)) continue
          const s = scoreCut(w.m, axis, at, bed, o.rotate, min) + Math.abs(at - (lo[axis] + ext[axis] / 2)) / ext[axis] * 0.05
          if (!best || s < best.score) best = { axis, at, score: s }
        }
      }
      if (!best || !Number.isFinite(best.score)) {
        result.oversize++
        done.push(w)
        continue
      }
      queue.push(...cutOne(w, best.axis, best.at))
    }
  }

  for (const w of done) {
    result.pieces.push({ tris: toTriangles(w.m), offset: w.offset })
    w.m.delete()
  }
  return result
}
