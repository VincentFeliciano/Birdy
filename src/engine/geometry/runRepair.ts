import type { RepairResult } from './repair'

/** Runs one repair in a short-lived worker; the positions buffer is handed over, not copied. */
export function runRepair(positions: Float32Array): Promise<RepairResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./repair.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<{ result?: RepairResult; error?: string }>) => {
      worker.terminate()
      if (e.data.result) resolve(e.data.result)
      else reject(new Error(e.data.error ?? 'Repair failed'))
    }
    worker.onerror = (e) => {
      worker.terminate()
      reject(new Error(e.message || 'Repair failed'))
    }
    worker.postMessage({ positions }, [positions.buffer])
  })
}
