import { checkPrintability, type CheckInput } from './printCheck'

// Runs mesh diagnostics off the UI thread.
self.onmessage = (e: MessageEvent<{ id: number; input: CheckInput }>) => {
  const { id, input } = e.data
  try {
    const report = checkPrintability(input)
    // Hand the highlight buffers over rather than copying them.
    const buffers = Object.values(report.marks ?? {}).flatMap((m) => (m ? [m.buffer as ArrayBuffer] : []))
    self.postMessage({ id, report }, { transfer: buffers })
  } catch (err) {
    self.postMessage({ id, error: (err as Error).message })
  }
}
