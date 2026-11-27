// Typed contract between the Electron main process and the trusted app UI.

export type ModelFormat = 'stl' | '3mf' | 'obj' | 'glb' | 'gltf' | 'ply' | 'wrl'
export const MODEL_FORMATS: readonly ModelFormat[] = ['stl', '3mf', 'obj', 'glb', 'gltf', 'ply', 'wrl']
export type ExportFormat = 'stl' | '3mf' | 'obj'
export const EXPORT_FORMATS: readonly ExportFormat[] = ['stl', '3mf', 'obj']

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface TabInfo {
  id: number
  title: string
  url: string
  favicon: string | null
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  isStartPage: boolean
}

export interface TabsState {
  tabs: TabInfo[]
  activeId: number | null
}

export type DownloadState = 'progressing' | 'completed' | 'cancelled' | 'interrupted'

export interface DownloadInfo {
  id: number
  filename: string
  url: string
  sourcePage: string
  received: number
  total: number
  state: DownloadState
  paused: boolean
  isModel: boolean
  /** A ZIP archive; its models are unpacked into the Models folder. */
  isArchive: boolean
  /** Where it went in the Models folder, once copied or unpacked. */
  imported: { rel: string; models: number; kind: 'file' | 'folder' } | null
  /** Why the ZIP could not be unpacked, or what was left out. */
  importNote: string | null
  /** Set when identical content was already downloaded; the new copy is discarded. */
  duplicateOf: string | null
  error: string | null
  startedAt: number
}

export interface ModelsEntry {
  name: string
  /** Path inside the Models folder, forward slashes. */
  rel: string
  kind: 'dir' | 'model'
  size: number
  mtime: number
  models?: number
}

export interface ModelsImport {
  kind: 'file' | 'folder'
  rel: string
  models: number
  openRel: string | null
  existing: boolean
  skipped: string[]
}

export interface ModelFile {
  name: string
  format: ModelFormat
  size: number
  data: Uint8Array
  sourceUrl?: string
  path?: string
}

export interface SaveRequest {
  suggestedName: string
  format: ExportFormat
  data: Uint8Array
}

export interface SaveResult {
  ok: boolean
  canceled?: boolean
  path?: string
  /** True when the written file was read back and matched byte for byte. */
  verified?: boolean
  error?: string
}

/** Search is Google, tuned for finding 3D models and assets by default. */
export type SearchType = 'models' | 'stl' | '3mf' | 'obj' | 'glb' | 'step' | 'assets' | 'web'

export const SEARCH_TYPES: readonly { id: SearchType; label: string; terms: string }[] = [
  { id: 'models', label: '3D models', terms: '3d model (stl OR 3mf OR obj) download' },
  { id: 'stl', label: 'STL', terms: 'stl file download' },
  { id: '3mf', label: '3MF', terms: '3mf file download' },
  { id: 'obj', label: 'OBJ', terms: 'obj 3d model download' },
  { id: 'glb', label: 'GLB / glTF', terms: '(glb OR gltf) 3d model download' },
  { id: 'step', label: 'STEP (CAD)', terms: '(step OR stp) cad file download' },
  { id: 'assets', label: 'Assets', terms: '3d assets (textures OR materials OR hdri OR models) free download' },
  { id: 'web', label: 'Web', terms: '' },
]

export function isSearchType(v: unknown): v is SearchType {
  return SEARCH_TYPES.some((t) => t.id === v)
}

