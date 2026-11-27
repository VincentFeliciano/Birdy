// Solid modelling on top of Manifold (WebAssembly): booleans, plane cuts and simplification.
// Pure functions over triangle soups; the caller passes the loaded Manifold module, so this runs
// in a worker in the app and directly in Node tests.

import type { Manifold as ManifoldT, ManifoldToplevel } from 'manifold-3d'

export type Wasm = ManifoldToplevel
export type BooleanOp = 'union' | 'difference' | 'intersect'

export class CsgError extends Error {}

/** Welds a triangle soup and hands it to Manifold. Throws CsgError when it isn't a closed solid. */
export function toManifold(wasm: Wasm, tris: Float32Array, what = 'This model'): ManifoldT {
  const n = Math.floor(tris.length / 9)
  if (!n) throw new CsgError(`${what} has no triangles.`)
  const ids = new Map<string, number>()
  const verts: number[] = []
  const tv = new Uint32Array(n * 3)
  for (let i = 0; i < n * 3; i++) {
    const x = tris[i * 3]!, y = tris[i * 3 + 1]!, z = tris[i * 3 + 2]!
    const k = `${Math.round(x * 1e5)},${Math.round(y * 1e5)},${Math.round(z * 1e5)}`
    let id = ids.get(k)
    if (id === undefined) {
      id = ids.size
      ids.set(k, id)
      verts.push(x, y, z)
    }
    tv[i] = id
  }
  // Drop triangles that collapsed when welding.
  const keep: number[] = []
  for (let t = 0; t < n; t++) {
    const a = tv[t * 3]!, b = tv[t * 3 + 1]!, c = tv[t * 3 + 2]!
    if (a !== b && b !== c && a !== c) keep.push(a, b, c)
  }
  const mesh = new wasm.Mesh({ numProp: 3, vertProperties: new Float32Array(verts), triVerts: new Uint32Array(keep) })
  mesh.merge()
  let m: ManifoldT
  try {
    m = new wasm.Manifold(mesh)
  } catch {
    throw new CsgError(`${what} isn't a closed solid (it has holes or loose edges). Repair it first, or use Rebuild as solid.`)
  }
  if (m.status() !== 'NoError') {
    const s = m.status()
    m.delete()
    throw new CsgError(`${what} isn't a closed solid (${s}). Repair it first, or use Rebuild as solid.`)
  }
  return m
}

/** Manifold back to a triangle soup. */
export function toTriangles(m: ManifoldT): Float32Array {
  const mesh = m.getMesh()
  const np = mesh.numProp
  const v = mesh.vertProperties
  const t = mesh.triVerts
  const out = new Float32Array(t.length * 3)
  for (let i = 0; i < t.length; i++) {
    const o = t[i]! * np
    out[i * 3] = v[o]!
    out[i * 3 + 1] = v[o + 1]!
    out[i * 3 + 2] = v[o + 2]!
  }
  return out
}

/** Runs `fn`, then frees every Manifold object it registered with `own`. */
function scoped<T>(fn: (own: <M extends { delete(): void }>(m: M) => M) => T): T {
  const owned: { delete(): void }[] = []
  try {
    return fn((m) => {
      owned.push(m)
      return m
    })
  } finally {
    for (const m of owned) m.delete()
  }
}

/**
 * Union: everything joined into one solid. Difference: the first minus all the others.
 * Intersect: only the volume every solid shares.
 */
export function booleanOp(wasm: Wasm, op: BooleanOp, solids: Float32Array[], names: string[] = []): Float32Array {
  if (solids.length < 2) throw new CsgError('That needs at least two models.')
  return scoped((own) => {
    const ms = solids.map((s, i) => own(toManifold(wasm, s, names[i] ?? `Model ${i + 1}`)))
    let r: ManifoldT
    if (op === 'union') r = own(wasm.Manifold.union(ms))
    else if (op === 'difference') r = own(wasm.Manifold.difference(ms))
    else r = own(wasm.Manifold.intersection(ms))
    if (r.isEmpty()) throw new CsgError(op === 'intersect' ? "They don't overlap, so nothing would be left." : 'Nothing would be left.')
    return toTriangles(r)
  })
}

/**
 * Cuts a solid with the plane `normal · p = offset`. Returns the part on the normal's side and
 * the part behind it; either can be empty (length 0) when the plane misses the model.
 */
export function cutByPlane(wasm: Wasm, solid: Float32Array, normal: [number, number, number], offset: number): [Float32Array, Float32Array] {
  return scoped((own) => {
    const m = own(toManifold(wasm, solid))
    const [above, below] = m.splitByPlane(normal, offset)
    own(above)
    own(below)
    return [above.isEmpty() ? new Float32Array(0) : toTriangles(above), below.isEmpty() ? new Float32Array(0) : toTriangles(below)]
  })
}

/** Removes triangles while keeping the surface within `tolerance` mm of where it was. */
export function simplifySolid(wasm: Wasm, solid: Float32Array, tolerance: number): Float32Array {
  return scoped((own) => {
    const m = own(toManifold(wasm, solid))
    return toTriangles(own(m.simplify(tolerance)))
  })
}

/** Volume of a closed triangle soup (mm³), by signed tetrahedra. */
export function volumeOf(p: Float32Array) {
  let v = 0
  for (let o = 0; o + 8 < p.length; o += 9) {
    v += (p[o]! * (p[o + 4]! * p[o + 8]! - p[o + 5]! * p[o + 7]!) - p[o + 1]! * (p[o + 3]! * p[o + 8]! - p[o + 5]! * p[o + 6]!) + p[o + 2]! * (p[o + 3]! * p[o + 7]! - p[o + 4]! * p[o + 6]!)) / 6
  }
  return v
}
