// Mesh diagnostics and printability rules. Pure functions so they run in a worker and in tests.

export type Verdict = 'ready' | 'attention' | 'fail'
export type IssueLevel = 'error' | 'warn' | 'info'

export interface Issue {
  level: IssueLevel
  code: string
  title: string
  detail: string
}

export interface BedSize {
  x: number
  y: number
  z: number
}

export interface PrintStats {
  triangles: number
  invalidVertices: number
  degenerate: number
  openEdges: number
  nonManifoldEdges: number
  flippedEdges: number
  components: number
  floatingComponents: number
  watertight: boolean
  volumeCm3: number | null
  overhangPct: number
  size: BedSize
  minZ: number
}

export interface PrintReport {
  verdict: Verdict
  issues: Issue[]
  stats: PrintStats
  bed: BedSize
}

export interface CheckInput {
  /** World-space, non-indexed triangle positions (x,y,z per vertex, 3 vertices per triangle). */
  positions: Float32Array
  bed: BedSize
  /** Problems found while parsing the file (e.g. truncated STL). */
  fileWarnings: string[]
  isPointCloud: boolean
}

const OVERHANG_COS = Math.cos((45 * Math.PI) / 180)

class DisjointSet {
  parent: Int32Array
  constructor(n: number) {
    this.parent = new Int32Array(n)
    for (let i = 0; i < n; i++) this.parent[i] = i
  }
  find(a: number): number {
    let r = a
    while (this.parent[r] !== r) r = this.parent[r]
    while (this.parent[a] !== r) {
      const next = this.parent[a]
      this.parent[a] = r
      a = next
    }
    return r
  }
  union(a: number, b: number) {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent[ra] = rb
  }
}

