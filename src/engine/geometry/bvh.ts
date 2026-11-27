// Bounding volume hierarchy over a triangle soup, for overlap and ray queries on large meshes.

export class TriBVH {
  /** Per node: min x,y,z, max x,y,z. */
  readonly box: Float32Array
  /** Per node: left child (or -1 for a leaf), right child / first triangle, triangle count. */
  readonly node: Int32Array
  /** Triangle order; leaves point into it. */
  readonly order: Uint32Array
  nodes = 0
  readonly p: Float32Array

  constructor(p: Float32Array, leaf = 6) {
    this.p = p
    const n = Math.floor(p.length / 9)
    this.order = new Uint32Array(n)
    for (let i = 0; i < n; i++) this.order[i] = i
    // A binary tree over n leaves-or-fewer has at most 2n - 1 nodes.
    const cap = Math.max(1, 2 * n)
    this.box = new Float32Array(cap * 6)
    this.node = new Int32Array(cap * 3)
    const cent = new Float32Array(n * 3)
    for (let t = 0; t < n; t++) {
      const o = t * 9
      cent[t * 3] = (p[o]! + p[o + 3]! + p[o + 6]!) / 3
      cent[t * 3 + 1] = (p[o + 1]! + p[o + 4]! + p[o + 7]!) / 3
      cent[t * 3 + 2] = (p[o + 2]! + p[o + 5]! + p[o + 8]!) / 3
    }
    if (n) this.build(0, n, cent, leaf)
  }

  private build(start: number, end: number, cent: Float32Array, leaf: number): number {
    const id = this.nodes++
    const b = id * 6
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity
    let cx0 = Infinity, cy0 = Infinity, cz0 = Infinity, cx1 = -Infinity, cy1 = -Infinity, cz1 = -Infinity
    for (let i = start; i < end; i++) {
      const t = this.order[i]!
      const o = t * 9
      for (let k = 0; k < 9; k += 3) {
        const x = this.p[o + k]!, y = this.p[o + k + 1]!, z = this.p[o + k + 2]!
        if (x < x0) x0 = x
        if (y < y0) y0 = y
        if (z < z0) z0 = z
        if (x > x1) x1 = x
        if (y > y1) y1 = y
        if (z > z1) z1 = z
      }
      const cx = cent[t * 3]!, cy = cent[t * 3 + 1]!, cz = cent[t * 3 + 2]!
      if (cx < cx0) cx0 = cx
      if (cy < cy0) cy0 = cy
      if (cz < cz0) cz0 = cz
      if (cx > cx1) cx1 = cx
      if (cy > cy1) cy1 = cy
      if (cz > cz1) cz1 = cz
    }
    this.box.set([x0, y0, z0, x1, y1, z1], b)
    const count = end - start
    if (count <= leaf) {
      this.node[id * 3] = -1
      this.node[id * 3 + 1] = start
      this.node[id * 3 + 2] = count
      return id
    }
    // Split at the middle of the longest centroid axis; fall back to halving the list.
    const ex = cx1 - cx0, ey = cy1 - cy0, ez = cz1 - cz0
    const axis = ex >= ey && ex >= ez ? 0 : ey >= ez ? 1 : 2
    const mid = axis === 0 ? (cx0 + cx1) / 2 : axis === 1 ? (cy0 + cy1) / 2 : (cz0 + cz1) / 2
    let i = start, j = end - 1
    while (i <= j) {
      if (cent[this.order[i]! * 3 + axis]! < mid) i++
      else {
        const t = this.order[i]!
        this.order[i] = this.order[j]!
        this.order[j] = t
        j--
      }
    }
    let split = i
    if (split === start || split === end) split = (start + end) >> 1
    const left = this.build(start, split, cent, leaf)
    const right = this.build(split, end, cent, leaf)
    this.node[id * 3] = left
    this.node[id * 3 + 1] = right
    this.node[id * 3 + 2] = 0
    return id
  }

  /** Calls `fn` with every triangle whose box overlaps the given box. */
  overlapping(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, fn: (t: number) => void) {
    if (!this.nodes) return
    const stack = [0]
    while (stack.length) {
      const id = stack.pop()!
      const b = id * 6
      if (this.box[b]! > x1 || this.box[b + 3]! < x0 || this.box[b + 1]! > y1 || this.box[b + 4]! < y0 || this.box[b + 2]! > z1 || this.box[b + 5]! < z0) continue
      const l = this.node[id * 3]!
      if (l < 0) {
        const s = this.node[id * 3 + 1]!
        const c = this.node[id * 3 + 2]!
        for (let i = s; i < s + c; i++) fn(this.order[i]!)
      } else stack.push(l, this.node[id * 3 + 1]!)
    }
  }

