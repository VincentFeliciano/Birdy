// Runs Manifold (WebAssembly) off the UI thread. The module loads once and stays warm.
import Module from 'manifold-3d'
import wasmUrl from 'manifold-3d/manifold.wasm?url'
import { booleanOp, cutByPlane, simplifySolid, type BooleanOp, type Wasm } from './csg'
import { rebuildSolid, hollowSolid } from './solidify'
import { chop, type ChopOptions } from './chop'

export type CsgRequest =
  | { op: 'boolean'; kind: BooleanOp; solids: Float32Array[]; names: string[] }
  | { op: 'cut'; solid: Float32Array; normal: [number, number, number]; offset: number }
  | { op: 'simplify'; solid: Float32Array; tolerance: number }
  | { op: 'rebuild'; solid: Float32Array; voxel: number }
  | { op: 'hollow'; solid: Float32Array; wall: number; voxel: number }
  | { op: 'chop'; solid: Float32Array; options: Partial<ChopOptions> }

/** Extra facts about a chop: per piece offset, how many dowels follow the pieces, counts. */
export interface ChopInfo {
  offsets: [number, number, number][]
  dowels: number
  cuts: number
  joiners: number
  skipped: number
  oversize: number
}

let ready: Promise<Wasm> | null = null
const load = () =>
  (ready ??= Module({ locateFile: () => wasmUrl }).then((w) => {
    w.setup()
    return w
  }))

self.onmessage = async (e: MessageEvent<{ id: number; req: CsgRequest }>) => {
  const { id, req } = e.data
  try {
    const wasm = await load()
    let result: Float32Array[]
    let info: ChopInfo | undefined
    if (req.op === 'boolean') result = [booleanOp(wasm, req.kind, req.solids, req.names)]
    else if (req.op === 'cut') result = cutByPlane(wasm, req.solid, req.normal, req.offset)
    else if (req.op === 'simplify') result = [simplifySolid(wasm, req.solid, req.tolerance)]
    else if (req.op === 'rebuild') result = [rebuildSolid(wasm, req.solid, req.voxel)]
    else if (req.op === 'hollow') result = [hollowSolid(wasm, req.solid, req.wall, req.voxel)]
    else {
      const r = chop(wasm, req.solid, req.options)
      result = [...r.pieces.map((p) => p.tris), ...r.dowels]
      info = { offsets: r.pieces.map((p) => p.offset), dowels: r.dowels.length, cuts: r.cuts, joiners: r.joiners, skipped: r.skipped, oversize: r.oversize }
    }
    self.postMessage({ id, result, info }, { transfer: result.map((r) => r.buffer as ArrayBuffer) })
  } catch (err) {
    self.postMessage({ id, error: (err as Error).message })
  }
}
