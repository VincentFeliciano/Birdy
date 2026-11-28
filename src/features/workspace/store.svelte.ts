import * as THREE from 'three'
import { tick } from 'svelte'
import { formatFromName, MODEL_FORMATS, type ExportFormat, type ModelFile, type ModelFormat } from '../../types/ipc'
import type { Projection, Tool, ViewPreset, Viewer } from '../../engine/three/viewer'
import { parseModel } from '../../engine/loaders/loadModel'
import { exportModel } from '../../engine/exporters/exportModel'
import { countMeshes, countTriangles, measure, type ModelStats } from '../../engine/geometry/stats'
import { runPrintCheck, worldTriangles } from '../../engine/geometry/runPrintCheck'
import { runRepair } from '../../engine/geometry/runRepair'
import { describeRepair } from '../../engine/geometry/repair'
import { defaultMaterial } from '../../engine/loaders/loadModel'
import type { BedSize, Issue, MarkKey, PrintMarks, PrintReport } from '../../engine/geometry/printCheck'
import { packRows } from '../../engine/geometry/arrange'
import { rankOrientations } from '../../engine/geometry/orient'
import { settle } from '../../engine/geometry/settle'
import { splitShells } from '../../engine/geometry/shells'
import { runCsg, runCsgInfo } from '../../engine/geometry/runCsg'
import type { ChopOptions } from '../../engine/geometry/chop'
import { smoothMesh } from '../../engine/geometry/smooth'
import type { BooleanOp } from '../../engine/geometry/csg'

function storedBed(): BedSize {
  try {
    const b = JSON.parse(localStorage.getItem('birdy.bed') ?? '') as BedSize
    if ([b.x, b.y, b.z].every((v) => Number.isFinite(v) && v > 10 && v < 2000)) return b
  } catch {
    /* default below */
  }
  return { x: 256, y: 256, z: 256 }
}

/** Build volume used by the plate and the print check: the last printer sliced for, else 256 mm. */
export const BED = $state<BedSize>(storedBed())

export type Layout = 'browse' | 'split' | 'workspace' | 'library'

export interface ModelMeta {
  id: string
  name: string
  format: ModelFormat
  size: number
  sourceUrl?: string
  originalPath?: string
  savedPath?: string
  modified: boolean
  libraryId?: string
}

export interface XForm {
  px: number
  py: number
  pz: number
  rx: number
  ry: number
  rz: number
  sx: number
  sy: number
  sz: number
}

const stored = (k: string, fallback: string) => localStorage.getItem(`birdy.${k}`) ?? fallback

/** Units sizes can be typed in, as mm per unit. */
export const SIZE_UNITS = { mm: 1, cm: 10, in: 25.4 } as const
export type SizeUnit = keyof typeof SIZE_UNITS

function loadSizeUnit(): SizeUnit {
  const u = typeof localStorage === 'undefined' ? null : localStorage.getItem('birdy.scaleUnit')
  return u === 'cm' || u === 'in' ? u : 'mm'
}

export function setSizeUnit(u: SizeUnit) {
  ws.sizeUnit = u
  localStorage.setItem('birdy.scaleUnit', u)
}

/** A size in mm, in the chosen unit, rounded for display (0.01 mm, 0.01 cm, 0.001 in). */
export function mmToUnit(mm: number, u: SizeUnit = ws.sizeUnit): number {
  const d = u === 'in' ? 1000 : 100
  return Math.round((mm / SIZE_UNITS[u]) * d) / d
}

/** Sets a real-life size typed in the chosen unit (2 in → 50.8 mm). */
export function setSizeIn(axis: 'x' | 'y' | 'z', value: number, uniform: boolean, u: SizeUnit = ws.sizeUnit) {
  setDimension(axis, value * SIZE_UNITS[u], uniform)
}

export const ws = $state({
  layout: 'browse' as Layout,
  ratio: Math.min(0.8, Math.max(0.2, Number(stored('ratio', '0.45')) || 0.45)),
  models: [] as ModelMeta[],
  activeId: null as string | null,
  tool: 'move' as Tool,
  /** Whether the active tool's options panel (beside the tool rail) is open. */
  // Closed until the user clicks a tool button (or presses its key); adding a model never opens it.
  toolPanel: false,
  /** Unit for typing real-life sizes (the model itself is always in mm). */
  sizeUnit: loadSizeUnit(),
  projection: 'perspective' as Projection,
  wireframe: false,
  bbox: true,
  grid: true,
  snap: false,
  sidebarOpen: stored('sidebar', '1') === '1',
  sidebarTab: 'model' as 'model' | 'transform' | 'slice',
  exportFormat: 'stl' as ExportFormat,
  loading: null as string | null,
  error: null as string | null,
  notice: null as { text: string; path?: string } | null,
  stats: null as ModelStats | null,
  xf: null as XForm | null,
  saving: false,
  report: null as PrintReport | null,
  checking: false,
  repairing: false,
  /** What the last repair or quick fix did, for the active model. */
  fixNote: null as string | null,
  /** The active model has a repair that can be undone. */
  canUndoRepair: false,
  /** Problem picked with Show: only its area is highlighted and the camera zooms to it. */
  markFocus: null as MarkKey | null,
  /** The active model's ignored issues (hidden from the check, kept so they can be shown again). */
  ignoredIssues: [] as Issue[],
  /** Models on the active tab's plate, and which one the transform tools act on. */
  parts: [] as { name: string; triangles: number; color?: string }[],
  /** The active model's edit and repair history, newest last. */
  history: [] as { label: string; note: string; at: number }[],
  selPart: 0,
  /** Show only the selected part in the 3D view. */
  isolate: false,
  /** A geometry edit in progress (shown on the buttons), and the last one that can be undone. */
  working: null as string | null,
  /** What Undo and Redo would undo or redo on the active model (moves, turns, sizes, edits). */
  undoLabel: null as string | null,
  redoLabel: null as string | null,
  /** Scaling keeps proportions: drags and typed sizes change all three axes together. */
  uniform: stored('uniform', '1') === '1',
})

export function remember() {
  localStorage.setItem('birdy.ratio', String(ws.ratio))
  localStorage.setItem('birdy.sidebar', ws.sidebarOpen ? '1' : '0')
}

// Three.js objects live outside reactive state so Svelte never proxies them.
interface Doc {
  /** The plate: a group that never moves, holding one wrapper per model on it. */
  wrapper: THREE.Group
  /** The part (model wrapper) the transform tools act on. */
  sel: THREE.Group
  /** Original file bytes, kept so the untouched original can be added to the library. */
  original: ModelFile
  warnings: string[]
  report: PrintReport | null
  /** Where the last check found problems, and the model transform it was measured at. */
  marks: { marks: PrintMarks; at: THREE.Matrix4 } | null
  triangles: number
  meshes: number
  initialZ: number
  /** Each part's mesh as loaded, kept while a repair is applied so it can be undone. */
  beforeRepair?: { parts: Map<THREE.Group, PartInfo & { children: THREE.Object3D[] }>; warnings: string[] }
  /** Earlier states of the plate for Undo (newest last), and undone ones for Redo. */
  undo?: Snap[]
  redo?: Snap[]
  /** What was done to this model, newest last: repairs and edits. */
  history: { label: string; note: string; at: number }[]
  fixNote: string | null
  /** Issue codes the user chose to ignore for this model. */
  ignored?: Set<string>
}
/** One step back: the parts on the plate, where each sat, and which was selected. */
interface Snap {
  label: string
  parts: THREE.Group[]
  sel: THREE.Group
  xf: [THREE.Vector3, THREE.Quaternion, THREE.Vector3][]
  /** A change to the geometry (merge, cut…), as opposed to a move, turn or resize. */
  geometry: boolean
  at: number
}
/** What each part wrapper keeps in userData. */
interface PartInfo {
  name: string
  initialZ: number
  triangles: number
  meshes: number
  /** Colour picked for this part (#rrggbb); saved into 3MF files. */
  color?: string
}
const info = (part: THREE.Object3D) => part.userData as PartInfo
// A copy, so callers can add and remove parts while walking the list.
const partsOf = (doc: Doc) => [...doc.wrapper.children] as THREE.Group[]

const docs = new Map<string, Doc>()
let viewer: Viewer | null = null
export const getViewer = () => viewer

type ModelChange = 'switch' | 'edit'
const modelListeners = new Set<(change: ModelChange) => void>()
const modelListener = { call: (c: ModelChange) => modelListeners.forEach((fn) => fn(c)) }
/** Lets the slicing panels drop or mark stale their previews when the model changes. */
export function onModelChange(fn: (change: ModelChange) => void) {
  modelListeners.add(fn)
  return () => modelListeners.delete(fn)
}

