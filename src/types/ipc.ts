// Typed contract between the Electron main process and the trusted app UI.

export type ModelFormat = 'stl' | '3mf' | 'obj' | 'glb' | 'gltf' | 'ply'
export const MODEL_FORMATS: readonly ModelFormat[] = ['stl', '3mf', 'obj', 'glb', 'gltf', 'ply']
export type ExportFormat = 'stl' | 'obj'

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
  /** Set when identical content was already downloaded; the new copy is discarded. */
  duplicateOf: string | null
  error: string | null
  startedAt: number
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
} from './slicing'

export type AppShortcut = 'focus-address' | 'toggle-workspace' | 'open-model'

export type Unsubscribe = () => void

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
  }
  layout: {
    setWebBounds(rect: Rect): void
    setWebVisible(visible: boolean): void
  }
  downloads: {
    onUpdate(cb: (items: DownloadInfo[]) => void): Unsubscribe
    onModelReady(cb: (id: number) => void): Unsubscribe
    cancel(id: number): void
    retry(id: number): void
    showInFolder(id: number): void
    clear(): void
    readModel(id: number): Promise<ModelFile>
    openFolder(): void
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
  theme: {
    /** Restyles the new-tab page with the neon colour (#RRGGBB). */
    setAccent(hex: string): void
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
