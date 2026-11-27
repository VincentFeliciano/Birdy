// Mesh repair for 3D printing. Pure functions so it runs in a worker and in tests.
//
// Steps, in order:
//   1. drop triangles with corrupt (NaN / infinite) coordinates
//   2. weld vertices closer than `weld` mm, which closes hairline cracks between faces
//   3. drop zero-area triangles and duplicates (a face and its exact reverse are an internal
//      double wall, so both go)
//   4. make the winding of each connected part consistent
//   5. fill holes: each boundary loop is triangulated in its best-fit plane, or fanned from
//      its centre when that fails
//   6. turn inside-out parts the right way out (a part inside another part is a cavity and
//      is left as it is)
import { ShapeUtils, Vector2 } from 'three'

export interface RepairSummary {
  trianglesBefore: number
  trianglesAfter: number
  removedInvalid: number
  removedDegenerate: number
  removedDuplicates: number
  flippedFaces: number
  holesFilled: number
  facesAdded: number
  invertedParts: number
  remainingOpenEdges: number
  remainingNonManifoldEdges: number
}

export interface RepairResult {
  /** Non-indexed triangle positions, same layout as the input. */
  positions: Float32Array
  summary: RepairSummary
}

export interface RepairOptions {
  /** Vertices closer than this (mm) are merged. */
  weld?: number
}

/** Undirected edge -> faces using it. */
function edgeFaces(tri: number[], nVerts: number) {
  const map = new Map<number, number[]>()
  const faces = tri.length / 3
  for (let f = 0; f < faces; f++) {
    for (let e = 0; e < 3; e++) {
      const u = tri[f * 3 + e]!
      const v = tri[f * 3 + ((e + 1) % 3)]!
      const k = u < v ? u * nVerts + v : v * nVerts + u
      const list = map.get(k)
      if (list) list.push(f)
      else map.set(k, [f])
    }
  }
  return map
}

/** True when face `f` contains the directed edge u -> v. */
function hasDirected(tri: number[], f: number, u: number, v: number) {
  for (let e = 0; e < 3; e++) if (tri[f * 3 + e] === u && tri[f * 3 + ((e + 1) % 3)] === v) return true
  return false
}

function flipFace(tri: number[], f: number) {
  const t = tri[f * 3 + 1]!
  tri[f * 3 + 1] = tri[f * 3 + 2]!
  tri[f * 3 + 2] = t
}