/** Sets the build volume to a printer's (mm) and re-checks the model against it. */
export function setBed(x: number, y: number, z: number) {
  if (![x, y, z].every((v) => Number.isFinite(v) && v > 10 && v < 2000)) return
  if (BED.x === x && BED.y === y && BED.z === z) return
  BED.x = x
  BED.y = y
  BED.z = z
  localStorage.setItem('birdy.bed', JSON.stringify({ x, y, z }))
  viewer?.setBedSize(x, y)
  scheduleCheck(0)
}

export const activeModel = () => ws.models.find((m) => m.id === ws.activeId) ?? null
const activeDoc = () => (ws.activeId ? docs.get(ws.activeId) : undefined)

export function attachViewer(v: Viewer | null) {
  viewer = v
  if (!v) return
  v.setBedSize(BED.x, BED.y)
  v.onTransformStart = () => {
    const doc = activeDoc()
    if (doc) pushUndo(doc, ws.tool === 'rotate' ? 'Rotate' : ws.tool === 'scale' ? 'Resize' : 'Move')
  }
  v.uniformScale = ws.uniform
  v.onTransform = (live) => {
    markModified()
    if (!live) modelListener.call('edit')
    refresh(!live)
    if (!live) scheduleCheck()
  }
  v.setTool(ws.tool)
  v.setShowBBox(ws.bbox)
  v.setShowGrid(ws.grid)
  v.setSnapping(ws.snap)
  v.onPick = (part) => {
    const doc = activeDoc()
    const i = doc ? partsOf(doc).indexOf(part as THREE.Group) : -1
    if (i >= 0) selectPart(i)
  }
  const doc = activeDoc()
  if (doc) {
    v.setModel(doc.wrapper, doc.sel)
    v.view('iso')
    showMarks(false)
  }
}

/** Mirrors the plate's parts into reactive state for the sidebar. */
function syncParts(doc: Doc | undefined) {
  if (!doc) {
    ws.parts = []
    ws.selPart = 0
    return
  }
  const parts = partsOf(doc)
  // Picked colours survive repairs and edits that rebuild a part's mesh.
  for (const p of parts) if (info(p).color) paintPart(p, info(p).color!)
  ws.parts = parts.map((p) => ({ name: info(p).name, triangles: info(p).triangles, color: info(p).color }))
  ws.history = [...doc.history]
  ws.selPart = Math.max(0, parts.indexOf(doc.sel))
  doc.triangles = parts.reduce((n, p) => n + info(p).triangles, 0)
  doc.meshes = parts.reduce((n, p) => n + info(p).meshes, 0)
}

function refresh(precise = true) {
  const doc = activeDoc()
  if (!doc) {
    ws.stats = null
    ws.xf = null
    return
  }
  const w = doc.sel
  const deg = THREE.MathUtils.radToDeg
  ws.xf = {
    px: w.position.x,
    py: w.position.y,
    pz: w.position.z,
    rx: deg(w.rotation.x),
    ry: deg(w.rotation.y),
    rz: deg(w.rotation.z),
    sx: w.scale.x * 100,
    sy: w.scale.y * 100,
    sz: w.scale.z * 100,
  }
  ws.stats = measure(w, info(w).triangles, info(w).meshes, precise)
}

let checkTimer: ReturnType<typeof setTimeout> | null = null
let checkSeq = 0

/** Re-runs the print check shortly after the model or its transform changes. */
function scheduleCheck(delay = 350) {
  if (checkTimer) clearTimeout(checkTimer)
  checkTimer = setTimeout(checkNow, delay)
}

export async function checkNow() {
  const id = ws.activeId
  const doc = id ? docs.get(id) : undefined
  if (!doc || !id) return
  const seq = ++checkSeq
  ws.checking = true
  try {
    doc.wrapper.updateMatrixWorld(true)
    const at = doc.wrapper.matrixWorld.clone()
    // Resin prints finer walls than filament.
    const minWall = localStorage.getItem('birdy.sliceMode') === 'resin' ? 0.4 : 0.8
    const { marks, ...report } = await runPrintCheck(doc.wrapper, { x: BED.x, y: BED.y, z: BED.z }, doc.warnings, minWall)
    // The highlight buffers stay out of reactive state; Svelte would proxy them.
    doc.report = report
    doc.marks = marks ? { marks, at } : null
    if (seq === checkSeq && ws.activeId === id) {
      setActiveReport(doc)
      if (ws.markFocus && !report.issues.some((i) => i.mark === ws.markFocus)) ws.markFocus = null
      showMarks(false)
    }
  } catch (err) {
    if (seq === checkSeq) ws.error = `Print check failed: ${(err as Error).message}`
  } finally {
    if (seq === checkSeq) ws.checking = false
  }
}

/**
 * A report without the issues the user ignored, its verdict worked out again from what is left.
 */
export function withoutIgnored(report: PrintReport, ignored: Set<string> | undefined): PrintReport {
  if (!ignored?.size) return report
  const issues = report.issues.filter((i) => !ignored.has(i.code))
  const verdict = issues.some((i) => i.level === 'error') ? 'fail' : issues.some((i) => i.level === 'warn') ? 'attention' : 'ready'
  return { ...report, issues, verdict }
}

function setActiveReport(doc: Doc) {
  ws.report = doc.report ? withoutIgnored(doc.report, doc.ignored) : null
  ws.ignoredIssues = doc.report?.issues.filter((i) => doc.ignored?.has(i.code)) ?? []
}

/** Hides an issue for this model (it no longer counts toward the verdict or lights up the model). */
export function ignoreIssue(code: string) {
  const doc = activeDoc()
  if (!doc) return
  ;(doc.ignored ??= new Set()).add(code)
  const mark = doc.report?.issues.find((i) => i.code === code)?.mark
  if (mark && ws.markFocus === mark) ws.markFocus = null
  setActiveReport(doc)
  showMarks(false)
}

/** Shows ignored issues again. */
export function unignoreIssues() {
  const doc = activeDoc()
  if (!doc) return
  doc.ignored = undefined
  setActiveReport(doc)
  showMarks(false)
}

/** Draws the active model's problem areas; with a focus, only that one, zoomed to. */
function showMarks(zoom: boolean) {
  const doc = activeDoc()
  let marks = doc?.marks?.marks ?? null
  if (marks && doc?.ignored?.size) {
    // Ignored problems stop lighting up the model.
    const hidden = new Set<MarkKey>(doc.report?.issues.filter((i) => i.mark && doc.ignored!.has(i.code)).map((i) => i.mark!))
    // Hole rings belong to the open edges.
    if (hidden.has('openEdges')) hidden.add('holeCenters')
    if (hidden.size) marks = Object.fromEntries(Object.entries(marks).filter(([k]) => !hidden.has(k as MarkKey))) as PrintMarks
  }
  viewer?.setMarks(marks, doc?.marks?.at ?? null, ws.markFocus, zoom)
}

/** Show button on an issue: highlight just that problem and zoom to it; again to go back. */
export function focusMark(key: MarkKey | null) {
  ws.markFocus = ws.markFocus === key ? null : key
  showMarks(!!ws.markFocus)
}

export function getReport(id: string) {
  const doc = docs.get(id)
  return doc?.report ? withoutIgnored(doc.report, doc.ignored) : null
}

function markModified() {
  const m = activeModel()
  if (m) m.modified = true
}

/**
 * Wraps the loaded object so its pivot sits at the geometric centre and the model rests
 * on the plate. Geometry is never modified; only the wrapper's transform changes.
 */
function wrap(obj: THREE.Object3D, name: string) {
  obj.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(obj, true)
  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())
  obj.position.sub(center)
  const wrapper = new THREE.Group()
  wrapper.add(obj)
  wrapper.position.set(0, 0, size.z / 2)
  const pi: PartInfo = { name, initialZ: size.z / 2, triangles: countTriangles(obj), meshes: countMeshes(obj) }
  wrapper.userData = pi
  return { wrapper, initialZ: size.z / 2 }
}

