import type { ChopInfo, CsgRequest } from './csg.worker'

let worker: Worker | null = null
let seq = 0
const pending = new Map<number, { resolve: (r: Float32Array[], info?: ChopInfo) => void; reject: (e: Error) => void }>()

function getWorker() {
  if (worker) return worker
  worker = new Worker(new URL('./csg.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent<{ id: number; result?: Float32Array[]; info?: ChopInfo; error?: string }>) => {
    const p = pending.get(e.data.id)
    if (!p) return
    pending.delete(e.data.id)
    if (e.data.result) p.resolve(e.data.result, e.data.info)
    else p.reject(new Error(e.data.error ?? 'The operation failed.'))
  }
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(e.message || 'The geometry worker stopped.'))
    pending.clear()
    worker?.terminate()
    worker = null
  }
  return worker
}

/** Runs a solid-modelling operation off the UI thread; input buffers are handed over. */
export function runCsg(req: CsgRequest): Promise<Float32Array[]> {
  return runCsgInfo(req).then((r) => r.result)
}

/** Like runCsg, also returning the operation's extra facts (chop). */
export function runCsgInfo(req: CsgRequest): Promise<{ result: Float32Array[]; info?: ChopInfo }> {
  const id = ++seq
  const buffers: ArrayBuffer[] = []
  if ('solids' in req) for (const s of req.solids) buffers.push(s.buffer as ArrayBuffer)
  if ('solid' in req) buffers.push(req.solid.buffer as ArrayBuffer)
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve: (result, info) => resolve({ result, info }), reject })
    getWorker().postMessage({ id, req }, buffers)
  })
}
