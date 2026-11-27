// Shells: the separate connected bodies inside one mesh.

/** Splits non-indexed triangles into their connected shells (sharing a corner = connected), largest first. */
export function splitShells(p: Float32Array): Float32Array[] {
  const n = Math.floor(p.length / 9)
  if (!n) return []
  const ids = new Map<string, number>()
  const corner = new Int32Array(n * 3)
  for (let i = 0; i < n * 3; i++) {
    const x = p[i * 3]!, y = p[i * 3 + 1]!, z = p[i * 3 + 2]!
    const k = `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`
    let id = ids.get(k)
    if (id === undefined) ids.set(k, (id = ids.size))
    corner[i] = id
  }
  const parent = new Int32Array(ids.size)
  for (let i = 0; i < parent.length; i++) parent[i] = i
  const find = (a: number) => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]!]!
      a = parent[a]!
    }
    return a
  }
  for (let t = 0; t < n; t++) {
    const a = find(corner[t * 3]!)
    const b = find(corner[t * 3 + 1]!)
    const c = find(corner[t * 3 + 2]!)
    parent[b] = a
    parent[find(c)] = a
  }
  const groups = new Map<number, number[]>()
  for (let t = 0; t < n; t++) {
    const r = find(corner[t * 3]!)
    let g = groups.get(r)
    if (!g) groups.set(r, (g = []))
    g.push(t)
  }
  return [...groups.values()]
    .sort((a, b) => b.length - a.length)
    .map((tris) => {
      const out = new Float32Array(tris.length * 9)
      tris.forEach((t, i) => out.set(p.subarray(t * 9, t * 9 + 9), i * 9))
      return out
    })
}