export async function openModelFile(file: ModelFile) {
  ws.error = null
  ws.notice = null
  ws.loading = `Opening ${file.name}`
  if (ws.layout === 'browse') ws.layout = 'split'
  // Let the loading state paint before parsing blocks the thread.
  await new Promise((r) => setTimeout(r, 30))
  try {
    const { root: obj, warnings } = await parseModel(file)
    const plate = new THREE.Group()
    // A 3MF with several objects (a saved plate) opens as that many parts, where they were.
    const objects = file.format === '3mf' ? obj.children.filter((c) => countTriangles(c) > 0) : []
    let part: THREE.Group
    let initialZ: number
    if (objects.length > 1 && objects.length <= 200) {
      obj.updateMatrixWorld(true)
      const all = new THREE.Box3().setFromObject(obj, true)
      const mid = all.getCenter(new THREE.Vector3())
      const parts = objects.map((child, i) => {
        const box = new THREE.Box3().setFromObject(child, true)
        const c = box.getCenter(new THREE.Vector3())
        child.matrixWorld.decompose(child.position, child.quaternion, child.scale)
        child.removeFromParent()
        const w = wrap(child, child.name || `${file.name} ${i + 1}`)
        w.wrapper.position.set(c.x - mid.x, c.y - mid.y, c.z - all.min.z)
        plate.add(w.wrapper)
        return w
      })
      part = parts[0]!.wrapper
      initialZ = parts[0]!.initialZ
    } else {
      ;({ wrapper: part, initialZ } = wrap(obj, file.name))
      plate.add(part)
    }
    const id = crypto.randomUUID()
    docs.set(id, {
      history: [],
      wrapper: plate,
      sel: part,
      initialZ,
      original: file,
      warnings,
      report: null,
      marks: null,
      fixNote: null,
      triangles: countTriangles(plate),
      meshes: countMeshes(plate),
    })
    ws.models.push({
      id,
      name: file.name,
      format: file.format,
      size: file.size,
      sourceUrl: file.sourceUrl,
      originalPath: file.path,
      modified: false,
    })
    activate(id, true)
  } catch (err) {
    ws.error = `Couldn't open ${file.name}: ${(err as Error).message}`
  } finally {
    ws.loading = null
  }
}

export function activate(id: string, frame = false) {
  if (ws.isolate) setIsolate(false)
  const doc = docs.get(id)
  if (!doc) return
  ws.undoLabel = doc.undo?.at(-1)?.label ?? null
  ws.redoLabel = doc.redo?.at(-1)?.label ?? null
  if (ws.activeId !== id) modelListener.call('switch')
  ws.activeId = id
  setActiveReport(doc)
  ws.markFocus = null
  ws.fixNote = doc.fixNote
  ws.canUndoRepair = !!doc.beforeRepair
  if (!doc.report) scheduleCheck(0)
  viewer?.setModel(doc.wrapper, doc.sel)
  viewer?.setWireframe(ws.wireframe)
  syncParts(doc)
  showMarks(false)
  refresh()
  // Frame after the DOM settles (the sidebar may appear and narrow the viewport).
  if (frame) void tick().then(() => requestAnimationFrame(() => viewer?.view('iso')))
}

export function closeModel(id: string) {
  const doc = docs.get(id)
  if (!doc) return
  const idx = ws.models.findIndex((m) => m.id === id)
  if (ws.activeId === id) modelListener.call('switch')
  ws.models.splice(idx, 1)
  docs.delete(id)
  disposeTree(doc.wrapper)
  for (const b of doc.beforeRepair?.parts.values() ?? []) for (const c of b.children) disposeTree(c)
  if (ws.activeId === id) {
    const next = ws.models[Math.min(idx, ws.models.length - 1)]
    if (next) activate(next.id)
    else {
      ws.activeId = null
      ws.report = null
      ws.ignoredIssues = []
      ws.markFocus = null
      viewer?.setModel(null)
      viewer?.setMarks(null, null, null, false)
      syncParts(undefined)
      refresh()
    }
  }
}

export async function openFromDialog() {
  try {
    const file = await window.api.files.openModel()
    if (file) await openModelFile(file)
  } catch (err) {
    ws.error = (err as Error).message
  }
}

export async function openFromDownload(id: number) {
  try {
    await openModelFile(await window.api.downloads.readModel(id))
  } catch (err) {
    ws.error = (err as Error).message
  }
}

/** Files dropped anywhere in Boaty: opens each model, explains anything else. */
export async function openDroppedFiles(files: File[]) {
  const bad: string[] = []
  let opened = 0
  for (const f of files) {
    const format = formatFromName(f.name)
    if (!format) {
      bad.push(f.name)
      continue
    }
    if (!opened++ && (ws.layout === 'browse' || ws.layout === 'library')) ws.layout = 'workspace'
    await openDroppedFile(f, format)
  }
  if (bad.length) ws.error = `${bad.join(', ')} ${bad.length > 1 ? "aren't" : "isn't a"} supported model${bad.length > 1 ? 's' : ''}. Drop ${MODEL_FORMATS.map((x) => x.toUpperCase()).join(', ')}.`
}

export async function openDroppedFile(f: File, format: ModelFormat) {
  if (f.size > 512 * 1024 * 1024) {
    ws.error = `${f.name} is too large to open (limit 512 MB).`
    return
  }
  await openModelFile({ name: f.name, format, size: f.size, data: new Uint8Array(await f.arrayBuffer()) })
}

/**
 * Picks a tool and opens its options panel. Picking the tool that is already active toggles the
 * panel instead; the tool itself stays active.
 */
export function setTool(t: Tool) {
  if (ws.tool === t && t !== 'select') {
    ws.toolPanel = !ws.toolPanel
    return
  }
  ws.tool = t
  ws.toolPanel = true
  viewer?.setTool(t)
}

export const setView = (p: ViewPreset) => viewer?.view(p)
export const fit = () => viewer?.fit()

export function setProjection(p: Projection) {
  ws.projection = p
  viewer?.setProjection(p)
}

export function toggle(key: 'wireframe' | 'bbox' | 'grid' | 'snap') {
  ws[key] = !ws[key]
  if (key === 'wireframe') viewer?.setWireframe(ws.wireframe)
  if (key === 'bbox') viewer?.setShowBBox(ws.bbox)
  if (key === 'grid') viewer?.setShowGrid(ws.grid)
  if (key === 'snap') viewer?.setSnapping(ws.snap)
}

function apply(fn: (w: THREE.Group, doc: Doc) => void, label = 'Change') {
  const doc = activeDoc()
  if (!doc) return
  pushUndo(doc, label, true)
  fn(doc.sel, doc)
  doc.wrapper.updateMatrixWorld(true)
  markModified()
  modelListener.call('edit')
  viewer?.changed()
  refresh()
  scheduleCheck()
}

export function setXForm(key: keyof XForm, value: number, uniform = ws.uniform) {
  if (!Number.isFinite(value)) return
  apply((w) => {
    const rad = THREE.MathUtils.degToRad
    if (key === 'px') w.position.x = value
    else if (key === 'py') w.position.y = value
    else if (key === 'pz') w.position.z = value
    else if (key === 'rx') w.rotation.x = rad(value)
    else if (key === 'ry') w.rotation.y = rad(value)
    else if (key === 'rz') w.rotation.z = rad(value)
    else {
      if (Math.abs(value) < 0.1) return
      const axis = key[1] as 'x' | 'y' | 'z'
      const next = value / 100
      if (uniform) {
        // Keep proportions (and any mirroring) while changing overall size.
        w.scale.multiplyScalar(Math.abs(next / w.scale[axis]))
      } else w.scale[axis] = next
    }
  }, key[0] === 'p' ? 'Move' : key[0] === 'r' ? 'Rotate' : 'Resize')
}

export function setDimension(axis: 'x' | 'y' | 'z', mm: number, uniform: boolean) {
  const current = ws.stats?.size[axis]
  if (!current || !Number.isFinite(mm) || mm <= 0) return
  const f = mm / current
  apply((w) => {
    if (uniform) w.scale.multiplyScalar(f)
    else w.scale[axis] *= f
  }, 'Resize')
}

/** Scaling keeps proportions or not, for drags and typed sizes alike. */
export function setUniform(on: boolean) {
  ws.uniform = on
  localStorage.setItem('birdy.uniform', on ? '1' : '0')
  if (viewer) viewer.uniformScale = on
}

/** Grows or shrinks the selected part by a percentage, keeping it where it stands on the plate. */
export function scaleBy(percent: number) {
  if (!Number.isFinite(percent) || percent <= 0 || percent === 100) return
  apply((w) => {
    w.updateMatrixWorld(true)
    const before = new THREE.Box3().setFromObject(w, true)
    const c = before.getCenter(new THREE.Vector3())
    w.scale.multiplyScalar(percent / 100)
    w.updateMatrixWorld(true)
    const after = new THREE.Box3().setFromObject(w, true)
    const c2 = after.getCenter(new THREE.Vector3())
    w.position.x += c.x - c2.x
    w.position.y += c.y - c2.y
    w.position.z += before.min.z - after.min.z
  }, 'Resize')
}

/** Sets the selected part's size as a percentage of its loaded size (all axes). */
export function scaleTo(percent: number) {
  const doc = activeDoc()
  if (!doc || !Number.isFinite(percent) || percent <= 0) return
  const now = Math.abs(doc.sel.scale.x) * 100
  if (now > 0) scaleBy((percent / now) * 100)
}

