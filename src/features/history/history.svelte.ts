import type { HistoryEntry, HistoryInput } from '../../types/ipc'
import { getViewer } from '../workspace/store.svelte'

// Print history, kept by the main process; this mirrors it for the Library view.
export const history = $state({ entries: [] as HistoryEntry[] })

export function initHistory() {
  const off = window.api.history.onChange((e) => (history.entries = e))
  void window.api.history.list().then((e) => (history.entries = e))
  return off
}

/** Adds a print to the history, with a small picture of the plate. Never throws. */
export async function recordPrint(entry: Omit<HistoryInput, 'thumbnail'>) {
  try {
    await window.api.history.add({ ...entry, thumbnail: getViewer()?.snapshot(160) ?? undefined })
  } catch {
    // History is a convenience; a failure to record never gets in the way of printing.
  }
}

export interface HistoryTotals {
  prints: number
  ok: number
  failed: number
  grams: number
  ml: number
  cost: number
  seconds: number
}

export function totals(entries: HistoryEntry[]): HistoryTotals {
  const t: HistoryTotals = { prints: entries.length, ok: 0, failed: 0, grams: 0, ml: 0, cost: 0, seconds: 0 }
  for (const e of entries) {
    if (e.outcome === 'ok') t.ok++
    if (e.outcome === 'failed') t.failed++
    t.grams += e.grams ?? 0
    t.ml += e.ml ?? 0
    t.cost += e.cost ?? 0
    t.seconds += e.seconds ?? 0
  }
  return t
}
