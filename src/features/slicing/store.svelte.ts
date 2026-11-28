import { isFdmKind } from '../../types/slicing'
import { tick } from 'svelte'
import type {
  EngineState,
  ImportCandidate,
  ImportSource,
  PresetCatalog,
  PresetRef,
  PrinterInfo,
  SendResult,
  SerialPortChoice,
  SliceOverrides,
  SliceResult,
  SliceSettings,
} from '../../types/slicing'
import { fitsMachine } from '../../../electron/slicing/presets'
import { parseGcodeInWorker } from '../../engine/gcode/runParse'
import { printCost } from '../../app/costs.svelte'
import { recordPrint } from '../history/history.svelte'
import { activeModel, exportActive, getViewer, onModelChange, setBed, ws } from '../workspace/store.svelte'
import { startUsbPrint } from './usb.svelte'
import { resin } from './resin.svelte'

const SETTINGS_KEY = 'birdy.slice'

function loadSettings(): SliceSettings {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '') as SliceSettings
    if (s && typeof s.machine === 'string') return { machine: s.machine, process: s.process ?? '', filament: s.filament ?? '', overrides: s.overrides ?? {} }
  } catch {
    /* defaults */
  }
  return { machine: '', process: '', filament: '', overrides: {} }
}

export interface FeatureStat {
  name: string
  color: string
  count: number
}

export const sl = $state({
  engine: null as EngineState | null,
  catalog: null as PresetCatalog | null,
  catalogLoading: false,
  catalogError: null as string | null,
  settings: loadSettings(),
  showAll: false,
  slicing: false,
  sliceStarted: 0,
  result: null as SliceResult | null,
  resultFor: null as string | null,
  stale: false,
  error: null as string | null,
  /** Where G-code is saved (the user's pick, often a USB stick). */
  gcodeFolder: null as string | null,
  candidates: [] as ImportCandidate[],
  importing: null as ImportSource | null,
  importNotes: [] as string[],
  printers: [] as PrinterInfo[],
  printerId: localStorage.getItem('birdy.printer') ?? '',
  startPrint: true,
  sending: false,
  sendResult: null as SendResult | null,
  managePrinters: false,
  /** The custom printer editor: open for a new printer, or for editing one by name. */
  editor: null as null | { edit: string | null },
  /** The window listing every engine setting for the chosen presets. */
  allSettings: false,
  /** Set while the system is waiting for the user to pick a USB serial port. */
  portChoices: null as SerialPortChoice[] | null,
  preview: {
    loading: false,
    ready: false,
    on: false,
    layers: 0,
    layer: 0,
    layerZ: [] as number[],
    features: [] as FeatureStat[],
    travel: false,
  },
})

/** Toolpath colours by feature. Bright enough to read on the dark plate. */
const FEATURE_COLORS: Record<string, string> = {
  'Outer wall': '#ff9f1c',
  'Inner wall': '#ffe066',
  'Sparse infill': '#e0457b',
  'Solid infill': '#a64dff',
  'Top surface': '#ff4d5e',
  'Bottom surface': '#4d7cff',
  Bridge: '#3ddcff',
  Support: '#3ee08f',
  'Skirt / brim': '#9aa4b2',
  'Gap infill': '#f5f5f5',
  Ironing: '#ff8ad8',
  'Prime tower': '#7fd1b9',
}
export const featureColor = (name: string) => FEATURE_COLORS[name] ?? '#6b7280'

function persist() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify($state.snapshot(sl.settings)))
}

let started = false
/** Loads engine state, printers and import sources once. */
export function initSlicing() {
  if (started) return
  started = true
  const off = window.api.engine.onState((s) => {
    const wasInstalling = sl.engine?.installing
    sl.engine = s
    if (wasInstalling && !s.installing && s.source) void loadCatalog()
  })
  void window.api.engine.get().then((s) => {
    sl.engine = s
    if (s.source) void loadCatalog()
  })
  void window.api.printers.list().then((p) => (sl.printers = p))
  void window.api.engine.importCandidates().then((c) => (sl.candidates = c))
  const offPorts = window.api.printers.onChoosePort((ports) => {
    sl.portChoices = ports
    ws.layout = ws.layout === 'browse' ? 'split' : ws.layout
    ws.sidebarOpen = true
    ws.sidebarTab = 'slice'
  })
  onModelChange((change) => {
    if (change === 'switch') clearSlice()
    else if (sl.result?.ok) sl.stale = true
  })
  return () => {
    off()
    offPorts()
  }
}