/** Turns the selected part about a world axis through its centre, then stands it back on the plate. */
export function rotateBy(axis: 'x' | 'y' | 'z', degrees: number) {
  if (!Number.isFinite(degrees) || !degrees) return
  apply((w) => {
    w.updateMatrixWorld(true)
    const before = new THREE.Box3().setFromObject(w, true)
    const c = before.getCenter(new THREE.Vector3())
    const v = new THREE.Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0)
    w.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(v, THREE.MathUtils.degToRad(degrees)))
    w.updateMatrixWorld(true)
    const after = new THREE.Box3().setFromObject(w, true)
    const c2 = after.getCenter(new THREE.Vector3())
    w.position.x += c.x - c2.x
    w.position.y += c.y - c2.y
    w.position.z += before.min.z - after.min.z
  }, 'Rotate')
}

/** Moves the selected part by an offset (mm). */
export function moveBy(dx: number, dy: number, dz: number) {
  apply((w) => {
    w.position.x += dx
    w.position.y += dy
    w.position.z += dz
  }, 'Move')
}

export function mirror(axis: 'x' | 'y' | 'z') {
  apply((w) => {
    w.scale[axis] *= -1
  }, 'Mirror')
}

export function dropToBed() {
  apply((w) => {
    const box = new THREE.Box3().setFromObject(w, true)
    w.position.z -= box.min.z
  }, 'Drop to plate')
}

/** Scales the model down (or up) to fit the plate with a small margin, then centres and drops it. */
export function fitToBed() {
  apply((w) => {
    const size = new THREE.Box3().setFromObject(w, true).getSize(new THREE.Vector3())
    const f = Math.min(BED.x / size.x, BED.y / size.y, BED.z / size.z) * 0.95
    if (Number.isFinite(f) && f > 0) w.scale.multiplyScalar(f)
    placeOnBed(w)
  }, 'Scale to fit')
  setFixNote('Scaled to fit the plate.')
}

/** Rescales a model exported in other units (cm, inches, metres) to millimetres. */
export function convertUnits(factor: number) {
  apply((w) => {
    w.scale.multiplyScalar(factor)
    placeOnBed(w)
  }, 'Change units')
  setFixNote(`Scaled by ${factor}×.`)
}

function placeOnBed(w: THREE.Group) {
  w.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(w, true)
  const c = box.getCenter(new THREE.Vector3())
  w.position.x -= c.x
  w.position.y -= c.y
  w.position.z -= box.min.z
}

function paintPart(part: THREE.Object3D, color: string) {
  part.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      const c = (mat as THREE.MeshStandardMaterial).color
      if (c && '#' + c.getHexString() !== color.toLowerCase()) c.set(color)
    }
  })
}

/** Records an edit or repair in the model's history (shown in the Modify panel). */
function logHistory(doc: Doc, label: string, note: string) {
  doc.history.push({ label, note, at: Date.now() })
  if (doc.history.length > 50) doc.history.shift()
  if (docs.get(ws.activeId ?? '') === doc) ws.history = [...doc.history]
}

/** Colours the selected part (null puts the default back). */
export function setPartColor(color: string | null) {
  const doc = activeDoc()
  if (!doc) return
  const part = doc.sel
  if (color && !/^#[0-9a-f]{6}$/i.test(color)) return
  if (color) {
    // Its own material, so other parts keep theirs.
    part.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh && !Array.isArray(m.material)) m.material = m.material.clone()
    })
    info(part).color = color
    paintPart(part, color)
  } else {
    delete info(part).color
    part.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh) m.material = defaultMaterial()
    })
  }
  markModified()
  syncParts(doc)
  viewer?.changed()
}

/**
 * Lines every other part up with the selected one along an axis: its low side, middle or high side.
 * Z 'min' stands them all on the plate.
 */
export function alignParts(axis: 'x' | 'y' | 'z', to: 'min' | 'mid' | 'max') {
  const doc = activeDoc()
  if (!doc) return
  pushUndo(doc, 'Line up')
  doc.wrapper.updateMatrixWorld(true)
  const ref = new THREE.Box3().setFromObject(doc.sel, true)
  const target = to === 'min' ? ref.min[axis] : to === 'max' ? ref.max[axis] : (ref.min[axis] + ref.max[axis]) / 2
  let moved = 0
  for (const p of partsOf(doc)) {
    if (p === doc.sel) continue
    const b = new THREE.Box3().setFromObject(p, true)
    const at = to === 'min' ? b.min[axis] : to === 'max' ? b.max[axis] : (b.min[axis] + b.max[axis]) / 2
    // World and plate axes match (the plate group isn't rotated), so the shift applies directly.
    p.position[axis] += target - at
    moved++
  }
  if (!moved) return setFixNote('Add another model to the plate to line them up.')
  afterPlateChange(doc)
  const side = axis === 'z' ? (to === 'min' ? 'bottoms' : to === 'max' ? 'tops' : 'middles') : to === 'min' ? `${axis.toUpperCase()} low sides` : to === 'max' ? `${axis.toUpperCase()} high sides` : `${axis.toUpperCase()} centres`
  setFixNote(`Lined up the ${side} of ${moved} model${moved === 1 ? '' : 's'} with the selected one.`)
}

export type ShapeKind = 'box' | 'cylinder' | 'sphere' | 'cone' | 'torus' | 'pyramid' | 'tube'

/** A basic shape `size` mm across, standing on the plate (beside what's there). */
export async function addShape(kind: ShapeKind, size: number) {
  const s = Math.max(1, Math.min(1000, size))
  let g: THREE.BufferGeometry
  if (kind === 'box') g = new THREE.BoxGeometry(s, s, s)
  else if (kind === 'cylinder') g = new THREE.CylinderGeometry(s / 2, s / 2, s, 64).rotateX(Math.PI / 2)
  else if (kind === 'sphere') g = new THREE.SphereGeometry(s / 2, 64, 32)
  else if (kind === 'cone') g = new THREE.ConeGeometry(s / 2, s, 64).rotateX(Math.PI / 2)
  else if (kind === 'pyramid') g = new THREE.ConeGeometry(s / Math.SQRT2, s, 4).rotateY(Math.PI / 4).rotateX(Math.PI / 2)
  else if (kind === 'torus') g = new THREE.TorusGeometry(s * 0.35, s * 0.15, 32, 96)
  else {
    // A tube: a ring cross-section turned around the Z axis.
    const r = s / 2, wall = Math.max(0.8, s * 0.12)
    g = new THREE.LatheGeometry([new THREE.Vector2(r - wall, 0), new THREE.Vector2(r, 0), new THREE.Vector2(r, s), new THREE.Vector2(r - wall, s), new THREE.Vector2(r - wall, 0)], 96).rotateX(Math.PI / 2)
  }
  const name = kind[0]!.toUpperCase() + kind.slice(1)
  const tris = new Float32Array((g.index ? g.toNonIndexed() : g).getAttribute('position').array)
  g.dispose()
  const doc = activeDoc()
  if (!doc) {
    // No model open: the shape becomes a new model of its own.
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(tris, 3))
    const data = exportModel(new THREE.Mesh(geo), 'stl')
    geo.dispose()
    return openModelFile({ name: `${name}.stl`, format: 'stl', size: data.byteLength, data })
  }
  const part = partFromTriangles(tris, `${name} ${s} mm`, defaultMaterial())
  pushUndo(doc, 'Add shape')
  placeBeside(doc, part)
  doc.wrapper.add(part)
  doc.sel = part
  afterPlateChange(doc)
  logHistory(doc, 'Add shape', `Added a ${s} mm ${kind}.`)
}

export interface TextRequest {
  text: string
  font: string
  bold: boolean
  size: number
  depth: number
  place: 'top' | 'front'
  mode: 'emboss' | 'engrave' | 'separate'
}

/** Raises text from, or cuts it into, the top or front of the selected part; or adds it as its own part. */
export function writeTextOnPart(req: TextRequest) {
  const label = req.mode === 'emboss' ? 'Emboss text' : req.mode === 'engrave' ? 'Engrave text' : 'Add text'
  return edit(label, async (doc) => {
    const part = doc.sel
    const [out] = await runCsg({ op: 'text', solid: tris(part), options: req })
    const quoted = `“${req.text.length > 24 ? req.text.slice(0, 24) + '…' : req.text}”`
    if (req.mode === 'separate') {
      const t = partFromTriangles(out!, `Text ${quoted}`, materialOf(part))
      replaceParts(doc, [], [t], label)
      placeOnBed(t)
      afterPlateChange(doc)
      return `Added ${quoted} as its own part, ${req.depth} mm thick.`
    }
    replaceParts(doc, [part], [partFromTriangles(out!, info(part).name, materialOf(part))], label)
    return `${req.mode === 'emboss' ? 'Raised' : 'Cut'} ${quoted} ${req.depth} mm ${req.mode === 'emboss' ? 'from' : 'into'} the ${req.place} of the model.`
  })
}

