import type { ResinWorkerJob } from './resin.worker'
import type { ResinOutput } from './slice'

let current: Worker | null = null

/** Runs one resin slice in its own worker. `cancelResin` stops it. */
export function runResin(job: ResinWorkerJob, onProgress: (done: number) => void): Promise<ResinOutput> {
  cancelResin()
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./resin.worker.ts', import.meta.url), { type: 'module' })
    current = worker
    const done = () => {
      worker.terminate()
      if (current === worker) current = null
    }
    worker.onmessage = (e: MessageEvent<{ progress?: number; result?: ResinOutput; error?: string }>) => {
      if (e.data.progress !== undefined) return onProgress(e.data.progress)
      done()
      if (e.data.result) resolve(e.data.result)
      else reject(new Error(e.data.error ?? 'Slicing failed'))
    }
    worker.onerror = (e) => {
      done()
      reject(new Error(e.message || 'Slicing failed'))
    }
    ;(worker as Worker & { cancel?: () => void }).cancel = () => {
      done()
      reject(new Error('canceled'))
    }
    worker.postMessage(job, [job.stl.buffer as ArrayBuffer])
  })
}

export function cancelResin() {
  const w = current as (Worker & { cancel?: () => void }) | null
  w?.cancel?.()
}