export function checkPrintability(input: CheckInput): PrintReport {
  const { positions: p, bed } = input
  const issues: Issue[] = []
  const triCount = Math.floor(p.length / 9)

  for (const w of input.fileWarnings) {
    issues.push({ level: 'warn', code: 'file', title: 'File looks damaged', detail: w })
  }

  const emptyStats: PrintStats = {
    triangles: triCount,
    invalidVertices: 0,
    degenerate: 0,
    openEdges: 0,
    nonManifoldEdges: 0,
    flippedEdges: 0,
    components: 0,
    floatingComponents: 0,
    watertight: false,
    volumeCm3: null,
    overhangPct: 0,
    size: { x: 0, y: 0, z: 0 },
    minZ: 0,
  }

  if (input.isPointCloud) {
    issues.push({
      level: 'error',
      code: 'points',
      title: 'Point cloud, not a solid',
      detail: 'This file has points but no surface. It needs to be meshed before it can be printed.',
    })
    return { verdict: 'fail', issues, stats: emptyStats, bed }
  }
  if (triCount === 0) {
    issues.push({ level: 'error', code: 'empty', title: 'No triangles', detail: 'The file contains no printable geometry.' })
    return { verdict: 'fail', issues, stats: emptyStats, bed }
  }

  // Weld vertices that share a position (to 0.0001 mm) so we can reason about edges.
  const vertIndex = new Map<string, number>()
  const tri = new Int32Array(triCount * 3)
  let invalid = 0
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  const vz: number[] = []

  for (let i = 0; i < triCount * 3; i++) {
    const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2]
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      invalid++
      tri[i] = -1
      continue
    }
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (z < minZ) minZ = z
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
    if (z > maxZ) maxZ = z
    const key = `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`
    let id = vertIndex.get(key)
    if (id === undefined) {
      id = vertIndex.size
      vertIndex.set(key, id)
      vz.push(z)
    }
    tri[i] = id
  }

  const size = { x: maxX - minX, y: maxY - minY, z: maxZ - minZ }
  if (invalid > 0) {
    issues.push({
      level: 'error',
      code: 'nan',
      title: 'Corrupt vertex data',
      detail: `${invalid.toLocaleString()} vertices are not valid numbers. The file is corrupt or was exported incorrectly.`,
    })
  }

  // Edge map: undirected edge -> count, plus directed edge counts to spot flipped faces.
  const edges = new Map<number, number>()
  const directed = new Map<number, number>()
  const nVerts = vertIndex.size
  const ekey = (a: number, b: number) => a * nVerts + b
  const ds = new DisjointSet(nVerts)
  let degenerate = 0
  let signedVol = 0
  let totalArea = 0
  let overhangArea = 0

  for (let t = 0; t < triCount; t++) {
    const a = tri[t * 3], b = tri[t * 3 + 1], c = tri[t * 3 + 2]
    if (a < 0 || b < 0 || c < 0) continue
    const o = t * 9
    const ax = p[o], ay = p[o + 1], az = p[o + 2]
    const bx = p[o + 3], by = p[o + 4], bz = p[o + 5]
    const cx = p[o + 6], cy = p[o + 7], cz = p[o + 8]
    const ux = bx - ax, uy = by - ay, uz = bz - az
    const wx = cx - ax, wy = cy - ay, wz = cz - az
    const nx = uy * wz - uz * wy
    const ny = uz * wx - ux * wz
    const nz = ux * wy - uy * wx
    const area2 = Math.sqrt(nx * nx + ny * ny + nz * nz)
    if (a === b || b === c || a === c || area2 < 1e-12) {
      degenerate++
      continue
    }
    const area = area2 / 2
    totalArea += area
    // Signed volume via the divergence theorem (positive when normals face outward).
    signedVol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6

    // Downward-facing surface steeper than 45° that isn't resting on the plate needs support.
    const faceMinZ = Math.min(az, bz, cz)
    if (nz / area2 < -OVERHANG_COS && faceMinZ > minZ + 0.2) overhangArea += area

    ds.union(a, b)
    ds.union(b, c)
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const k = u < v ? ekey(u, v) : ekey(v, u)
      edges.set(k, (edges.get(k) ?? 0) + 1)
      const dk = ekey(u, v)
      directed.set(dk, (directed.get(dk) ?? 0) + 1)
    }
  }

  let open = 0
  let nonManifold = 0
  for (const n of edges.values()) {
    if (n === 1) open++
    else if (n > 2) nonManifold++
  }
  let flipped = 0
  for (const n of directed.values()) if (n > 1) flipped++

  // Connected parts and whether any float above the plate.
  const compMinZ = new Map<number, number>()
  for (let v = 0; v < nVerts; v++) {
    const r = ds.find(v)
    const cur = compMinZ.get(r)
    if (cur === undefined || vz[v] < cur) compMinZ.set(r, vz[v])
  }
  // Only count components that actually have faces (not stray vertices from degenerate tris).
  const usedRoots = new Set<number>()
  for (let t = 0; t < triCount * 3; t++) if (tri[t] >= 0) usedRoots.add(ds.find(tri[t]))
  const components = usedRoots.size
  let floating = 0
  for (const r of usedRoots) if ((compMinZ.get(r) ?? 0) > minZ + 0.5) floating++

  const watertight = open === 0 && nonManifold === 0 && invalid === 0
  const volumeCm3 = watertight ? Math.abs(signedVol) / 1000 : null
  const overhangPct = totalArea > 0 ? (overhangArea / totalArea) * 100 : 0

  if (degenerate > 0) {
    issues.push({
      level: degenerate > triCount * 0.05 ? 'warn' : 'info',
      code: 'degenerate',
      title: 'Zero-area triangles',
      detail: `${degenerate.toLocaleString()} triangles have no area. Most slicers ignore them, but many suggest a sloppy export.`,
    })
  }
  if (open > 0) {
    issues.push({
      level: 'error',
      code: 'holes',
      title: 'Mesh has holes (not watertight)',
      detail: `${open.toLocaleString()} open edges. Slicers may fill these wrongly or skip walls. Repair it before printing.`,
    })
  }
  if (nonManifold > 0) {
    issues.push({
      level: 'error',
      code: 'nonmanifold',
      title: 'Non-manifold geometry',
      detail: `${nonManifold.toLocaleString()} edges are shared by more than two faces, so inside and outside are ambiguous.`,
    })
  }
  if (flipped > 0) {
    issues.push({
      level: 'warn',
      code: 'flipped',
      title: 'Some faces point the wrong way',
      detail: `${flipped.toLocaleString()} edges have inconsistent winding. Most slicers auto-fix this, but it can cause missing layers.`,
    })
  }
  if (watertight && signedVol < 0) {
    issues.push({
      level: 'warn',
      code: 'inverted',
      title: 'Model is inside-out',
      detail: 'All normals point inward. Mirror the model twice or repair it in your slicer.',
    })
  }
  if (size.x > bed.x || size.y > bed.y || size.z > bed.z) {
    issues.push({
      level: 'error',
      code: 'bed',
      title: "Doesn't fit the build plate",
      detail: `Model is ${size.x.toFixed(1)} × ${size.y.toFixed(1)} × ${size.z.toFixed(1)} mm; the plate is ${bed.x} × ${bed.y} × ${bed.z} mm. Scale it down or split it.`,
    })
  }
  if (minZ < -0.01) {
    issues.push({
      level: 'error',
      code: 'below',
      title: 'Part of the model is below the plate',
      detail: `Lowest point is ${minZ.toFixed(2)} mm. Use Drop to plate.`,
    })
  } else if (minZ > 0.05) {
    issues.push({
      level: 'warn',
      code: 'above',
      title: 'Model is floating above the plate',
      detail: `Lowest point is ${minZ.toFixed(2)} mm up. Use Drop to plate so the first layer sticks.`,
    })
  }
  if (floating > 0 && components > 1) {
    issues.push({
      level: 'warn',
      code: 'floating',
      title: 'Separate parts in mid-air',
      detail: `${floating} of ${components} parts don't touch the plate. They need supports or should be laid flat.`,
    })
  } else if (components > 1) {
    issues.push({
      level: 'info',
      code: 'parts',
      title: `${components} separate parts`,
      detail: 'The file contains several disconnected bodies. That is fine if they are meant to print together.',
    })
  }
  if (overhangPct > 10) {
    issues.push({
      level: overhangPct > 25 ? 'warn' : 'info',
      code: 'overhang',
      title: 'Overhangs need supports',
      detail: `${overhangPct.toFixed(0)}% of the surface overhangs more than 45°. Enable supports or rotate the model.`,
    })
  }
  const maxDim = Math.max(size.x, size.y, size.z)
  if (maxDim < 2) {
    issues.push({
      level: 'warn',
      code: 'tiny',
      title: 'Very small model',
      detail: `Largest side is ${maxDim.toFixed(3)} mm. It may have been exported in metres or inches. Try scaling by 1000% or 2540%.`,
    })
  } else if (maxDim > 1500) {
    issues.push({
      level: 'warn',
      code: 'huge',
      title: 'Very large model',
      detail: `Largest side is ${maxDim.toFixed(0)} mm. Check the units; it may need scaling down.`,
    })
  }
  if (triCount > 2_000_000) {
    issues.push({
      level: 'info',
      code: 'dense',
      title: 'Very dense mesh',
      detail: `${triCount.toLocaleString()} triangles. Slicing will be slow; consider decimating.`,
    })
  }

  const verdict: Verdict = issues.some((i) => i.level === 'error')
    ? 'fail'
    : issues.some((i) => i.level === 'warn')
      ? 'attention'
      : 'ready'

  return {
    verdict,
    issues,
    bed,
    stats: {
      triangles: triCount,
      invalidVertices: invalid,
      degenerate,
      openEdges: open,
      nonManifoldEdges: nonManifold,
      flippedEdges: flipped,
      components,
      floatingComponents: floating,
      watertight,
      volumeCm3,
      overhangPct,
      size,
      minZ: Number.isFinite(minZ) ? minZ : 0,
    },
  }
}