export function answerPort(portId: string | null) {
  window.api.printers.choosePort(portId)
  sl.portChoices = null
}

export async function loadCatalog(refresh = false) {
  sl.catalogLoading = true
  sl.catalogError = null
  try {
    sl.catalog = await window.api.engine.catalog(refresh)
    ensureValidSelection()
    void followBed()
  } catch (err) {
    sl.catalogError = cleanError(err)
  } finally {
    sl.catalogLoading = false
  }
}

const cleanError = (err: unknown) => String((err as Error).message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export const machineRef = (): PresetRef | undefined => sl.catalog?.machines.find((m) => m.name === sl.settings.machine)

/** Keeps the chosen process and filament valid for the chosen printer. */
function ensureValidSelection() {
  const c = sl.catalog
  if (!c) return
  const m = machineRef()
  if (!m) {
    sl.settings.machine = ''
    return
  }
  const fitting = (list: PresetRef[]) => list.filter((p) => fitsMachine(p, m))
  // Presets made for exactly this printer (a custom printer's own, or the ones Boaty ships) come first.
  const mine = (p: PresetRef) => p.user === true && p.name.endsWith(`@${m.name}`)
  const procs = fitting(c.processes).sort((a, b) => Number(mine(b)) - Number(mine(a)))
  if (!c.processes.some((p) => p.name === sl.settings.process)) {
    sl.settings.process = (procs.find((p) => mine(p) && /0\.20mm/.test(p.name)) ?? procs.find(mine) ?? procs.find((p) => /0\.20mm Standard/.test(p.name)) ?? procs[0] ?? c.processes[0])?.name ?? ''
  }
  const fils = fitting(c.filaments)
  if (!c.filaments.some((f) => f.name === sl.settings.filament)) {
    // Prefer the printer maker's own PLA for this printer, then generic PLA.
    const own = fils.find((f) => mine(f) && /\bPLA\b/.test(f.name)) ?? fils.find((f) => f.vendor === m.vendor && /\bPLA\b/.test(f.name) && f.name.includes('@'))
    const generic = fils.find((f) => f.name === 'Generic PLA @System')
    sl.settings.filament = (own ?? generic ?? fils.find((f) => /PLA/.test(f.name)) ?? fils[0] ?? c.filaments[0])?.name ?? ''
  }
  persist()
}

export function chooseMachine(name: string) {
  const before = machineRef()
  sl.settings.machine = name
  const m = machineRef()
  if (m && sl.catalog) {
    // Switching printers: move to that printer's matching process and filament.
    // A printer with its own presets ("… @<printer>") always starts on them.
    const hasOwn = (list: PresetRef[]) => list.some((p) => p.user && p.name.endsWith(`@${m.name}`))
    const ownFor = (name: string) => name.endsWith(`@${m.name}`)
    const proc = sl.catalog.processes.find((p) => p.name === sl.settings.process)
    if (!proc || (before && !fitsMachine(proc, m)) || (hasOwn(sl.catalog.processes) && !ownFor(proc.name))) sl.settings.process = ''
    const fil = sl.catalog.filaments.find((f) => f.name === sl.settings.filament)
    if (!fil || !fitsMachine(fil, m) || (hasOwn(sl.catalog.filaments) && !ownFor(fil.name))) sl.settings.filament = ''
  }
  ensureValidSelection()
  persist()
  void followBed()
}

let bedFor = ''
/** Sizes the plate in the 3D view to the chosen printer's build volume. */
export async function followBed(force = false) {
  const name = sl.settings.machine
  if (!name || resin.mode === 'resin' || (bedFor === name && !force)) return
  bedFor = name
  try {
    const b = await window.api.engine.machineBed(name)
    if (b && sl.settings.machine === name && (resin.mode as string) !== 'resin') setBed(b.x, b.y, b.z)
  } catch (err) {
    console.warn(`bed size for ${name}: ${cleanError(err)}`)
    bedFor = ''
  }
}

export function openPrinterEditor(edit: string | null = null) {
  sl.editor = { edit }
}

/** After the editor saves: show the new list and pick what was saved. */
export function useSaved(catalog: PresetCatalog, machine: string, process?: string, filament?: string) {
  sl.catalog = catalog
  sl.settings.machine = machine
  if (process) sl.settings.process = process
  if (filament) sl.settings.filament = filament
  ensureValidSelection()
  persist()
  void followBed(true)
}

export function setPreset(kind: 'process' | 'filament', name: string) {
  sl.settings[kind] = name
  persist()
}

export function setOverride<K extends keyof SliceOverrides>(key: K, value: SliceOverrides[K] | undefined) {
  if (value === undefined || (typeof value === 'number' && !Number.isFinite(value))) delete sl.settings.overrides[key]
  else sl.settings.overrides[key] = value
  persist()
}

/** Sets (or, with undefined, drops) one engine setting from the "All settings" window. */
export function setExtra(key: string, value: string | undefined) {
  const extra = { ...(sl.settings.overrides.extra ?? {}) }
  if (value === undefined) delete extra[key]
  else extra[key] = value
  if (Object.keys(extra).length) sl.settings.overrides.extra = extra
  else delete sl.settings.overrides.extra
  persist()
}

export function clearOverrides() {
  sl.settings.overrides = {}
  persist()
}

export async function installEngine() {
  sl.error = null
  const s = await window.api.engine.install()
  sl.engine = s
  if (s.error) sl.error = s.error
  else if (s.source) await loadCatalog()
}

export async function importFrom(source: ImportSource) {
  sl.importing = source
  sl.importNotes = []
  sl.error = null
  try {
    const r = await window.api.engine.importSettings(source)
    if (!r.ok) {
      sl.error = r.error ?? 'Import failed.'
      return
    }
    await loadCatalog()
    if (r.settings?.machine) sl.settings.machine = r.settings.machine
    if (r.settings?.process) sl.settings.process = r.settings.process
    if (r.settings?.filament) sl.settings.filament = r.settings.filament
    if (r.settings?.overrides) sl.settings.overrides = { ...r.settings.overrides }
    ensureValidSelection()
    const name = sl.candidates.find((c) => c.source === source)?.name ?? source
    sl.importNotes = [
      r.settings?.machine ? `Imported from ${name}: ${r.settings.machine}${r.importedPresets ? ` (${r.importedPresets} preset${r.importedPresets === 1 ? '' : 's'} copied)` : ''}.` : `Nothing to import from ${name}.`,
      ...r.notes,
    ]
  } catch (err) {
    sl.error = cleanError(err)
  } finally {
    sl.importing = null
  }
}

export function clearSlice() {
  sl.result = null
  sl.resultFor = null
  sl.stale = false
  sl.sendResult = null
  Object.assign(sl.preview, { loading: false, ready: false, on: false, layers: 0, layer: 0, layerZ: [], features: [] })
  getViewer()?.setPreview(null, featureColor)
}

export async function slice() {
  const meta = activeModel()
  const data = exportActive('stl')
  if (!meta || !data) return
  if (!sl.settings.machine || !sl.settings.process || !sl.settings.filament) {
    sl.error = 'Choose a printer, a process and a filament first.'
    return
  }
  clearSlice()
  sl.error = null
  sl.slicing = true
  sl.sliceStarted = Date.now()
  try {
    const res = await window.api.engine.slice({ name: meta.name, data, settings: $state.snapshot(sl.settings) })
    if (!res.ok) {
      sl.error = res.error ?? 'Slicing failed.'
      return
    }
    sl.result = res
    sl.resultFor = meta.id
    const bed = res.summary?.bed
    if (bed) {
      const xs = bed.map((p) => p[0])
      const ys = bed.map((p) => p[1])
      setBed(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), res.summary?.bedHeight ?? 250)
    }
    await showPreview()
  } catch (err) {
    sl.error = cleanError(err)
  } finally {
    sl.slicing = false
  }
}

