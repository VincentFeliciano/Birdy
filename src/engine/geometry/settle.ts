// Settle: what gravity would do to the model on the plate. From its current orientation it tips
// over its lowest points, again and again, until its centre of mass sits over what it stands on.

import * as THREE from 'three'

export interface SettleResult {
  /** World rotation to apply (premultiply). Identity when it already rests stably. */
  rotation: THREE.Quaternion
  /** How many times it tipped over an edge or point. */
  tips: number
  /** Total angle turned (degrees). */
  degrees: number
}

const MAX_TIPS = 400

/** Centre of mass of a closed mesh (by signed tetrahedra); the surface centroid when it is not closed. */
export function centreOfMass(p: Float32Array): THREE.Vector3 {
  let vol = 0
  let cx = 0, cy = 0, cz = 0
  let area = 0
  let ax = 0, ay = 0, az = 0
  for (let o = 0; o + 8 < p.length; o += 9) {
    const x1 = p[o]!, y1 = p[o + 1]!, z1 = p[o + 2]!
    const x2 = p[o + 3]!, y2 = p[o + 4]!, z2 = p[o + 5]!
    const x3 = p[o + 6]!, y3 = p[o + 7]!, z3 = p[o + 8]!
    const v = (x1 * (y2 * z3 - z2 * y3) - y1 * (x2 * z3 - z2 * x3) + z1 * (x2 * y3 - y2 * x3)) / 6
    vol += v
    cx += v * (x1 + x2 + x3) / 4
    cy += v * (y1 + y2 + y3) / 4
    cz += v * (z1 + z2 + z3) / 4
    const ux = x2 - x1, uy = y2 - y1, uz = z2 - z1
    const wx = x3 - x1, wy = y3 - y1, wz = z3 - z1
    const a = Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx) / 2
    area += a
    ax += a * (x1 + x2 + x3) / 3
    ay += a * (y1 + y2 + y3) / 3
    az += a * (z1 + z2 + z3) / 3
  }
  // A closed mesh's tetrahedra sum to its volume; when that is tiny next to its surface, it is open.
  if (Math.abs(vol) > 1e-9 && Math.abs(vol) > area * 1e-4) return new THREE.Vector3(cx / vol, cy / vol, cz / vol)
  return area > 0 ? new THREE.Vector3(ax / area, ay / area, az / area) : new THREE.Vector3()
}

/** 2-D convex hull (monotone chain), counter-clockwise, no repeated end point. */
function hull2(pts: [number, number][]): [number, number][] {
  const s = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (s.length < 3) return s
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lo: [number, number][] = []
  for (const q of s) {
    while (lo.length >= 2 && cross(lo[lo.length - 2]!, lo[lo.length - 1]!, q) <= 0) lo.pop()
    lo.push(q)
  }
  const up: [number, number][] = []
  for (let i = s.length - 1; i >= 0; i--) {
    const q = s[i]!
    while (up.length >= 2 && cross(up[up.length - 2]!, up[up.length - 1]!, q) <= 0) up.pop()
    up.push(q)
  }
  return lo.slice(0, -1).concat(up.slice(0, -1))
}

/** Closest point to (x, y) on the boundary of a convex polygon (or a point or segment), and whether (x, y) is inside it. */
function nearestOnPolygon(poly: [number, number][], x: number, y: number): { at: [number, number]; inside: boolean; dist: number } {
  if (poly.length === 1) return { at: poly[0]!, inside: false, dist: Math.hypot(x - poly[0]![0], y - poly[0]![1]) }
  let best: [number, number] = poly[0]!
  let bestD = Infinity
  let inside = poly.length >= 3
  const n = poly.length === 2 ? 1 : poly.length
  for (let i = 0; i < n; i++) {
    const a = poly[i]!
    const b = poly[(i + 1) % poly.length]!
    const ex = b[0] - a[0], ey = b[1] - a[1]
    const len2 = ex * ex + ey * ey
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * ex + (y - a[1]) * ey) / len2)) : 0
    const q: [number, number] = [a[0] + ex * t, a[1] + ey * t]
    const d = Math.hypot(x - q[0], y - q[1])
    if (d < bestD) {
      bestD = d
      best = q
    }
    if (ex * (y - a[1]) - ey * (x - a[0]) < 0) inside = false
  }
  return { at: best, inside, dist: bestD }
}

