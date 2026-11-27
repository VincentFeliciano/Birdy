import { BIG_PREVIEW, decodeLayer, SMALL_PREVIEW } from '../../engine/resin/goo'
import { DEFAULT_RESIN, RESIN_PRINTERS, type ResinPrinter, type ResinSettings } from '../../engine/resin/printers'
import { cancelResin, runResin } from '../../engine/resin/runResin'
import type { ResinIsland } from '../../engine/resin/slice'
import { updates } from '../../app/updates.svelte'
import { activeModel, BED, exportActive, getViewer, setBed, ws } from '../workspace/store.svelte'

// Resin (MSLA) slicing: Birdy's own slicer writing Elegoo .goo files.

export type SliceMode = 'fdm' | 'resin'

const CUSTOM: ResinPrinter = { id: 'custom', name: 'Custom resin printer', resX: 11520, resY: 5120, sizeX: 218.88, sizeY: 122.88, sizeZ: 220 }

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v ? { ...fallback, ...JSON.parse(v) } : fallback
  } catch {
    return fallback
  }
}

export interface ResinResult {
  layers: number
  printSeconds: number
  volumeMm3: number
  weightG: number
  bytes: number
  size: { x: number; y: number; z: number }
  printer: ResinPrinter
  modelId: string | null
  name: string
  islands: ResinIsland[]
  islandCount: number
}

export const resin = $state({
  mode: (localStorage.getItem('birdy.sliceMode') === 'resin' ? 'resin' : 'fdm') as SliceMode,
  printerId: localStorage.getItem('birdy.resinPrinter') ?? RESIN_PRINTERS[1]!.id,
  custom: load('birdy.resinCustom', CUSTOM),
  settings: load('birdy.resinSettings', DEFAULT_RESIN),
  slicing: false,
  progress: 0,
  error: null as string | null,
  result: null as ResinResult | null,
  saving: false,
  savedPath: null as string | null,
  saveError: null as string | null,
  layer: 0,
  layerUrl: null as string | null,
  /** Island picked in the list (index into result.islands), or -1. */
  island: -1,
})

/** The finished file, kept out of reactive state (it can be hundreds of MB). */
let parts: Uint8Array[] | null = null
/** Build volume to put back when leaving resin mode. */
let fdmBed: { x: number; y: number; z: number } | null = null
/** The model's transform when it was sliced, so island rings follow it in the 3D view. */
let slicedAt: import('three').Matrix4 | null = null

export function resinPrinter(): ResinPrinter {
  return resin.printerId === 'custom' ? resin.custom : (RESIN_PRINTERS.find((p) => p.id === resin.printerId) ?? RESIN_PRINTERS[0]!)
}

function persist() {
  localStorage.setItem('birdy.resinPrinter', resin.printerId)
  localStorage.setItem('birdy.resinCustom', JSON.stringify(resin.custom))
  localStorage.setItem('birdy.resinSettings', JSON.stringify(resin.settings))
}

/** Shows the resin printer's plate in the 3D view and checks the model against it. */
function applyBed() {
  const p = resinPrinter()
  setBed(p.sizeX, p.sizeY, p.sizeZ)
}

export function setMode(mode: SliceMode) {
  if (mode === resin.mode) return
  resin.mode = mode
  localStorage.setItem('birdy.sliceMode', mode)
  if (mode === 'resin') {
    fdmBed = { x: BED.x, y: BED.y, z: BED.z }
    localStorage.setItem('birdy.fdmBed', JSON.stringify(fdmBed))
    applyBed()
  } else {
    const saved = fdmBed ?? load<{ x: number; y: number; z: number } | null>('birdy.fdmBed', null)
    if (saved) setBed(saved.x, saved.y, saved.z)
  }
}

/** Called when the Slice tab opens in resin mode (e.g. after a restart). */
export function initResin() {
  if (resin.mode === 'resin') applyBed()
}

export function choosePrinter(id: string) {
  resin.printerId = id
  persist()
  applyBed()
  clearResult()
}

export function setCustom<K extends keyof ResinPrinter>(key: K, value: ResinPrinter[K]) {
  resin.custom[key] = value
  persist()
  if (resin.printerId === 'custom') applyBed()
  clearResult()
}

export function setSetting<K extends keyof ResinSettings>(key: K, value: ResinSettings[K]) {
  resin.settings[key] = value
  persist()
  clearResult()
}

export function resetSettings() {
  resin.settings = { ...DEFAULT_RESIN }
  persist()
  clearResult()
}

export function clearResult() {
  parts = null
  slicedAt = null
  resin.island = -1
  getViewer()?.setIslands(null, null)
  resin.result = null
  resin.savedPath = null
  resin.saveError = null
  resin.layerUrl = null
}

/** The 3D view as the small and large thumbnails printers show on their screen. */
async function previews(): Promise<{ small?: Uint8ClampedArray; big?: Uint8ClampedArray }> {
  const url = getViewer()?.snapshot(720)
  if (!url) return {}
  const img = new Image()
  img.src = url
  try {
    await img.decode()
  } catch {
    return {}
  }
  const draw = (size: number) => {
    const c = document.createElement('canvas')
    c.width = c.height = size
    const g = c.getContext('2d')
    if (!g) return undefined
    g.fillStyle = '#0b0c0f'
    g.fillRect(0, 0, size, size)
    const k = Math.min(size / img.width, size / img.height)
    g.drawImage(img, (size - img.width * k) / 2, (size - img.height * k) / 2, img.width * k, img.height * k)
    return g.getImageData(0, 0, size, size).data
  }
  return { small: draw(SMALL_PREVIEW), big: draw(BIG_PREVIEW) }
}