export function cancelSlice() {
  window.api.engine.cancelSlice()
}

async function showPreview() {
  const r = sl.result
  const viewer = getViewer()
  if (!r?.ok || !r.jobId || !viewer) return
  sl.preview.loading = true
  try {
    const bytes = await window.api.engine.readGcode(r.jobId)
    const p = await parseGcodeInWorker(bytes)
    if (sl.result?.jobId !== r.jobId) return
    const bed = r.summary?.bed
    const center: [number, number] | undefined = bed
      ? [(Math.min(...bed.map((q) => q[0])) + Math.max(...bed.map((q) => q[0]))) / 2, (Math.min(...bed.map((q) => q[1])) + Math.max(...bed.map((q) => q[1]))) / 2]
      : undefined
    viewer.setPreview(p, featureColor, center)
    const counts = new Map<number, number>()
    for (const f of p.featureOf) counts.set(f, (counts.get(f) ?? 0) + 1)
    Object.assign(sl.preview, {
      ready: true,
      on: true,
      layers: p.layerEnds.length,
      layer: p.layerEnds.length,
      layerZ: [...p.layerZ],
      features: p.features
        .map((name, i) => ({ name, color: featureColor(name), count: counts.get(i) ?? 0 }))
        .filter((f) => f.count > 0)
        .sort((a, b) => b.count - a.count),
      travel: false,
    })
    await tick()
    requestAnimationFrame(() => viewer.view('iso'))
  } catch (err) {
    sl.error = `Couldn’t show the preview: ${cleanError(err)}`
  } finally {
    sl.preview.loading = false
  }
}