/**
 * How `positions` (world-space triangles) would come to rest if let go on a flat floor: the
 * rotation that tips it, step by step, until its centre of mass is over its footprint.
 */
export function settle(positions: Float32Array): SettleResult {
  const rotation = new THREE.Quaternion()
  // Unique vertices are enough: the lowest points are always vertices.
  const seen = new Set<string>()
  const xs: number[] = []
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const x = positions[i]!, y = positions[i + 1]!, z = positions[i + 2]!
    if (!Number.isFinite(x + y + z)) continue
    const k = `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`
    if (seen.has(k)) continue
    seen.add(k)
    xs.push(x, y, z)
    min = [Math.min(min[0]!, x), Math.min(min[1]!, y), Math.min(min[2]!, z)]
    max = [Math.max(max[0]!, x), Math.max(max[1]!, y), Math.max(max[2]!, z)]
  }
  const n = xs.length / 3
  if (n < 3) return { rotation, tips: 0, degrees: 0 }
  const p = Float64Array.from(xs)
  const size = Math.hypot(max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!)
  const eps = Math.max(size * 1e-5, 1e-6)
  const com = centreOfMass(positions)
  let tips = 0
  let total = 0
  const axis = new THREE.Vector3()
  const step = new THREE.Quaternion()
  for (; tips < MAX_TIPS; tips++) {
    let floor = Infinity
    for (let i = 2; i < p.length; i += 3) floor = Math.min(floor, p[i]!)
    const contacts: [number, number][] = []
    for (let i = 0; i < p.length; i += 3) if (p[i + 2]! - floor <= eps) contacts.push([p[i]!, p[i + 1]!])
    const poly = hull2(contacts)
    const near = nearestOnPolygon(poly, com.x, com.y)
    // Resting: the centre of mass is over the footprint (or balanced right on its edge).
    if (near.inside || near.dist <= eps * 10) break
    const dx = (com.x - near.at[0]) / near.dist
    const dy = (com.y - near.at[1]) / near.dist
    // Tip towards the centre of mass about the horizontal line through the pivot, until the next
    // vertex reaches the floor.
    let theta = Infinity
    for (let i = 0; i < p.length; i += 3) {
      const s = (p[i]! - near.at[0]) * dx + (p[i + 1]! - near.at[1]) * dy
      if (s <= eps) continue
      const t = Math.atan2(Math.max(0, p[i + 2]! - floor), s)
      if (t < theta) theta = t
    }
    if (!(theta < Infinity)) break
    theta = Math.max(theta, 1e-9)
    axis.set(-dy, dx, 0)
    step.setFromAxisAngle(axis, theta)
    const c = Math.cos(theta), sn = Math.sin(theta)
    // Rodrigues about the axis through (pivot, floor).
    const turn = (x: number, y: number, z: number): [number, number, number] => {
      const rx = x - near.at[0], ry = y - near.at[1], rz = z - floor
      const ky = dx, kx = -dy
      const dot = kx * rx + ky * ry
      const cx = ky * rz, cy = -kx * rz, cz = kx * ry - ky * rx
      return [
        rx * c + cx * sn + kx * dot * (1 - c) + near.at[0],
        ry * c + cy * sn + ky * dot * (1 - c) + near.at[1],
        rz * c + cz * sn + floor,
      ]
    }
    for (let i = 0; i < p.length; i += 3) {
      const [x, y, z] = turn(p[i]!, p[i + 1]!, p[i + 2]!)
      p[i] = x
      p[i + 1] = y
      p[i + 2] = z
    }
    const [mx, my, mz] = turn(com.x, com.y, com.z)
    com.set(mx, my, mz)
    rotation.premultiply(step)
    total += theta
  }
  return { rotation, tips, degrees: (total * 180) / Math.PI }
}