function setFixNote(text: string | null) {
  const doc = activeDoc()
  if (doc) doc.fixNote = text
  ws.fixNote = text
}

function disposeTree(root: THREE.Object3D) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.geometry.dispose()
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) m.dispose()
  })
}

/**
 * Repairs the mesh (holes, flipped and inside-out faces, cracks, junk triangles) in a worker and
 * swaps the result in. The file on disk is never touched, and the repair can be undone.
 */
export async function repairActive() {
  const id = ws.activeId
  const doc = activeDoc()
  if (!doc || !id || ws.repairing) return
  ws.repairing = true
  ws.error = null
  try {
    const notes: string[] = []
    const before = doc.beforeRepair ?? { parts: new Map(), warnings: doc.warnings }
    // Each model on the plate is repaired on its own, so they stay separate parts.
    for (const part of [...partsOf(doc)]) {
      // Repair in world space (so a mirrored model's faces end up facing out), then map back.
      part.updateMatrixWorld(true)
      const { positions } = worldTriangles(part)
      if (!positions.length) continue
      const { positions: fixed, summary } = await runRepair(positions)
      if (!docs.has(id) || part.parent !== doc.wrapper) return
      part.updateMatrixWorld(true)
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(fixed, 3))
      geo.applyMatrix4(part.matrixWorld.clone().invert())
      geo.computeVertexNormals()
      const mesh = new THREE.Mesh(geo, defaultMaterial())
      mesh.name = 'repaired'
      const old = [...part.children]
      if (before.parts.has(part)) for (const c of old) disposeTree(c)
      else before.parts.set(part, { ...info(part), children: old })
      for (const c of old) part.remove(c)
      part.add(mesh)
      info(part).triangles = summary.trianglesAfter
      info(part).meshes = 1
      notes.push(describeRepair(summary))
    }
    const names = partsOf(doc).map((p) => info(p).name)
    doc.beforeRepair = before
    // The repaired mesh stands on its own; warnings about the file it came from no longer apply.
    doc.warnings = []
    // One note when every model came out the same; otherwise one per model.
    doc.fixNote =
      notes.length < 2 || notes.every((n) => n === notes[0])
        ? (notes.length > 1 ? `All ${notes.length} models: ` : '') + (notes[0] ?? '')
        : notes.map((n, i) => `${names[i]}: ${n}`).join(' ')
    logHistory(doc, 'Repair', doc.fixNote || 'Repaired.')
    // The repair has its own Undo; steps from before it can no longer be undone without losing the repair.
    clearUndo(doc)
    if (ws.activeId === id) {
      ws.fixNote = doc.fixNote
      ws.canUndoRepair = true
    }
    afterGeometryChange(doc)
  } catch (err) {
    ws.error = `Repair failed: ${(err as Error).message}`
  } finally {
    ws.repairing = false
  }
}

/** Puts back each model's mesh as it was loaded. */
export function undoRepair() {
  const doc = activeDoc()
  const before = doc?.beforeRepair
  if (!doc || !before) return
  for (const [part, b] of before.parts) {
    for (const c of [...part.children]) {
      part.remove(c)
      disposeTree(c)
    }
    for (const c of b.children) part.add(c)
    info(part).triangles = b.triangles
    info(part).meshes = b.meshes
  }
  doc.warnings = before.warnings
  doc.beforeRepair = undefined
  doc.fixNote = null
  ws.fixNote = null
  ws.canUndoRepair = false
  logHistory(doc, 'Undo repair', 'Put each model back as it was loaded.')
  afterGeometryChange(doc)
}

function afterGeometryChange(doc: Doc) {
  doc.wrapper.updateMatrixWorld(true)
  markModified()
  modelListener.call('edit')
  doc.marks = null
  if (docs.get(ws.activeId ?? '') === doc) {
    showMarks(false)
    syncParts(doc)
    viewer?.setModel(doc.wrapper, doc.sel)
    viewer?.setWireframe(ws.wireframe)
    viewer?.changed()
    refresh()
    scheduleCheck(0)
  }
}

export function centerOnBed() {
  apply((w) => {
    const c = new THREE.Box3().setFromObject(w, true).getCenter(new THREE.Vector3())
    w.position.x -= c.x
    w.position.y -= c.y
  }, 'Centre')
}

export function resetTransform() {
  apply((w) => {
    w.position.set(0, 0, info(w).initialZ)
    w.rotation.set(0, 0, 0)
    w.scale.set(1, 1, 1)
  }, 'Reset')
  const m = activeModel()
  if (m) m.modified = false
}

export function activeOriginal() {
  return activeDoc()?.original ?? null
}

/** Exports the model as currently transformed. */
export function exportActive(format: ExportFormat) {
  const doc = activeDoc()
  return doc ? exportModel(doc.wrapper, format) : null
}

export async function saveAs() {
  const doc = activeDoc()
  const meta = activeModel()
  if (!doc || !meta) return
  ws.saving = true
  ws.error = null
  ws.notice = null
  try {
    const stem = meta.name.replace(/\.[^.]+$/, '')
    const data = exportModel(doc.wrapper, ws.exportFormat, stem)
    const res = await window.api.files.saveModel({
      suggestedName: `${stem}-edited.${ws.exportFormat}`,
      format: ws.exportFormat,
      data,
    })
    if (res.canceled) return
    if (!res.ok || !res.path) {
      ws.error = `Save failed: ${res.error ?? 'unknown error'}`
      return
    }
    meta.savedPath = res.path
    const name = res.path.split(/[\\/]/).pop()
    ws.notice = {
      text: res.verified ? `Saved ${name} and verified it on disk.` : `Saved ${name}, but the read-back check did not match.`,
      path: res.path,
    }
  } catch (err) {
    ws.error = `Save failed: ${(err as Error).message}`
  } finally {
    ws.saving = false
  }
}

export async function reopenSaved(path: string) {
  try {
    await openModelFile(await window.api.files.reopenSaved(path))
  } catch (err) {
    ws.error = (err as Error).message
  }
}

let thumbnailer: (() => string | null) | null = null
export function setThumbnailer(fn: (() => string | null) | null) {
  thumbnailer = fn
}

/** Saves the untouched original file into a library group, with a thumbnail and check result. */
export async function saveToLibrary(group: string) {
  const doc = activeDoc()
  const meta = activeModel()
  if (!doc || !meta) return
  try {
    const saved = await window.api.library.addModel({
      name: meta.name,
      data: doc.original.data,
      group,
      sourceUrl: meta.sourceUrl,
      thumbnail: thumbnailer?.() ?? undefined,
      check: doc.report ? { verdict: doc.report.verdict, issues: doc.report.issues.length } : undefined,
    })
    meta.libraryId = saved.id
    ws.notice = { text: `Saved ${saved.name} to ${group}.` }
  } catch (err) {
    ws.error = (err as Error).message
  }
}

export async function openFromLibrary(id: string) {
  try {
    await openModelFile(await window.api.library.readModel(id))
    if (ws.layout === 'library') ws.layout = 'workspace'
  } catch (err) {
    ws.error = (err as Error).message
  }
}

/** Exports the model as it looks now and opens it in the chosen slicer. */
export async function sendToSlicer(slicerId?: string) {
  const meta = activeModel()
  const data = exportActive('stl')
  if (!meta || !data) return
  ws.error = null
  const res = await window.api.slicer.open({ name: meta.name, data, slicerId })
  if (res.ok) ws.notice = { text: `Opened in ${res.slicer}. The exported copy is in Boaty/Exports/Slicer.` }
  else ws.error = res.error ?? 'Could not open the slicer.'
}

export function toggleWorkspace() {
  ws.layout = ws.layout === 'browse' ? 'split' : 'browse'
}

// ---- Several models on one plate ----------------------------------------------------------

/** Makes part `i` of the active plate the one the transform tools act on. */
export function selectPart(i: number) {
  const doc = activeDoc()
  const part = doc ? partsOf(doc)[i] : undefined
  if (!doc || !part) return
  doc.sel = part
  ws.selPart = i
  viewer?.setTarget(part)
  if (ws.isolate) viewer?.setIsolated(part)
  refresh()
}

/** Adds another model to the active plate, beside what is already there. */
export async function addToPlate(file: ModelFile) {
  const doc = activeDoc()
  if (!doc) return openModelFile(file)
  ws.error = null
  ws.loading = `Adding ${file.name}`
  await new Promise((r) => setTimeout(r, 30))
  try {
    const { root: obj, warnings } = await parseModel(file)
    const { wrapper: part } = wrap(obj, file.name)
    doc.warnings.push(...warnings.map((w) => `${file.name}: ${w}`))
    pushUndo(doc, 'Add to plate')
    placeBeside(doc, part)
    doc.wrapper.add(part)
    doc.sel = part
    afterPlateChange(doc)
  } catch (err) {
    ws.error = `Couldn't add ${file.name}: ${(err as Error).message}`
  } finally {
    ws.loading = null
  }
}

