import type { ResinPrinter, ResinSettings } from './printers'
import { sliceResin } from './slice'

export interface ResinWorkerJob {
  /** Binary STL of the model as placed in the workspace. */
  stl: Uint8Array
  printer: ResinPrinter
  settings: ResinSettings
  softwareVersion: string
  smallPreview?: Uint8ClampedArray
  bigPreview?: Uint8ClampedArray
}

/** Binary STL to non-indexed triangle positions. */
function stlTriangles(stl: Uint8Array) {
  const view = new DataView(stl.buffer, stl.byteOffset, stl.byteLength)
  const n = Math.min(view.getUint32(80, true), Math.floor((stl.byteLength - 84) / 50))
  const out = new Float32Array(n * 9)
  for (let t = 0; t < n; t++) {
    const o = 84 + t * 50 + 12
    for (let k = 0; k < 9; k++) out[t * 9 + k] = view.getFloat32(o + k * 4, true)
  }
  return out
}

// Slices for resin off the UI thread, reporting progress as it goes.
self.onmessage = (e: MessageEvent<ResinWorkerJob>) => {
  try {
    const job = e.data
    let last = 0
    const result = sliceResin({ ...job, positions: stlTriangles(job.stl) }, (done) => {
      if (done - last >= 0.01 || done === 1) {
        last = done
        self.postMessage({ progress: done })
      }
    })
    self.postMessage({ result }, { transfer: result.parts.map((p) => p.buffer as ArrayBuffer) })
  } catch (err) {
    self.postMessage({ error: (err as Error).message })
  }
}