export function buildSearchUrl(query: string, type: SearchType = 'models') {
  const terms = SEARCH_TYPES.find((t) => t.id === type)?.terms ?? ''
  const q = terms ? `${query.trim()} ${terms}` : query.trim()
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`
}

export type CheckVerdict = 'ready' | 'attention' | 'fail'

export interface Bookmark {
  id: string
  title: string
  url: string
  favicon: string | null
  group: string
  createdAt: number
}

export interface SavedModel {
  id: string
  name: string
  format: ModelFormat
  size: number
  path: string
  group: string
  sourceUrl?: string
  thumbnail?: string
  check?: { verdict: CheckVerdict; issues: number }
  savedAt: number
}

export interface LibraryData {
  groups: string[]
  bookmarks: Bookmark[]
  models: SavedModel[]
}

export interface NewBookmark {
  title: string
  url: string
  favicon: string | null
  group?: string
}

export interface NewLibraryModel {
  name: string
  data: Uint8Array
  group?: string
  sourceUrl?: string
  thumbnail?: string
  check?: { verdict: CheckVerdict; issues: number }
}

export interface SlicerInfo {
  id: string
  name: string
  path: string
  custom: boolean
}

export interface SlicersState {
  slicers: SlicerInfo[]
  defaultId: string | null
}

export interface SlicerHandoff {
  name: string
  data: Uint8Array
  slicerId?: string
}

export interface SlicerHandoffResult {
  ok: boolean
  path?: string
  slicer?: string
  error?: string
}

import type {
  EngineState,
  ImportCandidate,
  ImportResult,
  ImportSource,
  PresetCatalog,
  PrinterInfo,
  PrinterInput,
  PrinterTestResult,
  SendRequest,
  SendResult,
  SerialPortChoice,
  SliceRequest,
  SliceResult,
  SliceSaveResult,
  PrinterStatus,
} from './slicing'

export type AppShortcut = 'focus-address' | 'toggle-workspace' | 'open-model' | 'palette' | 'shortcuts'

export type Unsubscribe = () => void

export type UpdateStatus = 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'error' | 'unsupported'

/** A print Birdy saved or sent, as entered by the app. */
export interface HistoryInput {
  name: string
  kind: 'fdm' | 'resin'
  /** saved = file saved to disk, sent = uploaded to a network printer, usb = printed over a cable. */
  how: 'saved' | 'sent' | 'usb'
  printer: string
  path?: string
  seconds: number | null
  grams: number | null
  ml: number | null
  cost: number | null
  /** Short summary, e.g. "0.2 mm · 15% infill · PLA". */
  settings: string
  thumbnail?: string
}

export interface HistoryEntry extends HistoryInput {
  id: string
  at: number
  outcome: 'ok' | 'failed' | null
  note: string
}

export interface UpdateState {
  status: UpdateStatus
  /** Installed version. */
  current: string
  /** Version on offer (available, downloading, ready). */
  version?: string
  notes?: string
  /** 0..1 while downloading. */
  progress?: number
  bytesPerSecond?: number
  checkedAt?: number
  error?: string
}

export interface GetModelResult {
  ok: boolean
  /** files: went to the model's files list; hint: already there, the user presses the site's button. */
  action: 'files' | 'hint' | 'none'
  detail: string
}

export interface Api {
  tabs: {
    create(url?: string): void
    close(id: number): void
    activate(id: number): void
    navigate(input: string, searchType?: SearchType): void
    back(): void
    forward(): void
    reload(): void
    stop(): void
    home(): void
    onState(cb: (state: TabsState) => void): Unsubscribe
    /** On a model page (Thingiverse, Printables, MakerWorld): start getting its files. */
    getModel(): Promise<GetModelResult>
  }
  layout: {
    setWebBounds(rect: Rect): void
    setWebVisible(visible: boolean): void
  }
  downloads: {
    onUpdate(cb: (items: DownloadInfo[]) => void): Unsubscribe
    /** A model file dropped onto a website, read by main. */
    onModelDropped(cb: (file: ModelFile) => void): Unsubscribe
    onModelReady(cb: (id: number) => void): Unsubscribe
    cancel(id: number): void
    retry(id: number): void
    showInFolder(id: number): void
    clear(): void
    readModel(id: number): Promise<ModelFile>
    openFolder(): void
  }
  models: {
    list(rel: string): Promise<ModelsEntry[]>
    /** Models and folders anywhere in the Models folder whose name has every word of the query. */
    search(query: string): Promise<ModelsEntry[]>
    /** The entries that still exist, for saved favourites. */
    lookup(rels: string[]): Promise<ModelsEntry[]>
    read(rel: string): Promise<ModelFile>
    /** Shows a file in Explorer, or opens the folder ('' = the Models folder). */
    reveal(rel: string): void
    getThumb(rel: string): Promise<string | null>
    /** Copies models and unpacks ZIPs already in the Downloads folder. */
    importDownloads(): Promise<{ added: number; models: number; failed: number }>
    saveThumb(rel: string, dataUrl: string): void
    onChanged(cb: () => void): Unsubscribe
    onImported(cb: (r: ModelsImport) => void): Unsubscribe
  }
  files: {
    openModel(): Promise<ModelFile | null>
    saveModel(req: SaveRequest): Promise<SaveResult>
    reopenSaved(path: string): Promise<ModelFile>
  }
  library: {
    get(): Promise<LibraryData>
    onChange(cb: (d: LibraryData) => void): Unsubscribe
    addBookmark(b: NewBookmark): void
    removeBookmark(id: string): void
    addModel(m: NewLibraryModel): Promise<SavedModel>
    removeModel(id: string): void
    readModel(id: string): Promise<ModelFile>
    showModel(id: string): void
    move(kind: 'bookmark' | 'model', id: string, group: string): void
    createGroup(name: string): void
    renameGroup(from: string, to: string): void
    deleteGroup(name: string): void
  }
  updates: {
    get(): Promise<UpdateState>
    onState(cb: (s: UpdateState) => void): Unsubscribe
    check(): Promise<UpdateState>
    download(): Promise<UpdateState>
    /** Quits Birdy, installs the downloaded update and starts it again. */
    install(): void
  }
  theme: {
    /** Restyles the new-tab page with the neon colour (#RRGGBB). */
    setAccent(hex: string): void
  }
  history: {
    list(): Promise<HistoryEntry[]>
    add(e: HistoryInput): Promise<HistoryEntry>
    update(id: string, patch: { outcome?: 'ok' | 'failed' | null; note?: string }): Promise<void>
    remove(id: string): Promise<void>
    /** Shows the saved file in File Explorer; false when it is gone. */
    reveal(id: string): Promise<boolean>
    onChange(cb: (entries: HistoryEntry[]) => void): Unsubscribe
  }
  resin: {
    /** Save dialog for a sliced resin file, sent in pieces. */
    save(req: { suggestedName: string; parts: Uint8Array[] }): Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }>
    /** Uploads to an Elegoo printer over Wi-Fi (SDCP) and optionally starts printing. */
    send(req: { printerId: string; name: string; parts: Uint8Array[]; start: boolean }): Promise<SendResult>
    reveal(path: string): void
  }
  slicer: {
    list(): Promise<SlicersState>
    choose(): Promise<SlicersState>
    setDefault(id: string): void
    open(req: SlicerHandoff): Promise<SlicerHandoffResult>
  }
  engine: {
    get(): Promise<EngineState>
    onState(cb: (s: EngineState) => void): Unsubscribe
    install(): Promise<EngineState>
    cancelInstall(): void
    catalog(refresh?: boolean): Promise<PresetCatalog>
    slice(req: SliceRequest): Promise<SliceResult>
    cancelSlice(): void
    readGcode(jobId: string): Promise<Uint8Array>
    saveGcode(jobId: string): Promise<SliceSaveResult>
    importCandidates(): Promise<ImportCandidate[]>
    importSettings(source: ImportSource): Promise<ImportResult>
  }
  printers: {
    list(): Promise<PrinterInfo[]>
    save(p: PrinterInput): Promise<PrinterInfo[]>
    remove(id: string): Promise<PrinterInfo[]>
    test(id: string): Promise<PrinterTestResult>
    send(req: SendRequest): Promise<SendResult>
    status(id: string): Promise<PrinterStatus>
    /** A webcam still as a data URL, or null when there is none. */
    snapshot(id: string): Promise<string | null>
    /** Main asks the UI which serial port to use when the page calls navigator.serial.requestPort(). */
    onChoosePort(cb: (ports: SerialPortChoice[]) => void): Unsubscribe
    choosePort(portId: string | null): void
  }
  app: {
    onShortcut(cb: (s: AppShortcut) => void): Unsubscribe
  }
}

export function formatFromName(name: string): ModelFormat | null {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  return (MODEL_FORMATS as readonly string[]).includes(ext) ? (ext as ModelFormat) : null
}
