// Volumetric tools: rebuild a damaged mesh as a clean solid, and hollow a solid, both through a
// signed distance field that Manifold turns back into a closed mesh.

import type { Manifold as ManifoldT } from 'manifold-3d'
import { lineHits, nearestDistance, TriBVH } from './bvh.ts'
import { CsgError, toManifold, toTriangles, type Wasm } from './csg.ts'

/** Most grid cells along the longest side. */
const MAX_CELLS = 220

interface Field {
  sdf: (v: [number, number, number]) => number
  bounds: { min: [number, number, number]; max: [number, number, number] }
  voxel: number
}

/**
 * Signed distance to the mesh, positive inside. Inside/outside comes from winding counts along lines
 * on all three axes, taking the majority (so a few holes or crossed surfaces don't spoil it); the exact
 * distance is only measured near the surface.
 */
export function distanceField(p: Float32Array, voxelWanted: number, depth = 0): Field {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity
  for (let i = 0; i < p.length; i += 3) {
    x0 = Math.min(x0, p[i]!); x1 = Math.max(x1, p[i]!)
    y0 = Math.min(y0, p[i + 1]!); y1 = Math.max(y1, p[i + 1]!)
    z0 = Math.min(z0, p[i + 2]!); z1 = Math.max(z1, p[i + 2]!)
  }
  if (!Number.isFinite(x0)) throw new CsgError('The model has no triangles.')
  const longest = Math.max(x1 - x0, y1 - y0, z1 - z0)
  const voxel = Math.max(voxelWanted, longest / MAX_CELLS, 0.05)
  const pad = voxel * 2
  const o: [number, number, number] = [x0 - pad, y0 - pad, z0 - pad]
  const n = [Math.ceil((x1 - x0 + 2 * pad) / voxel) + 1, Math.ceil((y1 - y0 + 2 * pad) / voxel) + 1, Math.ceil((z1 - z0 + 2 * pad) / voxel) + 1] as const
  const bvh = new TriBVH(p)
  const votes = new Uint8Array(n[0] * n[1] * n[2])
  const at = (i: number, j: number, k: number) => (k * n[1] + j) * n[0] + i
  // Parity along each axis line through the grid points.
  for (const axis of [0, 1, 2] as const) {
    const u = axis === 0 ? 1 : 0
    const v = axis === 2 ? 1 : 2
    for (let a = 0; a < n[u]!; a++)
      for (let b = 0; b < n[v]!; b++) {
        const hits = lineHits(bvh, axis, o[u]! + a * voxel + 1e-7, o[v]! + b * voxel + 2e-7)
        if (!hits.length) continue
        // Winding count: overlapping parts add up instead of cancelling out like parity would.
        let h = 0
        let wind = 0
        for (let c = 0; c < n[axis]!; c++) {
          const pos = o[axis]! + c * voxel
          while (h < hits.length && hits[h]!.at < pos) wind += hits[h++]!.dir
          if (wind > 0) {
            const idx = [0, 0, 0]
            idx[axis] = c
            idx[u] = a
            idx[v] = b
            votes[at(idx[0]!, idx[1]!, idx[2]!)]!++
          }
        }
      }
  }
  const inside = (i: number, j: number, k: number) =>
    i >= 0 && j >= 0 && k >= 0 && i < n[0] && j < n[1] && k < n[2] && votes[at(i, j, k)]! >= 2
  const sdf = ([x, y, z]: [number, number, number]) => {
    const fx = (x - o[0]) / voxel, fy = (y - o[1]) / voxel, fz = (z - o[2]) / voxel
    const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz)
    // Occupancy of the surrounding cell, blended.
    let occ = 0
    let mixed = false
    let first: boolean | null = null
    for (let c = 0; c < 8; c++) {
      const ii = i + (c & 1), jj = j + ((c >> 1) & 1), kk = k + ((c >> 2) & 1)
      const ins = inside(ii, jj, kk)
      if (first === null) first = ins
      else if (ins !== first) mixed = true
      const w = (c & 1 ? fx - i : 1 - (fx - i)) * ((c >> 1) & 1 ? fy - j : 1 - (fy - j)) * ((c >> 2) & 1 ? fz - k : 1 - (fz - k))
      if (ins) occ += w
    }
    // Away from the surface only the sign matters, except inside down to `depth` (for insets).
    if (!mixed) {
      if (!first) return -voxel * 2
      if (depth <= 0) return voxel * 2
      const reach = depth + voxel * 2
      const d = nearestDistance(bvh, x, y, z, reach)
      return Number.isFinite(d) ? d : reach
    }
    const d = nearestDistance(bvh, x, y, z, voxel * 3)
    const dist = Number.isFinite(d) ? d : voxel * 2
    return occ >= 0.5 ? dist : -dist
  }
  return { sdf, bounds: { min: o, max: [o[0] + (n[0] - 1) * voxel, o[1] + (n[1] - 1) * voxel, o[2] + (n[2] - 1) * voxel] }, voxel }
}

function level(wasm: Wasm, f: Field, inset: number): ManifoldT {
  return wasm.Manifold.levelSet(f.sdf, f.bounds, f.voxel, inset)
}

/**
 * Rebuilds the model as one clean, closed solid from its volume: closes holes, removes surfaces
 * that cross or sit inside, and joins overlapping parts. Details smaller than `voxel` mm soften.
 */
export function rebuildSolid(wasm: Wasm, p: Float32Array, voxel: number): Float32Array {
  const m = level(wasm, distanceField(p, voxel), 0)
  try {
    if (m.isEmpty()) throw new CsgError('Nothing solid was found to rebuild; the model may be a flat surface.')
    return toTriangles(m)
  } finally {
    m.delete()
  }
}

/** Leaves walls `wall` mm thick and an empty inside. Uses the model as it is when it is a closed solid. */
export function hollowSolid(wasm: Wasm, p: Float32Array, wall: number, voxel: number): Float32Array {
  const field = distanceField(p, Math.min(voxel, wall / 2), wall)
  let outer: ManifoldT
  try {
    outer = toManifold(wasm, p)
  } catch {
    outer = level(wasm, field, 0)
  }
  const inner = level(wasm, field, wall)
  try {
    if (inner.isEmpty()) throw new CsgError(`Nothing is thicker than two ${wall} mm walls, so there is nothing to hollow.`)
    const shell = outer.subtract(inner)
    try {
      return toTriangles(shell)
    } finally {
      shell.delete()
    }
  } finally {
    outer.delete()
    inner.delete()
  }
}
