// Auto-orient: picks which way up a model prints best, judged by how much of its surface
// overhangs (needs supports) and how much of it rests on the plate.

export interface OrientChoice {
  /** Unit vector (in the model's current world frame) that should point straight down. */
  down: [number, number, number]
  /** Downward-facing area steeper than 45° that is not on the plate (mm²). */
  overhang: number
  /** Area lying flat on the plate (mm²). */
  contact: number
  /** Height when standing this way (mm). */
  height: number
  score: number
}

const OVERHANG_COS = Math.cos((45 * Math.PI) / 180)
/** Triangles beyond this are sampled evenly; enough to judge the shape, fast on big meshes. */
const MAX_TRIS = 150_000

/** Candidate "down" directions: the six axes, plus the directions of the largest flat areas. */
function candidates(p: Float32Array, step: number) {
  const buckets = new Map<string, { n: [number, number, number]; area: number }>()
  const tris = Math.floor(p.length / 9)
  for (let t = 0; t < tris; t += step) {
    const o = t * 9
    const ux = p[o + 3]! - p[o]!, uy = p[o + 4]! - p[o + 1]!, uz = p[o + 5]! - p[o + 2]!
    const vx = p[o + 6]! - p[o]!, vy = p[o + 7]! - p[o + 1]!, vz = p[o + 8]! - p[o + 2]!
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    const len = Math.hypot(nx, ny, nz)
    if (len < 1e-12) continue
    const n: [number, number, number] = [nx / len, ny / len, nz / len]
    const key = n.map((c) => Math.round(c * 40)).join(',')
    const b = buckets.get(key)
    if (b) {
      // Area-weighted mean normal of the bucket.
      const w = len / 2
      b.n = [b.n[0] * b.area + n[0] * w, b.n[1] * b.area + n[1] * w, b.n[2] * b.area + n[2] * w]
      b.area += w
      const l = Math.hypot(...b.n)
      b.n = [b.n[0] / l, b.n[1] / l, b.n[2] / l]
    } else buckets.set(key, { n, area: len / 2 })
  }
  const out: [number, number, number][] = [
    [0, 0, -1],
    [0, 0, 1],
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
  ]
  // A flat face points outward; standing on it means that normal points down.
  const flats = [...buckets.values()].sort((a, b) => b.area - a.area).slice(0, 30)
  for (const f of flats) if (!out.some((d) => d[0] * f.n[0] + d[1] * f.n[1] + d[2] * f.n[2] > 0.999)) out.push(f.n)
  return out
}

function evaluate(p: Float32Array, step: number, d: [number, number, number]): Omit<OrientChoice, 'score'> {
  const tris = Math.floor(p.length / 9)
  // Height along "up" (−d) of every vertex; the lowest is the plate.
  let minH = Infinity
  let maxH = -Infinity
  for (let i = 0; i < tris * 3; i += 1) {
    if (Math.floor(i / 3) % step !== 0) continue
    const h = -(p[i * 3]! * d[0] + p[i * 3 + 1]! * d[1] + p[i * 3 + 2]! * d[2])
    if (h < minH) minH = h
    if (h > maxH) maxH = h
  }
  let overhang = 0
  let contact = 0
  for (let t = 0; t < tris; t += step) {
    const o = t * 9
    const ux = p[o + 3]! - p[o]!, uy = p[o + 4]! - p[o + 1]!, uz = p[o + 5]! - p[o + 2]!
    const vx = p[o + 6]! - p[o]!, vy = p[o + 7]! - p[o + 1]!, vz = p[o + 8]! - p[o + 2]!
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    const len = Math.hypot(nx, ny, nz)
    if (len < 1e-12) continue
    const facing = (nx * d[0] + ny * d[1] + nz * d[2]) / len
    if (facing < OVERHANG_COS) continue
    const area = (len / 2) * step
    let low = Infinity
    for (let k = 0; k < 3; k++) {
      const h = -(p[o + k * 3]! * d[0] + p[o + k * 3 + 1]! * d[1] + p[o + k * 3 + 2]! * d[2])
      if (h < low) low = h
    }
    if (low <= minH + 0.2) {
      if (facing > 0.995) contact += area
    } else overhang += area
  }
  return { down: d, overhang, contact, height: maxH - minH }
}

/**
 * Ranks ways to stand the model (world-space triangles, 9 floats each), best first. Less overhang
 * wins; resting on a flat face counts in its favour, and a lower height breaks ties.
 */
export function rankOrientations(positions: Float32Array): OrientChoice[] {
  const tris = Math.floor(positions.length / 9)
  if (!tris) return []
  const step = Math.max(1, Math.ceil(tris / MAX_TRIS))
  let total = 0
  for (let t = 0; t < tris; t += step) {
    const o = t * 9
    const ux = positions[o + 3]! - positions[o]!, uy = positions[o + 4]! - positions[o + 1]!, uz = positions[o + 5]! - positions[o + 2]!
    const vx = positions[o + 6]! - positions[o]!, vy = positions[o + 7]! - positions[o + 1]!, vz = positions[o + 8]! - positions[o + 2]!
    total += (Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2) * step
  }
  const results = candidates(positions, step).map((d) => {
    const e = evaluate(positions, step, d)
    const score = e.overhang - 0.6 * Math.min(e.contact, total * 0.25) + e.height * Math.sqrt(total) * 0.002
    return { ...e, score }
  })
  return results.sort((a, b) => a.score - b.score)
}
