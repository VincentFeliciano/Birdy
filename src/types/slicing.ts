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
  /** Made in Boaty (a custom printer or one Boaty ships), so it can be edited. */
  custom?: boolean
  /** A printer's safe maximum temperatures (°C), when known. */
  maxNozzle?: number
  maxBed?: number
  /** False for a printer without a heated bed. */
  heatedBed?: boolean
}

/** One preset to save from the printer editor. */
export interface CustomPresetInput {
  kind: PresetKind
  name: string
  /** The engine preset it starts from. */
  inherits: string
  /** Changed settings, engine keys to string values. */
  values: Record<string, string>
  maxNozzle?: number
  maxBed?: number
  heatedBed?: boolean
  /** Saving under a new name: the old one to remove. */
  replaces?: string
}

/** A saved custom preset, for editing. */
export interface CustomPresetData {
  kind: PresetKind
  name: string
  inherits: string
  values: Record<string, string>
  maxNozzle?: number
  maxBed?: number
  heatedBed?: boolean
}

/** Which presets to resolve; process and filament default to ones that fit the printer. */
export interface ResolveRequest {
  machine: string
  process?: string
  filament?: string
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
  /** Download size of the engine Boaty can install, in bytes. */
  downloadSize: number
}

export type SupportMode = 'off' | 'normal' | 'snug' | 'tree' | 'tree-slim' | 'tree-strong' | 'tree-hybrid' | 'organic'
export type BrimType = 'none' | 'outer' | 'inner' | 'both' | 'auto' | 'ears'
export type SkirtMode = 'off' | 'skirt' | 'shield'

/** The settings people change most, applied on top of the chosen presets. */
export interface SliceOverrides {
  layerHeight?: number
  infill?: number
  walls?: number
  supports?: SupportMode
  /** Supports only from the plate, never standing on the model. */
  supportsPlateOnly?: boolean
  /** Overhangs flatter than this angle (degrees from the horizontal) get supports. */
  supportAngle?: number
  /** Older on/off brim switch; `brimType` wins when both are set. */
  brim?: boolean
  brimType?: BrimType
  brimWidth?: number
  brimGap?: number
  skirt?: SkirtMode
  skirtLoops?: number
  skirtDistance?: number
  /** Skirt height in layers. */
  skirtHeight?: number
  raftLayers?: number
  /** One print speed for walls, infill, top surfaces, gap fill and supports, mm/s. The per-feature ones win over it. */
  speedAll?: number
  /** Print speeds, mm/s. */
  speedOuterWall?: number
  speedInnerWall?: number
  speedInfill?: number
  speedTop?: number
  speedFirstLayer?: number
  speedTravel?: number
  speedBridge?: number
  speedGapFill?: number
  speedSupport?: number
  speedSupportInterface?: number
  /** Small perimeters (holes, thin posts): mm/s, or a percentage of the outer wall speed like "50%". */
  speedSmallPerimeter?: string
  speedFirstLayerTravel?: number
  /** Slow down on overhangs, more the steeper they get. */
  slowOverhangs?: boolean
  /** Acceleration for all moves, mm/s². The per-move ones below win over it. */
  acceleration?: number
  accelOuterWall?: number
  accelInnerWall?: number
  accelTop?: number
  accelInfill?: number
  accelBridge?: number
  accelTravel?: number
  accelFirstLayer?: number
  /** Jerk for all moves, mm/s (Marlin, RepRapFirmware). 0 leaves the printer's own. */
  jerk?: number
  jerkOuterWall?: number
  jerkInnerWall?: number
  jerkTop?: number
  jerkInfill?: number
  jerkTravel?: number
  jerkFirstLayer?: number
  /** Marlin junction deviation, mm. Used instead of jerk when above 0. */
  junctionDeviation?: number
  /** Klipper: max_accel_to_decel as a % of the acceleration (smoother corners). 0 turns it off. */
  accelToDecel?: number
  /** Most plastic the hotend can melt, mm³/s; caps every speed. */
  maxFlow?: number
  /** Slow down on small layers so they cool. */
  coolingSlowdown?: boolean
  minLayerTime?: number
  minSpeed?: number
  /** Pressure advance (linear advance) factor. 0 turns it off. */
  pressureAdvance?: number
  nozzleTemp?: number
  bedTemp?: number
  /** Turns the part-cooling fan (and the side/aux fan) off for the whole print. */
  coolingOff?: boolean
  fanMin?: number
  fanMax?: number
  /** Fan stays off for this many first layers. */
  fanOffLayers?: number
  /** Fan reaches full speed by this layer. */
  fanFullLayer?: number
  /** Fan speed on overhangs and bridges, %. 0 turns the overhang boost off. */
  overhangFan?: number
  /** Auxiliary (side) part-cooling fan, %. */
  auxFan?: number
  /** Chamber exhaust fan during the print, %. */
  exhaustFan?: number
  /** Any other engine setting, by its OrcaSlicer key, as the engine writes it. */
  extra?: Record<string, string>
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

export type PrinterKind = 'octoprint' | 'moonraker' | 'prusalink' | 'serial' | 'elegoo' | 'flashforge'

/** Printers that take G-code (the rest are resin printers). */
export const isFdmKind = (k: PrinterKind) => k !== 'elegoo'

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
  /** The printer has a webcam Boaty knows how to take a snapshot from. */
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