export function setPreviewOn(on: boolean) {
  sl.preview.on = on && sl.preview.ready
  getViewer()?.setPreviewVisible(sl.preview.on)
}

export function setPreviewLayer(n: number) {
  sl.preview.layer = Math.max(1, Math.min(sl.preview.layers, Math.round(n)))
  getViewer()?.setPreviewLayer(sl.preview.layer)
}

export function setPreviewTravel(on: boolean) {
  sl.preview.travel = on
  getViewer()?.setPreviewTravel(on)
}

/** History entry for the current FDM slice. */
function fdmHistory(how: 'saved' | 'sent' | 'usb', printer: string, path?: string) {
  const s = sl.result?.summary
  const o = sl.settings.overrides
  const parts = [o.layerHeight ? `${o.layerHeight} mm layers` : sl.settings.process, o.infill !== undefined ? `${o.infill}% infill` : '', sl.settings.filament]
  void recordPrint({
    name: activeModel()?.name ?? sl.result?.gcodeName ?? 'print',
    kind: 'fdm',
    how,
    printer,
    path,
    seconds: s?.printSeconds ?? null,
    grams: s?.filamentG ?? null,
    ml: null,
    cost: printCost('fdm', s?.filamentG ?? null, s?.printSeconds ?? null)?.total ?? null,
    settings: parts.filter(Boolean).join(' · '),
  })
}

/**
 * Saves the G-code. With a chosen folder it goes straight there; `ask` (or no folder yet) opens
 * the Save dialog, starting in that folder.
 */
export async function saveGcode(ask = false) {
  const id = sl.result?.jobId
  if (!id) {
    sl.error = 'Slice the model first, then save its G-code.'
    return
  }
  sl.error = null
  try {
    const r = await window.api.engine.saveGcode(id, sl.gcodeFolder && !ask ? 'folder' : 'dialog')
    if (r.ok && r.path) {
      fdmHistory('saved', sl.settings.machine, r.path)
      ws.notice = { text: `Saved ${r.path} and verified it on disk.` }
      sl.gcodeFolder = await window.api.engine.gcodeFolder()
    } else if (!r.canceled) sl.error = r.error ?? 'Saving the G-code failed.'
  } catch (err) {
    sl.error = `Saving the G-code failed: ${cleanError(err)}`
  }
}

/** Picks the folder G-code is saved to. */
export async function chooseGcodeFolder() {
  try {
    const dir = await window.api.engine.pickGcodeFolder()
    if (dir) sl.gcodeFolder = dir
  } catch (err) {
    sl.error = cleanError(err)
  }
}

export async function loadGcodeFolder() {
  sl.gcodeFolder = await window.api.engine.gcodeFolder().catch(() => null)
}

/** A short label for a folder: "E:\" stays as is, deeper folders show their last part. */
export function folderLabel(dir: string): string {
  if (/^[a-z]:\\?$/i.test(dir)) return dir.slice(0, 2) + '\\'
  return dir.split(/[\\/]/).filter(Boolean).pop() ?? dir
}

export function choosePrinter(id: string) {
  sl.printerId = id
  localStorage.setItem('birdy.printer', id)
}

export async function sendToPrinter() {
  const id = sl.result?.jobId
  const printer = sl.printers.find((p) => p.id === sl.printerId && isFdmKind(p.kind)) ?? sl.printers.find((p) => isFdmKind(p.kind))
  if (!id || !printer) return
  sl.sendResult = null
  if (printer.kind === 'serial') {
    // The port picker needs this click's user gesture, so it opens before the G-code is read.
    void startUsbPrint(() => window.api.engine.readGcode(id), sl.result?.gcodeName ?? 'print.gcode', printer.baudRate ?? 115200, () =>
      fdmHistory('usb', printer.name),
    )
    return
  }
  sl.sending = true
  try {
    sl.sendResult = await window.api.printers.send({ printerId: printer.id, jobId: id, startPrint: sl.startPrint })
    if (sl.sendResult.ok) fdmHistory('sent', printer.name)
  } catch (err) {
    sl.sendResult = { ok: false, detail: cleanError(err) }
  } finally {
    sl.sending = false
  }
}