export async function addToPlateFromDialog() {
  try {
    const file = await window.api.files.openModel()
    if (file) await addToPlate(file)
  } catch (err) {
    ws.error = (err as Error).message
  }
}

/** Copies the selected model (with its own geometry, so either can be changed or removed). */
export function duplicatePart(count = 1) {
  const doc = activeDoc()
  if (!doc) return
  pushUndo(doc, 'Duplicate')
  for (let n = 0; n < count; n++) {
    const copy = doc.sel.clone(true)
    copy.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.geometry = mesh.geometry.clone()
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map((m) => m.clone()) : mesh.material.clone()
    })
    copy.userData = { ...info(doc.sel), name: copyName(doc, info(doc.sel).name) }
    placeBeside(doc, copy)
    doc.wrapper.add(copy)
    doc.sel = copy
  }
  afterPlateChange(doc)
}

/** "knot.stl" → "knot.stl #2", the first free number on this plate. */
function copyName(doc: Doc, name: string) {
  const base = name.replace(/ #\d+$/, '')
  const taken = new Set(partsOf(doc).map((p) => info(p).name))
  let n = 2
  while (taken.has(`${base} #${n}`)) n++
  return `${base} #${n}`
}

/** Takes the selected model off the plate (the last one stays; close the tab instead). */
/** Shows only the selected part in the 3D view, or all of them again. */
export function setIsolate(on: boolean) {
  ws.isolate = on
  const doc = activeDoc()
  viewer?.setIsolated(on && doc ? doc.sel : null)
}

/** Moves a part built in world space into the plate group's space, so it stays where it was. */
function toPlateSpace(doc: Doc, part: THREE.Object3D) {
  doc.wrapper.updateMatrixWorld(true)
  part.applyMatrix4(doc.wrapper.matrixWorld.clone().invert())
}

/** A new plate part from world-space triangles, standing where they are. */
function partFromTriangles(tris: Float32Array, name: string, material: THREE.Material) {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(tris, 3))
  geo.computeBoundingBox()
  const c = geo.boundingBox!.getCenter(new THREE.Vector3())
  geo.translate(-c.x, -c.y, -c.z)
  geo.computeVertexNormals()
  const part = new THREE.Group()
  part.add(new THREE.Mesh(geo, material))
  part.position.copy(c)
  const size = geo.boundingBox!.getSize(new THREE.Vector3())
  const pi: PartInfo = { name, initialZ: size.z / 2, triangles: tris.length / 9, meshes: 1 }
  part.userData = pi
  return part
}

/**
 * Splits the selected model into its separate shells, each its own part on the plate, where it
 * was. Nothing is deleted: tiny shells may be intentional details.
 */
export function splitIntoParts() {
  const doc = activeDoc()
  if (!doc) return
  const part = doc.sel
  part.updateMatrixWorld(true)
  const shells = splitShells(worldTriangles(part).positions)
  if (shells.length < 2) {
    setFixNote('This model is one connected shell; there is nothing to split.')
    return
  }
  if (shells.length > 500) {
    setFixNote(`It has ${shells.length.toLocaleString()} shells; splitting that many would make the plate unusable.`)
    return
  }
  let material: THREE.Material = defaultMaterial()
  part.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.isMesh && !Array.isArray(m.material)) material = m.material
  })
  const base = info(part).name.replace(/\.[^.]+$/, '')
  const at = partsOf(doc).indexOf(part)
  const made = shells.map((tris, i) => partFromTriangles(tris, `${base} · shell ${i + 1}`, material.clone()))
  for (const p of made) toPlateSpace(doc, p)
  pushUndo(doc, 'Split shells', false, true)
  doc.wrapper.remove(part)
  doc.beforeRepair?.parts.delete(part)
  made.forEach((p, i) => doc.wrapper.children.splice(at + i, 0, p))
  for (const p of made) p.parent = doc.wrapper
  doc.sel = made[0]!
  setIsolate(false)
  afterPlateChange(doc)
  logHistory(doc, 'Split shells', `Split into ${made.length} parts.`)
  setFixNote(`Split into ${made.length} parts, largest first. Remove any you don't want from the plate list.`)
}

// ---- Geometry edits: merge, subtract, overlap, cut, simplify, smooth, rebuild, hollow -------------

function materialOf(part: THREE.Object3D): THREE.Material {
  let material: THREE.Material | null = null
  part.traverse((o) => {
    const m = o as THREE.Mesh
    if (!material && m.isMesh && !Array.isArray(m.material)) material = m.material
  })
  return (material as THREE.Material | null)?.clone() ?? defaultMaterial()
}

/** Swaps `removed` parts for `added` ones, keeping the removed ones for Undo. */
function replaceParts(doc: Doc, removed: THREE.Group[], added: THREE.Group[], label: string) {
  const at = Math.max(0, partsOf(doc).indexOf(removed[0]!))
  pushUndo(doc, label, false, true)
  doc.wrapper.updateMatrixWorld(true)
  const was = removed.length === 1 ? new THREE.Box3().setFromObject(removed[0]!, true).min.z : NaN
  for (const p of removed) {
    doc.wrapper.remove(p)
    doc.beforeRepair?.parts.delete(p)
  }
  added.forEach((p, i) => {
    toPlateSpace(doc, p)
    doc.wrapper.add(p)
    const kids = doc.wrapper.children
    kids.splice(kids.indexOf(p), 1)
    kids.splice(Math.min(at + i, kids.length), 0, p)
  })
  // A reworked part (simplify, smooth, rebuild, hollow) keeps its floor, so it doesn't sink into
  // or lift off the plate when its surface moves a little.
  if (removed.length === 1 && added.length === 1) {
    doc.wrapper.updateMatrixWorld(true)
    const now = new THREE.Box3().setFromObject(added[0]!, true).min.z
    if (Number.isFinite(was) && Number.isFinite(now)) {
      added[0]!.position.z += was - now
      added[0]!.updateMatrixWorld(true)
    }
  }
  doc.sel = added[0] ?? partsOf(doc)[0]!
  if (ws.isolate) setIsolate(false)
  afterPlateChange(doc)
}

/** Puts the plate back as it was before the last edit. */
/** World bounds of the selected part, for tools that work along an axis. */
export function selectedBounds(): { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } | null {
  const doc = activeDoc()
  if (!doc) return null
  doc.sel.updateMatrixWorld(true)
  const b = new THREE.Box3().setFromObject(doc.sel, true)
  return b.isEmpty() ? null : { min: { x: b.min.x, y: b.min.y, z: b.min.z }, max: { x: b.max.x, y: b.max.y, z: b.max.z } }
}

/** Takes the plate back one step: a move, turn or resize, or an edit such as a merge or cut. */
export function undo() {
  const doc = activeDoc()
  const step = doc?.undo?.pop()
  if (!doc || !step) return
  ;(doc.redo ??= []).push(snap(doc, step.label, step.geometry))
  restore(doc, step)
  setFixNote(`Undid ${step.label.toLowerCase()}.`)
  if (step.geometry) logHistory(doc, 'Undo', `Undid ${step.label.toLowerCase()}.`)
  syncUndo(doc)
}

/** Does again what Undo took back. */
export function redo() {
  const doc = activeDoc()
  const step = doc?.redo?.pop()
  if (!doc || !step) return
  ;(doc.undo ??= []).push(snap(doc, step.label, step.geometry))
  restore(doc, step)
  setFixNote(`Redid ${step.label.toLowerCase()}.`)
  if (step.geometry) logHistory(doc, 'Redo', `Redid ${step.label.toLowerCase()}.`)
  syncUndo(doc)
}

export const undoEdit = undo

const UNDO_LIMIT = 50

function snap(doc: Doc, label: string, geometry = false): Snap {
  const parts = partsOf(doc)
  return { label, parts, sel: doc.sel, xf: parts.map((p) => [p.position.clone(), p.quaternion.clone(), p.scale.clone()]), geometry, at: Date.now() }
}

/**
 * Remembers the plate as it is, before a change. Changes of the same kind in quick succession
 * (typing a size, nudging with the arrow keys) count as one step.
 */
function pushUndo(doc: Doc, label: string, merge = false, geometry = false) {
  const stack = (doc.undo ??= [])
  const top = stack.at(-1)
  const dropped = doc.redo ?? []
  doc.redo = []
  if (merge && top && !top.geometry && top.label === label && Date.now() - top.at < 1200) top.at = Date.now()
  else {
    stack.push(snap(doc, label, geometry))
    if (stack.length > UNDO_LIMIT) dropped.push(...stack.splice(0, stack.length - UNDO_LIMIT))
  }
  release(doc, dropped)
  syncUndo(doc)
}

