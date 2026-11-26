import { parseGcode } from './parseGcode'

// Parses G-code off the UI thread and hands the buffers back without copying.
self.onmessage = (e: MessageEvent<{ id: number; data: Uint8Array }>) => {
  const { id, data } = e.data
  try {
    const p = parseGcode(new TextDecoder().decode(data))
    const transfer = [p.positions.buffer, p.featureOf.buffer, p.layerEnds.buffer, p.layerZ.buffer, p.travels.buffer, p.travelEnds.buffer]
    ;(self as unknown as Worker).postMessage({ id, preview: p }, transfer as ArrayBuffer[])
  } catch (err) {
    self.postMessage({ id, error: (err as Error).message })
  }
}
