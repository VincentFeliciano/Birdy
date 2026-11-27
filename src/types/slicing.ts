// Types shared by the slicing engine (main process) and the Slice panel (app UI).

export type PresetKind = 'machine' | 'process' | 'filament'

/** One preset the slicing engine knows: a built-in system preset or one imported from another slicer. */
export interface PresetRef {
  name: string
  vendor: string
  kind: PresetKind
  /** Imported from the user's own slicer settings rather than built in. */
  user?: boolean
  /** For an imported preset: the built-in preset it is based on. */
  base?: string
}

export interface PresetCatalog {
  vendors: string[]
  machines: PresetRef[]
  processes: PresetRef[]
  filaments: PresetRef[]
}

export type EngineSource = 'birdy' | 'installed' | 'dev'

export interface EngineState {
  /** Where the engine comes from, or null when none is available yet. */
  source: EngineSource | null
  path: string | null
  version: string
  installing: boolean
  progress: number | null
  error: string | null
  /** Download size of the engine Birdy can install, in bytes. */
  downloadSize: number
}

export type SupportMode = 'off' | 'normal' | 'tree'

/** The handful of settings people change most, applied on top of the chosen presets. */
export interface SliceOverrides {
  layerHeight?: number
  infill?: number
  walls?: number
  supports?: SupportMode
  brim?: boolean
  brimWidth?: number
  nozzleTemp?: number
  bedTemp?: number
}

export interface SliceSettings {
  machine: string
  process: string
  filament: string
  overrides: SliceOverrides
}

export interface SliceRequest {
  name: string
  /** Binary STL of the model as shown in the workspace. */
  data: Uint8Array
  settings: SliceSettings
}

export interface SliceSummary {
  printTime: string | null
  printSeconds: number | null
  filamentMm: number | null
  filamentG: number | null
  layers: number | null
  printerModel: string | null
  /** Printable area polygon in bed coordinates, from the G-code's config block. */
  bed: [number, number][] | null
  /** Printer's maximum print height (mm). */
  bedHeight: number | null
  /** Height of the sliced model (mm). */
  maxZ: number | null
}

export interface SliceResult {
  ok: boolean
  jobId?: string
  gcodeName?: string
  gcodeSize?: number
  summary?: SliceSummary
  error?: string
  log?: string
}

export interface SliceSaveResult {
  ok: boolean
  canceled?: boolean
  path?: string
  error?: string
}

export type ImportSource = 'orca' | 'bambu' | 'prusa' | 'cura'

export interface ImportCandidate {
  source: ImportSource
  name: string
  found: boolean
  detail: string
}

export interface ImportResult {
  ok: boolean
  source: ImportSource
  settings?: Partial<SliceSettings>
  importedPresets: number
  notes: string[]
  error?: string
}

export type PrinterKind = 'octoprint' | 'moonraker' | 'prusalink' | 'serial'

/** A printer as the UI sees it. Secrets never leave the main process. */
export interface PrinterInfo {
  id: string
  name: string
  kind: PrinterKind
  url?: string
  /** True when an API key or password is stored for it. */
  hasSecret: boolean
  username?: string
  baudRate?: number
}

export interface PrinterInput {
  id?: string
  name: string
  kind: PrinterKind
  url?: string
  /** New API key or password. Omit to keep the stored one; empty string clears it. */
  secret?: string
  username?: string
  baudRate?: number
}

export interface PrinterTestResult {
  ok: boolean
  detail: string
}

export interface SendRequest {
  printerId: string
  jobId: string
  startPrint: boolean
}

export type PrinterState = 'idle' | 'printing' | 'paused' | 'done' | 'error' | 'offline'

/** What a network printer is doing right now. */
export interface PrinterStatus {
  state: PrinterState
  /** Plain words from the printer, e.g. "Operational" or an error. */
  detail: string
  file: string | null
  /** 0..1 */
  progress: number | null
  /** Seconds printed so far and estimated to go. */
  elapsed: number | null
  remaining: number | null
  hotend: number | null
  hotendTarget: number | null
  bed: number | null
  bedTarget: number | null
  /** The printer has a webcam Birdy knows how to take a snapshot from. */
  camera: boolean
}

export interface SendResult {
  ok: boolean
  detail: string
}

export interface SerialPortChoice {
  portId: string
  portName: string
  displayName?: string
  vendorId?: string
  productId?: string
}
