import { exposureTest } from './exposureTest'
import type { ResinPrinter, ResinSettings } from './printers'
import { sliceSupported } from './pipeline'
import type { HollowSettings, ResinOutput } from './slice'
import type { SupportSettings } from './supports'

export interface ResinWorkerJob {
  /** 'test' builds the exposure test print instead of slicing a model. */
  kind?: 'slice' | 'test'
  /** Binary STL of the model as placed in the workspace (not used for the test print). */
  stl: Uint8Array
  printer: ResinPrinter
  settings: ResinSettings
  softwareVersion: string
  smallPreview?: Uint8ClampedArray
  bigPreview?: Uint8ClampedArray
  supports?: SupportSettings
  hollow?: HollowSettings
}

export interface ResinWorkerOutput extends ResinOutput {
  /** Supports Birdy added: how many, how many stand on the model, the lift, and their triangles for the 3D view. */
  support?: { count: number; onModel: number; lift: number; preview: Float32Array }
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
    if (job.kind === 'test') {
      const result = exposureTest(job.printer, job.settings, job.softwareVersion)
      self.postMessage({ result }, { transfer: result.parts.map((p) => p.buffer as ArrayBuffer) })
      return
    }
    let last = 0
    const { support: gen, ...sliced } = sliceSupported(job, stlTriangles(job.stl), job.supports, (done) => {
      if (done - last >= 0.01 || done === 1) {
        last = done
        self.postMessage({ progress: done })
      }
    })
    const support = gen ? { count: gen.count, onModel: gen.onModel, lift: gen.lift, preview: gen.supports } : undefined
    const result: ResinWorkerOutput = { ...sliced, support }
    const transfer = result.parts.map((p) => p.buffer as ArrayBuffer)
    if (support) transfer.push(support.preview.buffer as ArrayBuffer)
    self.postMessage({ result }, { transfer })
  } catch (err) {
    self.postMessage({ error: (err as Error).message })
  }
}
