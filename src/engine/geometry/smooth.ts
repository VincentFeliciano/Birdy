// Taubin smoothing: alternating shrink and inflate Laplacian steps, which evens out bumps and
// scan noise without the shrinking plain Laplacian smoothing causes.

export function smoothMesh(p: Float32Array, iterations: number, lambda = 0.5, mu = -0.53): Float32Array {
  const n = Math.floor(p.length / 9)
  const ids = new Map<string, number>()
  const corner = new Int32Array(n * 3)
  const pos: number[] = []
  for (let i = 0; i < n * 3; i++) {
    const k = `${Math.round(p[i * 3]! * 1e4)},${Math.round(p[i * 3 + 1]! * 1e4)},${Math.round(p[i * 3 + 2]! * 1e4)}`
    let id = ids.get(k)
    if (id === undefined) {
      id = ids.size
      ids.set(k, id)
      pos.push(p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!)
    }
    corner[i] = id
  }
  const nv = ids.size
  // Neighbours from edges, and which vertices sit on an open edge (kept still so holes don't creep).
  const nbr: Set<number>[] = Array.from({ length: nv }, () => new Set())
  const edgeUse = new Map<number, number>()
  for (let t = 0; t < n; t++)
    for (let k = 0; k < 3; k++) {
      const a = corner[t * 3 + k]!, b = corner[t * 3 + ((k + 1) % 3)]!
      nbr[a]!.add(b)
      nbr[b]!.add(a)
      const key = Math.min(a, b) * nv + Math.max(a, b)
      edgeUse.set(key, (edgeUse.get(key) ?? 0) + 1)
    }
  const pinned = new Uint8Array(nv)
  for (const [key, uses] of edgeUse)
    if (uses === 1) {
      pinned[Math.floor(key / nv)] = 1
      pinned[key % nv] = 1
    }
  // Sharp edges (faces meeting at more than ~60°) stay put too, so boxes and machined faces keep
  // their corners while curved and noisy surfaces are evened out.
  const fn = new Float64Array(n * 3)
  for (let t = 0; t < n; t++) {
    const o = t * 9
    const ux = p[o + 3]! - p[o]!, uy = p[o + 4]! - p[o + 1]!, uz = p[o + 5]! - p[o + 2]!
    const vx = p[o + 6]! - p[o]!, vy = p[o + 7]! - p[o + 1]!, vz = p[o + 8]! - p[o + 2]!
    const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx
    const l = Math.hypot(x, y, z) || 1
    fn[t * 3] = x / l
    fn[t * 3 + 1] = y / l
    fn[t * 3 + 2] = z / l
  }
  const firstFace = new Map<number, number>()
  for (let t = 0; t < n; t++)
    for (let k = 0; k < 3; k++) {
      const a = corner[t * 3 + k]!, b = corner[t * 3 + ((k + 1) % 3)]!
      if (a === b) continue
      const key = Math.min(a, b) * nv + Math.max(a, b)
      const f = firstFace.get(key)
      if (f === undefined) {
        firstFace.set(key, t)
        continue
      }
      const dot = fn[f * 3]! * fn[t * 3]! + fn[f * 3 + 1]! * fn[t * 3 + 1]! + fn[f * 3 + 2]! * fn[t * 3 + 2]!
      if (dot < 0.5) {
        pinned[a] = 1
        pinned[b] = 1
      }
    }
  let cur = Float64Array.from(pos)
  let next = new Float64Array(cur.length)
  const step = (f: number) => {
    for (let v = 0; v < nv; v++) {
      const ns = nbr[v]!
      if (pinned[v] || !ns.size) {
        next[v * 3] = cur[v * 3]!
        next[v * 3 + 1] = cur[v * 3 + 1]!
        next[v * 3 + 2] = cur[v * 3 + 2]!
        continue
      }
      let x = 0, y = 0, z = 0
      for (const u of ns) {
        x += cur[u * 3]!
        y += cur[u * 3 + 1]!
        z += cur[u * 3 + 2]!
      }
      const k = ns.size
      next[v * 3] = cur[v * 3]! + f * (x / k - cur[v * 3]!)
      next[v * 3 + 1] = cur[v * 3 + 1]! + f * (y / k - cur[v * 3 + 1]!)
      next[v * 3 + 2] = cur[v * 3 + 2]! + f * (z / k - cur[v * 3 + 2]!)
    }
    ;[cur, next] = [next, cur]
  }
  for (let i = 0; i < iterations; i++) {
    step(lambda)
    step(mu)
  }
  const out = new Float32Array(n * 9)
  for (let i = 0; i < n * 3; i++) {
    const v = corner[i]!
    out[i * 3] = cur[v * 3]!
    out[i * 3 + 1] = cur[v * 3 + 1]!
    out[i * 3 + 2] = cur[v * 3 + 2]!
  }
  return out
}