  /**
   * Nearest hit along a ray (origin o, direction d) within maxT: the triangle and distance, or
   * null. `skip` is ignored (the triangle the ray starts on).
   */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, skip = -1): { t: number; tri: number } | null {
    if (!this.nodes) return null
    const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz
    let best = maxT
    let hit = -1
    const stack = [0]
    const p = this.p
    while (stack.length) {
      const id = stack.pop()!
      const b = id * 6
      let t0 = 0, t1 = best
      let a = (this.box[b]! - ox) * ix, c = (this.box[b + 3]! - ox) * ix
      t0 = Math.max(t0, Math.min(a, c))
      t1 = Math.min(t1, Math.max(a, c))
      a = (this.box[b + 1]! - oy) * iy
      c = (this.box[b + 4]! - oy) * iy
      t0 = Math.max(t0, Math.min(a, c))
      t1 = Math.min(t1, Math.max(a, c))
      a = (this.box[b + 2]! - oz) * iz
      c = (this.box[b + 5]! - oz) * iz
      t0 = Math.max(t0, Math.min(a, c))
      t1 = Math.min(t1, Math.max(a, c))
      if (!(t0 <= t1)) continue
      const l = this.node[id * 3]!
      if (l >= 0) {
        stack.push(l, this.node[id * 3 + 1]!)
        continue
      }
      const s = this.node[id * 3 + 1]!
      const n = this.node[id * 3 + 2]!
      for (let i = s; i < s + n; i++) {
        const tri = this.order[i]!
        if (tri === skip) continue
        const o = tri * 9
        const t = rayTri(ox, oy, oz, dx, dy, dz, p, o)
        if (t > 0 && t < best) {
          best = t
          hit = tri
        }
      }
    }
    return hit >= 0 ? { t: best, tri: hit } : null
  }
}

/** Möller–Trumbore: distance along the ray to triangle at p[o..o+9], or -1. */
export function rayTri(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, p: ArrayLike<number>, o: number): number {
  const ax = p[o]!, ay = p[o + 1]!, az = p[o + 2]!
  const e1x = p[o + 3]! - ax, e1y = p[o + 4]! - ay, e1z = p[o + 5]! - az
  const e2x = p[o + 6]! - ax, e2y = p[o + 7]! - ay, e2z = p[o + 8]! - az
  const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x
  const det = e1x * px + e1y * py + e1z * pz
  if (Math.abs(det) < 1e-12) return -1
  const inv = 1 / det
  const tx = ox - ax, ty = oy - ay, tz = oz - az
  const u = (tx * px + ty * py + tz * pz) * inv
  if (u < 0 || u > 1) return -1
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x
  const v = (dx * qx + dy * qy + dz * qz) * inv
  if (v < 0 || u + v > 1) return -1
  return (e2x * qx + e2y * qy + e2z * qz) * inv
}

/** Whether the segment a→b crosses the triangle at p[o..o+9] (strictly inside the segment). */
function segTri(ax: number, ay: number, az: number, bx: number, by: number, bz: number, p: ArrayLike<number>, o: number) {
  const dx = bx - ax, dy = by - ay, dz = bz - az
  const t = rayTri(ax, ay, az, dx, dy, dz, p, o)
  return t > 1e-6 && t < 1 - 1e-6
}

/** Whether triangles i and j (in p) cross each other. Touching along shared corners does not count. */
export function trisCross(p: ArrayLike<number>, i: number, j: number) {
  const a = i * 9, b = j * 9
  for (let k = 0; k < 3; k++) {
    const s = a + k * 3, e = a + ((k + 1) % 3) * 3
    if (segTri(p[s]!, p[s + 1]!, p[s + 2]!, p[e]!, p[e + 1]!, p[e + 2]!, p, b)) return true
    const s2 = b + k * 3, e2 = b + ((k + 1) % 3) * 3
    if (segTri(p[s2]!, p[s2 + 1]!, p[s2 + 2]!, p[e2]!, p[e2 + 1]!, p[e2 + 2]!, p, a)) return true
  }
  return false
}