/** Frees parts that only the dropped steps still held (models removed or replaced by edits). */
function release(doc: Doc, dropped: Snap[]) {
  if (!dropped.length) return
  const kept = new Set<THREE.Object3D>(partsOf(doc))
  for (const st of [...(doc.undo ?? []), ...(doc.redo ?? [])]) for (const p of st.parts) kept.add(p)
  for (const st of dropped)
    for (const p of st.parts)
      if (!kept.has(p)) {
        kept.add(p)
        disposeTree(p)
      }
}

function clearUndo(doc: Doc) {
  const dropped = [...(doc.undo ?? []), ...(doc.redo ?? [])]
  doc.undo = []
  doc.redo = []
  release(doc, dropped)
  syncUndo(doc)
}

function syncUndo(doc: Doc) {
  if (docs.get(ws.activeId ?? '') !== doc) return
  ws.undoLabel = doc.undo?.at(-1)?.label ?? null
  ws.redoLabel = doc.redo?.at(-1)?.label ?? null
}

function restore(doc: Doc, step: Snap) {
  for (const p of partsOf(doc)) doc.wrapper.remove(p)
  step.parts.forEach((p, i) => {
    const [pos, q, sc] = step.xf[i]!
    p.position.copy(pos)
    p.quaternion.copy(q)
    p.scale.copy(sc)
    doc.wrapper.add(p)
  })
  doc.sel = step.parts.includes(step.sel) ? step.sel : step.parts[0]!
  if (ws.isolate) setIsolate(false)
  afterPlateChange(doc)
}

async function edit(label: string, fn: (doc: Doc) => Promise<string | void>) {
  const doc = activeDoc()
  if (!doc || ws.working) return
  ws.working = label
  ws.error = null
  await new Promise((r) => setTimeout(r, 20))
  try {
    const before = doc.undo?.at(-1)
    const note = await fn(doc)
    if (note) setFixNote(note)
    // Only edits that changed the plate go in the history.
    const after = doc.undo?.at(-1)
    if (after && after !== before && after.geometry) logHistory(doc, after.label, note || label)
  } catch (err) {
    setFixNote(null)
    ws.error = `${label} failed: ${(err as Error).message}`
  } finally {
    ws.working = null
  }
}

const tris = (part: THREE.Object3D) => {
  part.updateMatrixWorld(true)
  return worldTriangles(part).positions
}
const nameOf = (part: THREE.Object3D) => info(part).name.replace(/\.[^.]+$/, '')

/**
 * Booleans between the parts on the plate. Union: all of them become one solid. Difference: the
 * selected part is cut away from every other part. Intersect: each other part keeps only where it
 * overlaps the selected one.
 */
export function combineParts(op: BooleanOp) {
  return edit(op === 'union' ? 'Merge' : op === 'difference' ? 'Subtract' : 'Keep overlap', async (doc) => {
    const parts = partsOf(doc)
    if (parts.length < 2) return 'Add another model to the plate first (Add model), then combine them.'
    if (op === 'union') {
      const [out] = await runCsg({ op: 'boolean', kind: 'union', solids: parts.map(tris), names: parts.map(nameOf) })
      replaceParts(doc, parts, [partFromTriangles(out!, 'Merged', materialOf(parts[0]!))], 'Merge')
      return `Merged ${parts.length} models into one solid.`
    }
    const tool = doc.sel
    const others = parts.filter((p) => p !== tool)
    const made: THREE.Group[] = []
    const skipped: string[] = []
    for (const other of others) {
      try {
        const [out] = await runCsg({ op: 'boolean', kind: op, solids: [tris(other), tris(tool)], names: [nameOf(other), nameOf(tool)] })
        made.push(partFromTriangles(out!, `${nameOf(other)} ${op === 'difference' ? 'cut' : 'overlap'}`, materialOf(other)))
      } catch (err) {
        const msg = (err as Error).message
        if (/closed solid/.test(msg)) throw err
        skipped.push(nameOf(other))
      }
    }
    if (!made.length) throw new Error(op === 'intersect' ? "The selected model doesn't overlap any other." : 'Nothing would be left.')
    // Parts the tool didn't touch stay as they are.
    const untouched = others.filter((o) => skipped.includes(nameOf(o)))
    replaceParts(doc, [...others.filter((o) => !untouched.includes(o)), tool], made, op === 'difference' ? 'Subtract' : 'Keep overlap')
    return op === 'difference'
      ? `Cut the selected model out of ${made.length} model${made.length > 1 ? 's' : ''}.`
      : `Kept only where the selected model overlaps ${made.length} model${made.length > 1 ? 's' : ''}.`
  })
}

/** Cuts the selected part with a plane across `axis` at `at` mm; keeps both halves (pulled apart), or one. */
export function cutPart(axis: 'x' | 'y' | 'z', at: number, keep: 'both' | 'low' | 'high' = 'both') {
  return edit('Cut', async (doc) => {
    const part = doc.sel
    const normal: [number, number, number] = [axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0]
    const [high, low] = await runCsg({ op: 'cut', solid: tris(part), normal, offset: at })
    if (!high!.length || !low!.length) throw new Error(`The cut at ${at} mm misses the model.`)
    const made: THREE.Group[] = []
    if (keep !== 'high') made.push(partFromTriangles(low!, `${nameOf(part)} · ${axis === 'z' ? 'bottom' : 'part A'}`, materialOf(part)))
    if (keep !== 'low') {
      const h = partFromTriangles(high!, `${nameOf(part)} · ${axis === 'z' ? 'top' : 'part B'}`, materialOf(part))
      // Pull the halves apart so the cut is visible.
      if (keep === 'both') h.position[axis] += 4
      made.push(h)
    }
    for (const p of made) {
      p.updateMatrixWorld(true)
      p.position.z -= new THREE.Box3().setFromObject(p, true).min.z
    }
    replaceParts(doc, [part], made, 'Cut')
    return keep === 'both' ? 'Cut in two; both halves are now separate parts, standing on the plate.' : 'Cut, keeping one side.'
  })
}

/**
 * Split to fit: cuts the selected part into pieces that each fit the printer (BED), with pegs,
 * dowel holes or filament-pin holes on the cut faces. Pieces are pulled slightly apart.
 */
export function splitToFit(options: Partial<ChopOptions>) {
  return edit('Split to fit', async (doc) => {
    const part = doc.sel
    const { result, info } = await runCsgInfo({ op: 'chop', solid: tris(part), options: { ...options, bed: [BED.x, BED.y, BED.z] } })
    if (!info) throw new Error('The split returned nothing.')
    const pieceCount = result.length - info.dowels
    if (pieceCount < 2) return `It already fits the ${BED.x} × ${BED.y} × ${BED.z} mm build volume, so nothing was cut.`
    const base = nameOf(part)
    const made: THREE.Group[] = []
    for (let i = 0; i < pieceCount; i++) {
      const p = partFromTriangles(result[i]!, `${base} · ${i + 1} of ${pieceCount}`, materialOf(part))
      const o = info.offsets[i]!
      p.position.x += o[0]
      p.position.y += o[1]
      p.position.z += o[2]
      made.push(p)
    }
    // Loose dowels sit in a row in front of the model.
    const front = new THREE.Box3().setFromObject(part, true)
    for (let i = 0; i < info.dowels; i++) {
      const d = partFromTriangles(result[pieceCount + i]!, `${base} · dowel ${i + 1}`, materialOf(part))
      d.position.set(front.min.x + 4 + i * 10, front.min.y - 12, 0)
      made.push(d)
    }
    replaceParts(doc, [part], made, 'Split to fit')
    // Lay the pieces out side by side on the plate (stacked pieces would otherwise float or overlap).
    const onOnePlate = arrangePlate()
    const bits = [`Split into ${pieceCount} pieces that each fit ${BED.x} × ${BED.y} × ${BED.z} mm (${info.cuts} cut${info.cuts === 1 ? '' : 's'})`]
    if (info.joiners) bits.push(options.joiner === 'pegs' ? `${info.joiners} pegs and sockets` : options.joiner === 'dowels' ? `${info.joiners} dowel holes, plus ${info.dowels} dowels to print` : `${info.joiners} holes for 1.75 mm filament pins`)
    if (info.skipped) bits.push(`${info.skipped} cut face${info.skipped === 1 ? ' was' : 's were'} too small for a joiner`)
    if (info.oversize) bits.push(`${info.oversize} piece${info.oversize === 1 ? " still doesn't" : "s still don't"} fit`)
    return bits.join('; ') + (onOnePlate ? '. They are laid out on the plate.' : ". They don't all fit on one plate: save as 3MF and slice a few at a time, or remove some.")
  })
}

