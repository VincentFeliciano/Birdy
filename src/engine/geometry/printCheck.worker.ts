import { checkPrintability, type CheckInput } from './printCheck'

// Runs mesh diagnostics off the UI thread.
self.onmessage = (e: MessageEvent<{ id: number; input: CheckInput }>) => {
  const { id, input } = e.data
  try {
    self.postMessage({ id, report: checkPrintability(input) })
  } catch (err) {
    self.postMessage({ id, error: (err as Error).message })
  }
}
