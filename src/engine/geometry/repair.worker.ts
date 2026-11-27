import { repairMesh } from './repair'

// Repairs a mesh off the UI thread.
self.onmessage = (e: MessageEvent<{ positions: Float32Array }>) => {
  try {
    const result = repairMesh(e.data.positions)
    self.postMessage({ result }, { transfer: [result.positions.buffer] })
  } catch (err) {
    self.postMessage({ error: (err as Error).message })
  }
}