/** Fewer triangles, keeping the surface within `tolerance` mm. */
export function simplifyPart(tolerance: number) {
  return edit('Simplify', async (doc) => {
    const part = doc.sel
    const before = info(part).triangles
    const [out] = await runCsg({ op: 'simplify', solid: tris(part), tolerance })
    const p = partFromTriangles(out!, info(part).name, materialOf(part))
    replaceParts(doc, [part], [p], 'Simplify')
    const after = out!.length / 9
    return `Simplified: ${before.toLocaleString()} → ${after.toLocaleString()} triangles (${Math.round((1 - after / Math.max(1, before)) * 100)}% fewer), within ${tolerance} mm.`
  })
}

/** Evens out bumps and scan noise (Taubin smoothing, so it barely shrinks). */
export function smoothPart(passes: number) {
  return edit('Smooth', async (doc) => {
    const part = doc.sel
    const out = smoothMesh(tris(part), passes)
    replaceParts(doc, [part], [partFromTriangles(out, info(part).name, materialOf(part))], 'Smooth')
    return `Smoothed with ${passes} passes.`
  })
}

/** Rebuilds the selected part as one clean closed solid from its volume. */
export function rebuildPart(voxel: number) {
  return edit('Rebuild', async (doc) => {
    const part = doc.sel
    const [out] = await runCsg({ op: 'rebuild', solid: tris(part), voxel })
    replaceParts(doc, [part], [partFromTriangles(out!, info(part).name, materialOf(part))], 'Rebuild')
    return `Rebuilt as one closed solid at ${voxel} mm detail. Details smaller than that are softened.`
  })
}

/** Leaves walls `wall` mm thick and an empty inside. */
export function hollowPart(wall: number) {
  return edit('Hollow', async (doc) => {
    const part = doc.sel
    const before = Math.abs(volumeOfTris(tris(part)))
    const [out] = await runCsg({ op: 'hollow', solid: tris(part), wall, voxel: Math.max(0.3, wall / 3) })
    replaceParts(doc, [part], [partFromTriangles(out!, info(part).name, materialOf(part))], 'Hollow')
    const after = Math.abs(volumeOfTris(out!))
    return `Hollowed with ${wall} mm walls: ${(before / 1000).toFixed(1)} → ${(after / 1000).toFixed(1)} cm³. For resin, add drain holes when slicing so resin can't stay trapped inside.`
  })
}

function volumeOfTris(p: Float32Array) {
  let v = 0
  for (let o = 0; o + 8 < p.length; o += 9)
    v += (p[o]! * (p[o + 4]! * p[o + 8]! - p[o + 5]! * p[o + 7]!) - p[o + 1]! * (p[o + 3]! * p[o + 8]! - p[o + 5]! * p[o + 6]!) + p[o + 2]! * (p[o + 3]! * p[o + 7]! - p[o + 4]! * p[o + 6]!)) / 6
  return v
}

export function removePart() {
  const doc = activeDoc()
  if (!doc || partsOf(doc).length < 2) return
  pushUndo(doc, 'Remove')
  const parts = partsOf(doc)
  const i = parts.indexOf(doc.sel)
  const part = doc.sel
  // Kept (not freed) so Undo can bring it back.
  doc.wrapper.remove(part)
  doc.beforeRepair?.parts.delete(part)
  doc.sel = partsOf(doc)[Math.max(0, i - 1)]!
  afterPlateChange(doc)
  if (ws.isolate) viewer?.setIsolated(doc.sel)
}

/**
 * Delete key / trash button: removes the selected model from the plate (Undo brings it back).
 * The last model stays; closing its tab removes it.
 */
export function deleteSelectedPart() {
  const doc = activeDoc()
  if (!doc) return
  if (partsOf(doc).length < 2) {
    ws.notice = { text: 'This is the only model on the plate. Close its tab to remove it.' }
    return
  }
  const name = ws.parts[ws.selPart]?.name ?? 'the model'
  removePart()
  ws.notice = { text: `Removed ${name} from the plate. Ctrl+Z brings it back.` }
}

/** Puts a new part to the right of everything on the plate, standing on it. */
function placeBeside(doc: Doc, part: THREE.Group) {
  doc.wrapper.updateMatrixWorld(true)
  part.updateMatrixWorld(true)
  const plate = new THREE.Box3().setFromObject(doc.wrapper, true)
  const box = new THREE.Box3().setFromObject(part, true)
  const size = box.getSize(new THREE.Vector3())
  const c = box.getCenter(new THREE.Vector3())
  part.position.x += plate.isEmpty() ? -c.x : plate.max.x + SPACING + size.x / 2 - c.x
  part.position.y += plate.isEmpty() ? -c.y : (plate.min.y + plate.max.y) / 2 - c.y
  part.position.z -= box.min.z
}

const SPACING = 5

/**
 * Lays every model on the plate out in rows (largest first) with a gap between them, centred on
 * the plate, each standing on it. Returns false when they can't all fit.
 */
export function arrangePlate(): boolean {
  const doc = activeDoc()
  if (!doc) return false
  pushUndo(doc, 'Arrange')
  const parts = partsOf(doc)
  doc.wrapper.updateMatrixWorld(true)
  const items = parts.map((p) => {
    const box = new THREE.Box3().setFromObject(p, true)
    return { p, box, w: box.max.x - box.min.x, d: box.max.y - box.min.y }
  })
  const layout = packRows(
    items.map((it) => ({ w: it.w, d: it.d })),
    BED.x,
    SPACING,
  )
  items.forEach((it, i) => {
    const at = layout.places[i]!
    it.p.position.x += at.x - (it.box.min.x + it.w / 2) - layout.width / 2
    it.p.position.y += at.y - (it.box.min.y + it.d / 2) - layout.depth / 2
    it.p.position.z -= it.box.min.z
  })
  afterPlateChange(doc)
  return layout.width <= BED.x && layout.depth <= BED.y
}

function afterPlateChange(doc: Doc) {
  doc.wrapper.updateMatrixWorld(true)
  markModified()
  modelListener.call('edit')
  doc.report = null
  if (docs.get(ws.activeId ?? '') === doc) {
    syncParts(doc)
    viewer?.setModel(doc.wrapper, doc.sel)
    viewer?.setWireframe(ws.wireframe)
    viewer?.changed()
    refresh()
    scheduleCheck(0)
  }
}

// ---- Auto-orient ------------------------------------------------------------------------------

/**
 * Turns the selected model so it needs the fewest supports, resting on a flat side where it has
 * one, then stands it on the plate where it was.
 */
/**
 * Lets the model come to rest as if dropped on the plate: it tips over its lowest points until it
 * stands steadily, then sits on the plate where it was.
 */
export function settleModel() {
  const doc = activeDoc()
  if (!doc) return
  const part = doc.sel
  part.updateMatrixWorld(true)
  const r = settle(worldTriangles(part).positions)
  apply((w) => {
    const center = new THREE.Box3().setFromObject(w, true).getCenter(new THREE.Vector3())
    w.quaternion.premultiply(r.rotation)
    w.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(w, true)
    const c = box.getCenter(new THREE.Vector3())
    w.position.x += center.x - c.x
    w.position.y += center.y - c.y
    w.position.z -= box.min.z
  }, 'Settle')
  setFixNote(
    r.tips === 0
      ? 'Already resting steadily; set down on the plate.'
      : `Settled: tipped over ${r.tips === 1 ? 'once' : `${r.tips} times`} (${Math.round(r.degrees)}°) to rest steadily on the plate.`,
  )
}

export function autoOrient() {
  const doc = activeDoc()
  if (!doc) return
  const part = doc.sel
  part.updateMatrixWorld(true)
  const ranked = rankOrientations(worldTriangles(part).positions)
  const best = ranked[0]
  if (!best) return
  const current = ranked.find((r) => r.down[2] < -0.999)
  const down = new THREE.Vector3(...best.down)
  const cm2 = (a: number) => (a / 100).toFixed(a < 100 ? 2 : 1)
  if (down.z < -0.999) {
    setFixNote(`Already the best way up (${cm2(best.overhang)} cm² overhanging).`)
    return
  }
  apply((w) => {
    const center = new THREE.Box3().setFromObject(w, true).getCenter(new THREE.Vector3())
    w.quaternion.premultiply(new THREE.Quaternion().setFromUnitVectors(down, new THREE.Vector3(0, 0, -1)))
    w.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(w, true)
    const c = box.getCenter(new THREE.Vector3())
    w.position.x += center.x - c.x
    w.position.y += center.y - c.y
    w.position.z -= box.min.z
  }, 'Auto-orient')
  setFixNote(
    current
      ? `Turned to print with less support: ${cm2(current.overhang)} → ${cm2(best.overhang)} cm² overhanging, ${cm2(best.contact)} cm² on the plate.`
      : `Turned to print with ${cm2(best.overhang)} cm² overhanging and ${cm2(best.contact)} cm² on the plate.`,
  )
}