export async function sliceResinModel() {
  const model = activeModel()
  const stl = exportActive('stl')
  if (!model || !stl) return
  clearResult()
  resin.error = null
  resin.slicing = true
  resin.progress = 0
  const printer = $state.snapshot(resinPrinter())
  const settings = $state.snapshot(resin.settings)
  const at = getViewer()?.modelMatrix() ?? null
  try {
    const pv = await previews()
    const out = await runResin(
      {
        stl,
        printer,
        settings,
        softwareVersion: updates.state?.current ?? 'dev',
        smallPreview: pv.small,
        bigPreview: pv.big,
      },
      (p) => (resin.progress = p),
    )
    parts = out.parts
    resin.result = {
      layers: out.layers,
      printSeconds: out.printSeconds,
      volumeMm3: out.volumeMm3,
      weightG: out.weightG,
      bytes: out.bytes,
      size: out.size,
      printer,
      modelId: ws.activeId,
      name: model.name.replace(/\.[^.]+$/, ''),
      islands: out.islands,
      islandCount: out.islandCount,
    }
    slicedAt = at
    showIslands()
    showLayer(out.islands[0]?.layer ?? Math.floor(out.layers / 3))
  } catch (err) {
    const msg = (err as Error).message
    if (msg !== 'canceled') resin.error = msg
  } finally {
    resin.slicing = false
  }
}

export function cancelResinSlice() {
  cancelResin()
}

export async function saveResin() {
  const r = resin.result
  if (!parts || !r) return
  resin.saving = true
  resin.saveError = null
  try {
    const res = await window.api.resin.save({ suggestedName: `${r.name}.goo`, parts })
    if (res.ok && res.path) resin.savedPath = res.path
    else if (!res.canceled) resin.saveError = res.error ?? 'Could not save the file.'
  } catch (err) {
    resin.saveError = (err as Error).message
  } finally {
    resin.saving = false
  }
}

function showIslands() {
  const r = resin.result
  const px = r ? r.printer.sizeX / r.printer.resX : 0
  getViewer()?.setIslands(
    r?.islands.map((i) => ({ x: i.x, y: i.y, z: i.z, r: Math.max(i.radiusPx * px, 0.5) })) ?? null,
    slicedAt,
    resin.island,
  )
}

/** Picks an island from the list: its layer in the preview, and the 3D view zoomed to it. Again to let go. */
export function pickIsland(i: number) {
  const r = resin.result
  if (!r) return
  resin.island = resin.island === i ? -1 : i
  showIslands()
  const isl = r.islands[resin.island]
  if (isl) showLayer(isl.layer)
  else showLayer(resin.layer)
}

/** Draws layer `n` of the sliced file, scaled down, in the neon colour. */
export function showLayer(n: number) {
  const r = resin.result
  if (!parts || !r) return
  n = Math.max(0, Math.min(r.layers - 1, Math.round(n)))
  resin.layer = n
  const rec = parts[n + 1]
  if (!rec) return
  const view = new DataView(rec.buffer, rec.byteOffset, rec.byteLength)
  const len = view.getUint32(66)
  const image = rec.subarray(71, 71 + len - 2)
  const { resX, resY } = r.printer
  const scale = Math.max(1, Math.ceil(resX / 720))
  const w = Math.ceil(resX / scale)
  const h = Math.ceil(resY / scale)
  const cells = new Uint8Array(w * h)
  let pos = 0
  decodeLayer(image, (length, value) => {
    if (value) {
      let p = pos
      let left = length
      while (left > 0) {
        const row = Math.floor(p / resX)
        const col = p % resX
        const n2 = Math.min(left, resX - col)
        const base = Math.floor(row / scale) * w
        const end = Math.floor((col + n2 - 1) / scale)
        for (let c = Math.floor(col / scale); c <= end; c++) if (cells[base + c]! < value) cells[base + c] = value
        p += n2
        left -= n2
      }
    }
    pos += length
  })
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const g = canvas.getContext('2d')
  if (!g) return
  const img = g.createImageData(w, h)
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#f5c400'
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(accent)
  const [ar, ag, ab] = m ? [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)] : [245, 196, 0]
  for (let i = 0; i < cells.length; i++) {
    const v = cells[i]! / 255
    img.data[i * 4] = 12 + (ar - 12) * v
    img.data[i * 4 + 1] = 13 + (ag - 13) * v
    img.data[i * 4 + 2] = 16 + (ab - 16) * v
    img.data[i * 4 + 3] = 255
  }
  g.putImageData(img, 0, 0)
  // Ring the islands that start on this layer.
  g.lineWidth = 2
  r.islands.forEach((isl, i) => {
    if (isl.layer !== n) return
    const picked = i === resin.island
    g.strokeStyle = picked ? '#ff3df2' : 'rgba(255, 61, 242, 0.75)'
    g.lineWidth = picked ? 3 : 2
    g.beginPath()
    g.arc(isl.col / scale, isl.row / scale, Math.max(6, isl.radiusPx / scale + 5), 0, Math.PI * 2)
    g.stroke()
  })
  resin.layerUrl = canvas.toDataURL('image/png')
}
