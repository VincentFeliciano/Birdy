import type { GcodePreview } from './parseGcode'

let seq = 0

/** Parses G-code in a short-lived worker (large files can use a lot of memory). */
export function parseGcodeInWorker(data: Uint8Array): Promise<GcodePreview> {
  const worker = new Worker(new URL('./gcode.worker.ts', import.meta.url), { type: 'module' })
  const id = ++seq
  return new Promise<GcodePreview>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<{ id: number; preview?: GcodePreview; error?: string }>) => {
      if (e.data.id !== id) return
      worker.terminate()
      if (e.data.preview) resolve(e.data.preview)
      else reject(new Error(e.data.error ?? 'Could not read the G-code.'))
    }
    worker.onerror = (e) => {
      worker.terminate()
      reject(new Error(e.message || 'Could not read the G-code.'))
    }
    worker.postMessage({ id, data }, [data.buffer as ArrayBuffer])
  })
}
