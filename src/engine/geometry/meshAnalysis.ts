// Deeper checks that need spatial queries: surfaces that pass through each other, and walls too
// thin to print. Both use a BVH so they stay fast on large meshes.

import { TriBVH, trisCross } from './bvh.ts'

/** Self-intersections are looked for up to this many triangles. */
export const MAX_INTERSECT_TRIS = 1_500_000
/** Thin walls are sampled on at most this many triangles. */
const MAX_THIN_SAMPLES = 200_000

export interface IntersectionResult {
  /** Triangles that cross another triangle of the same part. */
  within: number
  /** Pairs of separate parts that pass into each other. */
  overlappingPairs: number
  /** The crossing triangles of the same part (9 floats each). */
  faces: Float32Array
}

/**
 * Finds triangles that cross other triangles. `tri` holds welded vertex ids per corner (so
 * neighbours sharing a corner are skipped), `comp` the part each triangle belongs to.
 */
export function findIntersections(p: Float32Array, tri: Int32Array, comp: Int32Array, good: Uint8Array, bvh: TriBVH, maxFaces: number): IntersectionResult {
  const n = Math.floor(p.length / 9)
  const crossing = new Uint8Array(n)
  const pairs = new Set<string>()
  let within = 0
  for (let t = 0; t < n; t++) {
    if (!good[t]) continue
    const o = t * 9
    const x0 = Math.min(p[o]!, p[o + 3]!, p[o + 6]!), x1 = Math.max(p[o]!, p[o + 3]!, p[o + 6]!)
    const y0 = Math.min(p[o + 1]!, p[o + 4]!, p[o + 7]!), y1 = Math.max(p[o + 1]!, p[o + 4]!, p[o + 7]!)
    const z0 = Math.min(p[o + 2]!, p[o + 5]!, p[o + 8]!), z1 = Math.max(p[o + 2]!, p[o + 5]!, p[o + 8]!)
    const a0 = tri[t * 3]!, a1 = tri[t * 3 + 1]!, a2 = tri[t * 3 + 2]!
    bvh.overlapping(x0, y0, z0, x1, y1, z1, (u) => {
      if (u <= t || !good[u]) return
      const b0 = tri[u * 3]!, b1 = tri[u * 3 + 1]!, b2 = tri[u * 3 + 2]!
      if (a0 === b0 || a0 === b1 || a0 === b2 || a1 === b0 || a1 === b1 || a1 === b2 || a2 === b0 || a2 === b1 || a2 === b2) return
      if (!trisCross(p, t, u)) return
      if (comp[t] === comp[u]) {
        if (!crossing[t]) within++
        if (!crossing[u]) within++
        crossing[t] = crossing[u] = 1
      } else {
        const a = Math.min(comp[t]!, comp[u]!), b = Math.max(comp[t]!, comp[u]!)
        pairs.add(`${a},${b}`)
      }
    })
  }
  const out: number[] = []
  for (let t = 0; t < n && out.length < maxFaces * 9; t++) if (crossing[t]) for (let k = 0; k < 9; k++) out.push(p[t * 9 + k]!)
  return { within, overlappingPairs: pairs.size, faces: new Float32Array(out) }
}

export interface ThinResult {
  /** Share of the surface (by area, 0..100) where the wall is thinner than the limit. */
  pct: number
  thinnest: number
  faces: Float32Array
}

/**
 * Measures wall thickness by shooting a ray inward from each triangle to the opposite wall.
 * Needs outward-facing triangles (a closed, consistently wound mesh). Only walls of the same
 * part (`comp`) count.
 */
export function findThinWalls(p: Float32Array, good: Uint8Array, comp: Int32Array, bvh: TriBVH, minWall: number, maxFaces: number): ThinResult {
  const n = Math.floor(p.length / 9)
  const stride = Math.max(1, Math.ceil(n / MAX_THIN_SAMPLES))
  let total = 0
  let thin = 0
  let thinnest = Infinity
  const out: number[] = []
  for (let t = 0; t < n; t += stride) {
    if (!good[t]) continue
    const o = t * 9
    const ux = p[o + 3]! - p[o]!, uy = p[o + 4]! - p[o + 1]!, uz = p[o + 5]! - p[o + 2]!
    const vx = p[o + 6]! - p[o]!, vy = p[o + 7]! - p[o + 1]!, vz = p[o + 8]! - p[o + 2]!
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    const len = Math.hypot(nx, ny, nz)
    if (len < 1e-12) continue
    const area = len / 2
    nx /= len
    ny /= len
    nz /= len
    total += area
    const cx = (p[o]! + p[o + 3]! + p[o + 6]!) / 3
    const cy = (p[o + 1]! + p[o + 4]! + p[o + 7]!) / 3
    const cz = (p[o + 2]! + p[o + 5]! + p[o + 8]!) / 3
    const hit = bvh.raycast(cx - nx * 1e-4, cy - ny * 1e-4, cz - nz * 1e-4, -nx, -ny, -nz, minWall, t)
    // Another body passing through this one is not a wall of it.
    if (!hit || comp[hit.tri] !== comp[t]) continue
    // Only an opposite wall counts (its outside faces back towards us), not a neighbour at an angle.
    const q = hit.tri * 9
    const ax = p[q + 3]! - p[q]!, ay = p[q + 4]! - p[q + 1]!, az = p[q + 5]! - p[q + 2]!
    const bx = p[q + 6]! - p[q]!, by = p[q + 7]! - p[q + 1]!, bz = p[q + 8]! - p[q + 2]!
    const mx = ay * bz - az * by, my = az * bx - ax * bz, mz = ax * by - ay * bx
    const ml = Math.hypot(mx, my, mz)
    if (ml < 1e-12 || (mx * nx + my * ny + mz * nz) / ml > -0.5) continue
    thin += area
    thinnest = Math.min(thinnest, hit.t)
    if (out.length < maxFaces * 9) for (let k = 0; k < 9; k++) out.push(p[o + k]!)
  }
  return { pct: total > 0 ? (thin / total) * 100 : 0, thinnest: Number.isFinite(thinnest) ? thinnest : 0, faces: new Float32Array(out) }
}
