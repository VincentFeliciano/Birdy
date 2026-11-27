// Live status of the user's network printers, polled while the bar is showing.
import type { PrinterInfo, PrinterStatus } from '../../types/slicing'

const POLL_MS = 5000
const HIDE_KEY = 'birdy.printerBar.hidden'

export const bar = $state({
  printers: [] as PrinterInfo[],
  status: {} as Record<string, PrinterStatus>,
  snapshots: {} as Record<string, string | null>,
  open: null as string | null,
  hidden: localStorage.getItem(HIDE_KEY) === '1',
})

export const networkPrinters = () => bar.printers.filter((p) => p.kind !== 'serial')

export function setBarHidden(hidden: boolean) {
  bar.hidden = hidden
  localStorage.setItem(HIDE_KEY, hidden ? '1' : '0')
}

let timer: ReturnType<typeof setTimeout> | null = null
let running = false

async function tick() {
  if (!running) return
  try {
    bar.printers = await window.api.printers.list()
    const ids = new Set(networkPrinters().map((p) => p.id))
    if (!bar.hidden && ids.size) {
      const results = await Promise.all([...ids].map(async (id) => [id, await window.api.printers.status(id)] as const))
      const next: Record<string, PrinterStatus> = {}
      for (const [id, s] of results) next[id] = s
      bar.status = next
      if (bar.open && ids.has(bar.open) && next[bar.open]?.camera) {
        bar.snapshots[bar.open] = await window.api.printers.snapshot(bar.open)
      }
    }
    if (bar.open && !ids.has(bar.open)) bar.open = null
  } catch {
    // The next poll tries again.
  }
  if (running) timer = setTimeout(tick, POLL_MS)
}

/** Start polling; returns a stop function. Polls pause while the window is hidden. */
export function initPrinterBar() {
  const start = () => {
    if (running) return
    running = true
    void tick()
  }
  const stop = () => {
    running = false
    if (timer) clearTimeout(timer)
    timer = null
  }
  const vis = () => (document.hidden ? stop() : start())
  document.addEventListener('visibilitychange', vis)
  start()
  return () => {
    document.removeEventListener('visibilitychange', vis)
    stop()
  }
}

/** Poll now, e.g. after opening a printer or un-hiding the bar. */
export function refreshPrinters() {
  if (!running) return
  if (timer) clearTimeout(timer)
  void tick()
}

export function togglePrinter(id: string) {
  bar.open = bar.open === id ? null : id
  refreshPrinters()
}

export function fmtTime(s: number | null) {
  if (s === null || !Number.isFinite(s)) return '—'
  const h = Math.floor(s / 3600)
  const m = Math.round((s % 3600) / 60)
  return h ? `${h}h ${m}m` : `${m}m`
}

export function fmtTemp(actual: number | null, target: number | null) {
  if (actual === null) return '—'
  return target ? `${Math.round(actual)}/${Math.round(target)}°` : `${Math.round(actual)}°`
}