/** Squared distance from (x, y, z) to the closest point of triangle p[o..o+9] (Ericson). */
export function distTri2(x: number, y: number, z: number, p: ArrayLike<number>, o: number): number {
  const ax = p[o]!, ay = p[o + 1]!, az = p[o + 2]!
  const bx = p[o + 3]!, by = p[o + 4]!, bz = p[o + 5]!
  const cx = p[o + 6]!, cy = p[o + 7]!, cz = p[o + 8]!
  const abx = bx - ax, aby = by - ay, abz = bz - az
  const acx = cx - ax, acy = cy - ay, acz = cz - az
  const apx = x - ax, apy = y - ay, apz = z - az
  const d1 = abx * apx + aby * apy + abz * apz
  const d2 = acx * apx + acy * apy + acz * apz
  const sq = (qx: number, qy: number, qz: number) => (x - qx) ** 2 + (y - qy) ** 2 + (z - qz) ** 2
  if (d1 <= 0 && d2 <= 0) return sq(ax, ay, az)
  const bpx = x - bx, bpy = y - by, bpz = z - bz
  const d3 = abx * bpx + aby * bpy + abz * bpz
  const d4 = acx * bpx + acy * bpy + acz * bpz
  if (d3 >= 0 && d4 <= d3) return sq(bx, by, bz)
  const vc = d1 * d4 - d3 * d2
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3)
    return sq(ax + abx * v, ay + aby * v, az + abz * v)
  }
  const cpx = x - cx, cpy = y - cy, cpz = z - cz
  const d5 = abx * cpx + aby * cpy + abz * cpz
  const d6 = acx * cpx + acy * cpy + acz * cpz
  if (d6 >= 0 && d5 <= d6) return sq(cx, cy, cz)
  const vb = d5 * d2 - d1 * d6
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6)
    return sq(ax + acx * w, ay + acy * w, az + acz * w)
  }
  const va = d3 * d6 - d5 * d4
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6))
    return sq(bx + (cx - bx) * w, by + (cy - by) * w, bz + (cz - bz) * w)
  }
  const den = 1 / (va + vb + vc)
  const v = vb * den
  const w = vc * den
  return sq(ax + abx * v + acx * w, ay + aby * v + acy * w, az + abz * v + acz * w)
}

/** Distance from a point to the nearest triangle (branch and bound over the BVH). */
export function nearestDistance(bvh: TriBVH, x: number, y: number, z: number, maxD = Infinity): number {
  if (!bvh.nodes) return Infinity
  let best = maxD * maxD
  const stack = [0]
  while (stack.length) {
    const id = stack.pop()!
    const b = id * 6
    const dx = Math.max(bvh.box[b]! - x, 0, x - bvh.box[b + 3]!)
    const dy = Math.max(bvh.box[b + 1]! - y, 0, y - bvh.box[b + 4]!)
    const dz = Math.max(bvh.box[b + 2]! - z, 0, z - bvh.box[b + 5]!)
    if (dx * dx + dy * dy + dz * dz >= best) continue
    const l = bvh.node[id * 3]!
    if (l >= 0) {
      stack.push(l, bvh.node[id * 3 + 1]!)
      continue
    }
    const s = bvh.node[id * 3 + 1]!
    const n = bvh.node[id * 3 + 2]!
    for (let i = s; i < s + n; i++) {
      const d = distTri2(x, y, z, bvh.p, bvh.order[i]! * 9)
      if (d < best) best = d
    }
  }
  return Math.sqrt(best)
}

/**
 * Every crossing of the axis-aligned line through (a, b) with the mesh, sorted along `axis`:
 * the position, and +1 where the line enters a surface (its face points back along the axis) or
 * -1 where it leaves.
 */
export function lineHits(bvh: TriBVH, axis: 0 | 1 | 2, a: number, b: number): { at: number; dir: number }[] {
  const out: { at: number; dir: number }[] = []
  if (!bvh.nodes) return out
  // The other two axes, in order.
  const u = axis === 0 ? 1 : 0
  const v = axis === 2 ? 1 : 2
  const stack = [0]
  const p = bvh.p
  while (stack.length) {
    const id = stack.pop()!
    const bb = id * 6
    if (bvh.box[bb + u]! > a || bvh.box[bb + 3 + u]! < a || bvh.box[bb + v]! > b || bvh.box[bb + 3 + v]! < b) continue
    const l = bvh.node[id * 3]!
    if (l >= 0) {
      stack.push(l, bvh.node[id * 3 + 1]!)
      continue
    }
    const s = bvh.node[id * 3 + 1]!
    const n = bvh.node[id * 3 + 2]!
    for (let i = s; i < s + n; i++) {
      const o = bvh.order[i]! * 9
      // 2-D point-in-triangle in the (u, v) plane, then interpolate the axis coordinate.
      const x0 = p[o + u]!, y0 = p[o + v]!, x1 = p[o + 3 + u]!, y1 = p[o + 3 + v]!, x2 = p[o + 6 + u]!, y2 = p[o + 6 + v]!
      const det = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
      if (Math.abs(det) < 1e-14) continue
      const l0 = ((y1 - y2) * (a - x2) + (x2 - x1) * (b - y2)) / det
      const l1 = ((y2 - y0) * (a - x2) + (x0 - x2) * (b - y2)) / det
      const l2 = 1 - l0 - l1
      if (l0 < 0 || l1 < 0 || l2 < 0) continue
      // The face normal's component along the axis has the sign of det for a right-handed (u, v, axis).
      const flip = axis === 1 ? -1 : 1
      out.push({ at: l0 * p[o + axis]! + l1 * p[o + 3 + axis]! + l2 * p[o + 6 + axis]!, dir: det * flip > 0 ? -1 : 1 })
    }
  }
  return out.sort((x, y) => x.at - y.at)
}