export function repairMesh(p: Float32Array, opts: RepairOptions = {}): RepairResult {
  const weld = opts.weld ?? 1e-3
  const inTris = Math.floor(p.length / 9)
  const summary: RepairSummary = {
    trianglesBefore: inTris,
    trianglesAfter: 0,
    removedInvalid: 0,
    removedDegenerate: 0,
    removedDuplicates: 0,
    flippedFaces: 0,
    holesFilled: 0,
    facesAdded: 0,
    invertedParts: 0,
    remainingOpenEdges: 0,
    remainingNonManifoldEdges: 0,
  }

  // 1-2. Weld onto a grid and drop corrupt triangles.
  const ids = new Map<string, number>()
  const vx: number[] = []
  let tri: number[] = []
  const vid = (x: number, y: number, z: number) => {
    const q = [x / weld, y / weld, z / weld]
    const r = q.map(Math.round)
    const key = `${r[0]},${r[1]},${r[2]}`
    let id = ids.get(key)
    if (id !== undefined) return id
    // Near a cell edge, a matching point may have landed in the neighbouring cell.
    const steps = q.map((v, k) => (Math.abs(v - r[k]!) > 0.4 ? [0, Math.sign(v - r[k]!)] : [0]))
    for (const dx of steps[0]!) {
      for (const dy of steps[1]!) {
        for (const dz of steps[2]!) {
          if (!dx && !dy && !dz) continue
          const near = ids.get(`${r[0]! + dx},${r[1]! + dy},${r[2]! + dz}`)
          if (near !== undefined && Math.hypot(vx[near * 3]! - x, vx[near * 3 + 1]! - y, vx[near * 3 + 2]! - z) <= weld) return near
        }
      }
    }
    id = vx.length / 3
    ids.set(key, id)
    vx.push(x, y, z)
    return id
  }
  for (let t = 0; t < inTris; t++) {
    const o = t * 9
    let ok = true
    for (let k = 0; k < 9; k++) if (!Number.isFinite(p[o + k]!)) ok = false
    if (!ok) {
      summary.removedInvalid++
      continue
    }
    tri.push(vid(p[o]!, p[o + 1]!, p[o + 2]!), vid(p[o + 3]!, p[o + 4]!, p[o + 5]!), vid(p[o + 6]!, p[o + 7]!, p[o + 8]!))
  }

  // 3. Zero-area and duplicate faces.
  const area2 = (a: number, b: number, c: number) => {
    const ux = vx[b * 3]! - vx[a * 3]!, uy = vx[b * 3 + 1]! - vx[a * 3 + 1]!, uz = vx[b * 3 + 2]! - vx[a * 3 + 2]!
    const wx = vx[c * 3]! - vx[a * 3]!, wy = vx[c * 3 + 1]! - vx[a * 3 + 1]!, wz = vx[c * 3 + 2]! - vx[a * 3 + 2]!
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx
    return Math.sqrt(nx * nx + ny * ny + nz * nz)
  }
  {
    const seen = new Map<string, number>()
    const keep: boolean[] = []
    for (let f = 0; f < tri.length / 3; f++) {
      const a = tri[f * 3]!, b = tri[f * 3 + 1]!, c = tri[f * 3 + 2]!
      if (a === b || b === c || a === c || area2(a, b, c) < 1e-12) {
        summary.removedDegenerate++
        keep.push(false)
        continue
      }
      const key = [a, b, c].sort((x, y) => x - y).join(',')
      const prev = seen.get(key)
      if (prev === undefined) {
        seen.set(key, f)
        keep.push(true)
        continue
      }
      keep.push(false)
      summary.removedDuplicates++
      if (prev >= 0 && !hasDirected(tri, prev, a, b)) {
        // Opposite winding: an internal double wall. Remove its twin too.
        keep[prev] = false
        summary.removedDuplicates++
        seen.set(key, -1)
      }
    }
    const next: number[] = []
    for (let f = 0; f < keep.length; f++) if (keep[f]) next.push(tri[f * 3]!, tri[f * 3 + 1]!, tri[f * 3 + 2]!)
    tri = next
  }

  // 4. Consistent winding: walk each part across manifold edges, flipping faces that disagree.
  {
    const nV = vx.length / 3
    const edges = edgeFaces(tri, nV)
    const faces = tri.length / 3
    const visited = new Uint8Array(faces)
    const queue: number[] = []
    for (let s = 0; s < faces; s++) {
      if (visited[s]) continue
      visited[s] = 1
      queue.push(s)
      while (queue.length) {
        const f = queue.pop()!
        for (let e = 0; e < 3; e++) {
          const u = tri[f * 3 + e]!
          const v = tri[f * 3 + ((e + 1) % 3)]!
          const list = edges.get(u < v ? u * nV + v : v * nV + u)!
          if (list.length !== 2) continue
          const g = list[0] === f ? list[1]! : list[0]!
          if (visited[g]) continue
          visited[g] = 1
          // A neighbour must run along the shared edge the other way (v -> u).
          if (hasDirected(tri, g, u, v)) {
            flipFace(tri, g)
            summary.flippedFaces++
          }
          queue.push(g)
        }
      }
    }
  }

  // 5. Fill holes.
  {
    const nV = vx.length / 3
    const edges = edgeFaces(tri, nV)
    const out = new Map<number, number[]>()
    let boundary = 0
    for (let f = 0; f < tri.length / 3; f++) {
      for (let e = 0; e < 3; e++) {
        const u = tri[f * 3 + e]!
        const v = tri[f * 3 + ((e + 1) % 3)]!
        if (edges.get(u < v ? u * nV + v : v * nV + u)!.length !== 1) continue
        const list = out.get(u)
        if (list) list.push(v)
        else out.set(u, [v])
        boundary++
      }
    }
    let used = 0
    for (const [start, nexts] of out) {
      while (nexts.length && used < boundary) {
        // Trace one loop of boundary edges.
        const loop = [start]
        let cur = nexts.pop()!
        used++
        let closed = false
        while (true) {
          if (cur === start) {
            closed = true
            break
          }
          loop.push(cur)
          const options = out.get(cur)
          if (!options?.length || loop.length > boundary) break
          cur = options.pop()!
          used++
        }
        if (closed && loop.length >= 3) fillLoop(loop)
      }
    }
  }

  function fillLoop(loop: number[]) {
    const n = loop.length
    const P = (i: number) => [vx[loop[i]! * 3]!, vx[loop[i]! * 3 + 1]!, vx[loop[i]! * 3 + 2]!] as const
    // Newell normal of the loop and its centre.
    let nx = 0, ny = 0, nz = 0, cx = 0, cy = 0, cz = 0
    for (let i = 0; i < n; i++) {
      const a = P(i), b = P((i + 1) % n)
      nx += (a[1] - b[1]) * (a[2] + b[2])
      ny += (a[2] - b[2]) * (a[0] + b[0])
      nz += (a[0] - b[0]) * (a[1] + b[1])
      cx += a[0]
      cy += a[1]
      cz += a[2]
    }
    cx /= n
    cy /= n
    cz /= n
    const added: number[] = []
    const len = Math.hypot(nx, ny, nz)
    if (n === 3) {
      added.push(loop[0]!, loop[2]!, loop[1]!)
    } else if (len > 1e-12) {
      // Project onto the loop's plane and ear-clip.
      nx /= len
      ny /= len
      nz /= len
      const ax = Math.abs(nx) < 0.9 ? [1, 0, 0] : [0, 1, 0]
      let ux = ny * ax[2]! - nz * ax[1]!, uy = nz * ax[0]! - nx * ax[2]!, uz = nx * ax[1]! - ny * ax[0]!
      const ul = Math.hypot(ux, uy, uz)
      ux /= ul
      uy /= ul
      uz /= ul
      const wx = ny * uz - nz * uy, wy = nz * ux - nx * uz, wz = nx * uy - ny * ux
      const pts = loop.map((_, i) => {
        const a = P(i)
        const dx = a[0] - cx, dy = a[1] - cy, dz = a[2] - cz
        return new Vector2(dx * ux + dy * uy + dz * uz, dx * wx + dy * wy + dz * wz)
      })
      // Fill faces run against the loop, so they need the opposite 2D winding.
      const loopSign = Math.sign(ShapeUtils.area(pts))
      let tris: number[][] = []
      try {
        tris = ShapeUtils.triangulateShape(pts, [])
      } catch {
        tris = []
      }
      if (tris.length === n - 2 && loopSign !== 0) {
        for (const [i, j, k] of tris) {
          const s = Math.sign(ShapeUtils.area([pts[i!]!, pts[j!]!, pts[k!]!]))
          if (s === loopSign) added.push(loop[i!]!, loop[k!]!, loop[j!]!)
          else added.push(loop[i!]!, loop[j!]!, loop[k!]!)
        }
      }
    }
    if (!added.length) {
      // Fan from the centre: always closes the hole, even when the loop is not flat.
      const c = vx.length / 3
      vx.push(cx, cy, cz)
      for (let i = 0; i < n; i++) added.push(loop[(i + 1) % n]!, loop[i]!, c)
    }
    for (let i = 0; i < added.length; i += 3) {
      if (area2(added[i]!, added[i + 1]!, added[i + 2]!) < 1e-12) continue
      tri.push(added[i]!, added[i + 1]!, added[i + 2]!)
      summary.facesAdded++
    }
    summary.holesFilled++
  }

  // 6. Inside-out parts, and what could not be fixed.
  {
    const nV = vx.length / 3
    const edges = edgeFaces(tri, nV)
    const faces = tri.length / 3
    const parent = new Int32Array(faces)
    for (let i = 0; i < faces; i++) parent[i] = i
    const find = (a: number): number => {
      while (parent[a] !== a) {
        parent[a] = parent[parent[a]!]!
        a = parent[a]!
      }
      return a
    }
    const openParts = new Set<number>()
    for (const list of edges.values()) {
      if (list.length === 1) summary.remainingOpenEdges++
      else if (list.length > 2) summary.remainingNonManifoldEdges++
      for (let i = 1; i < list.length; i++) {
        const a = find(list[0]!), b = find(list[i]!)
        if (a !== b) parent[a] = b
      }
    }
    for (const list of edges.values()) if (list.length !== 2) openParts.add(find(list[0]!))

    interface Part {
      vol: number
      min: [number, number, number]
      max: [number, number, number]
    }
    const parts = new Map<number, Part>()
    for (let f = 0; f < faces; f++) {
      const r = find(f)
      let part = parts.get(r)
      if (!part) parts.set(r, (part = { vol: 0, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }))
      const a = tri[f * 3]! * 3, b = tri[f * 3 + 1]! * 3, c = tri[f * 3 + 2]! * 3
      part.vol +=
        (vx[a]! * (vx[b + 1]! * vx[c + 2]! - vx[b + 2]! * vx[c + 1]!) -
          vx[a + 1]! * (vx[b]! * vx[c + 2]! - vx[b + 2]! * vx[c]!) +
          vx[a + 2]! * (vx[b]! * vx[c + 1]! - vx[b + 1]! * vx[c]!)) /
        6
      for (const i of [a, b, c]) {
        for (let k = 0; k < 3; k++) {
          if (vx[i + k]! < part.min[k]!) part.min[k] = vx[i + k]!
          if (vx[i + k]! > part.max[k]!) part.max[k] = vx[i + k]!
        }
      }
    }
    const inside = (a: Part, b: Part) => [0, 1, 2].every((k) => a.min[k]! >= b.min[k]! && a.max[k]! <= b.max[k]!)
    const flipRoots = new Set<number>()
    for (const [r, part] of parts) {
      if (part.vol >= 0 || openParts.has(r)) continue
      const cavity = [...parts.entries()].some(([r2, other]) => r2 !== r && other.vol > 0 && inside(part, other))
      if (!cavity) flipRoots.add(r)
    }
    if (flipRoots.size) {
      summary.invertedParts = flipRoots.size
      for (let f = 0; f < faces; f++) if (flipRoots.has(find(f))) flipFace(tri, f)
    }
  }

  const positions = new Float32Array(tri.length * 3)
  for (let i = 0; i < tri.length; i++) {
    const v = tri[i]! * 3
    positions[i * 3] = vx[v]!
    positions[i * 3 + 1] = vx[v + 1]!
    positions[i * 3 + 2] = vx[v + 2]!
  }
  summary.trianglesAfter = tri.length / 3
  return { positions, summary }
}

/** Short, plain description of what a repair changed. */
export function describeRepair(s: RepairSummary): string {
  const parts: string[] = []
  const n = (v: number, one: string, many = `${one}s`) => `${v.toLocaleString()} ${v === 1 ? one : many}`
  if (s.holesFilled) parts.push(`filled ${n(s.holesFilled, 'hole')}`)
  if (s.flippedFaces) parts.push(`turned ${n(s.flippedFaces, 'face')} the right way`)
  if (s.invertedParts) parts.push(`turned ${n(s.invertedParts, 'inside-out part')} right side out`)
  if (s.removedDuplicates) parts.push(`removed ${n(s.removedDuplicates, 'duplicate face')}`)
  if (s.removedDegenerate) parts.push(`removed ${n(s.removedDegenerate, 'zero-area triangle')}`)
  if (s.removedInvalid) parts.push(`removed ${n(s.removedInvalid, 'corrupt triangle')}`)
  let text = parts.length ? `Repaired: ${parts.join(', ')}.` : 'Nothing to repair in the mesh itself.'
  if (s.remainingNonManifoldEdges) {
    text += ` ${n(s.remainingNonManifoldEdges, 'edge')} still join more than two faces (usually parts that touch); the slicer handles these.`
  }
  if (s.remainingOpenEdges) text += ` ${n(s.remainingOpenEdges, 'open edge')} could not be closed.`
  return text
}
