import * as THREE from 'three'
import { tick } from 'svelte'
import type { ExportFormat, ModelFile, ModelFormat } from '../../types/ipc'
import type { Projection, Tool, ViewPreset, Viewer } from '../../engine/three/viewer'
import { parseModel } from '../../engine/loaders/loadModel'
import { exportModel } from '../../engine/exporters/exportModel'
import { countMeshes, countTriangles, measure, type ModelStats } from '../../engine/geometry/stats'
import { runPrintCheck, worldTriangles } from '../../engine/geometry/runPrintCheck'
import { runRepair } from '../../engine/geometry/runRepair'
import { describeRepair } from '../../engine/geometry/repair'
import { defaultMaterial } from '../../engine/loaders/loadModel'
import type { BedSize, MarkKey, PrintMarks, PrintReport } from '../../engine/geometry/printCheck'

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

export const ws = $state({
  layout: 'browse' as Layout,
  ratio: Math.min(0.8, Math.max(0.2, Number(stored('ratio', '0.45')) || 0.45)),
  models: [] as ModelMeta[],
  activeId: null as string | null,
  tool: 'move' as Tool,
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
})

export function remember() {
  localStorage.setItem('birdy.ratio', String(ws.ratio))
  localStorage.setItem('birdy.sidebar', ws.sidebarOpen ? '1' : '0')
}

// Three.js objects live outside reactive state so Svelte never proxies them.
interface Doc {
  wrapper: THREE.Group
  /** Original file bytes, kept so the untouched original can be added to the library. */
  original: ModelFile
  warnings: string[]
  report: PrintReport | null
  /** Where the last check found problems, and the model transform it was measured at. */
  marks: { marks: PrintMarks; at: THREE.Matrix4 } | null
  triangles: number
  meshes: number
  initialZ: number
  /** The mesh as loaded, kept while a repair is applied so it can be undone. */
  beforeRepair?: { children: THREE.Object3D[]; warnings: string[]; triangles: number; meshes: number }
  fixNote: string | null
}
const docs = new Map<string, Doc>()
let viewer: Viewer | null = null
export const getViewer = () => viewer

type ModelChange = 'switch' | 'edit'
let modelListener: ((change: ModelChange) => void) | null = null
/** Lets the slicing panel drop or mark stale its preview when the model changes. */
export function onModelChange(fn: ((change: ModelChange) => void) | null) {
  modelListener = fn
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
  v.onTransform = (live) => {
    markModified()
    if (!live) modelListener?.('edit')
    refresh(!live)
    if (!live) scheduleCheck()
  }
  v.setTool(ws.tool)
  v.setShowBBox(ws.bbox)
  v.setShowGrid(ws.grid)
  v.setSnapping(ws.snap)
  const doc = activeDoc()
  if (doc) {
    v.setModel(doc.wrapper)
    v.view('iso')
    showMarks(false)
  }
}

function refresh(precise = true) {
  const doc = activeDoc()
  if (!doc) {
    ws.stats = null
    ws.xf = null
    return
  }
  const w = doc.wrapper
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
  ws.stats = measure(w, doc.triangles, doc.meshes, precise)
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
    const { marks, ...report } = await runPrintCheck(doc.wrapper, { x: BED.x, y: BED.y, z: BED.z }, doc.warnings)
    // The highlight buffers stay out of reactive state; Svelte would proxy them.
    doc.report = report
    doc.marks = marks ? { marks, at } : null
    if (seq === checkSeq && ws.activeId === id) {
      ws.report = report
      if (ws.markFocus && !report.issues.some((i) => i.mark === ws.markFocus)) ws.markFocus = null
      showMarks(false)
    }
  } catch (err) {
    if (seq === checkSeq) ws.error = `Print check failed: ${(err as Error).message}`
  } finally {
    if (seq === checkSeq) ws.checking = false
  }
}

/** Draws the active model's problem areas; with a focus, only that one, zoomed to. */
function showMarks(zoom: boolean) {
  const doc = activeDoc()
  viewer?.setMarks(doc?.marks?.marks ?? null, doc?.marks?.at ?? null, ws.markFocus, zoom)
}

/** Show button on an issue: highlight just that problem and zoom to it; again to go back. */
export function focusMark(key: MarkKey | null) {
  ws.markFocus = ws.markFocus === key ? null : key
  showMarks(!!ws.markFocus)
}

export function getReport(id: string) {
  return docs.get(id)?.report ?? null
}

function markModified() {
  const m = activeModel()
  if (m) m.modified = true
}

/**
 * Wraps the loaded object so its pivot sits at the geometric centre and the model rests
 * on the plate. Geometry is never modified; only the wrapper's transform changes.
 */
function wrap(obj: THREE.Object3D) {
  obj.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(obj, true)
  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())
  obj.position.sub(center)
  const wrapper = new THREE.Group()
  wrapper.add(obj)
  wrapper.position.set(0, 0, size.z / 2)
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
    const { wrapper, initialZ } = wrap(obj)
    const id = crypto.randomUUID()
    docs.set(id, {
      wrapper,
      initialZ,
      original: file,
      warnings,
      report: null,
      marks: null,
      fixNote: null,
      triangles: countTriangles(obj),
      meshes: countMeshes(obj),
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
  const doc = docs.get(id)
  if (!doc) return
  if (ws.activeId !== id) modelListener?.('switch')
  ws.activeId = id
  ws.report = doc.report
  ws.markFocus = null
  ws.fixNote = doc.fixNote
  ws.canUndoRepair = !!doc.beforeRepair
  if (!doc.report) scheduleCheck(0)
  viewer?.setModel(doc.wrapper)
  viewer?.setWireframe(ws.wireframe)
  showMarks(false)
  refresh()
  // Frame after the DOM settles (the sidebar may appear and narrow the viewport).
  if (frame) void tick().then(() => requestAnimationFrame(() => viewer?.view('iso')))
}

export function closeModel(id: string) {
  const doc = docs.get(id)
  if (!doc) return
  const idx = ws.models.findIndex((m) => m.id === id)
  if (ws.activeId === id) modelListener?.('switch')
  ws.models.splice(idx, 1)
  docs.delete(id)
  disposeTree(doc.wrapper)
  for (const c of doc.beforeRepair?.children ?? []) disposeTree(c)
  if (ws.activeId === id) {
    const next = ws.models[Math.min(idx, ws.models.length - 1)]
    if (next) activate(next.id)
    else {
      ws.activeId = null
      ws.report = null
      ws.markFocus = null
      viewer?.setModel(null)
      viewer?.setMarks(null, null, null, false)
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

export async function openDroppedFile(f: File, format: ModelFormat) {
  if (f.size > 512 * 1024 * 1024) {
    ws.error = `${f.name} is too large to open (limit 512 MB).`
    return
  }
  await openModelFile({ name: f.name, format, size: f.size, data: new Uint8Array(await f.arrayBuffer()) })
}

export function setTool(t: Tool) {
  ws.tool = t
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

function apply(fn: (w: THREE.Group, doc: Doc) => void) {
  const doc = activeDoc()
  if (!doc) return
  fn(doc.wrapper, doc)
  doc.wrapper.updateMatrixWorld(true)
  markModified()
  modelListener?.('edit')
  viewer?.changed()
  refresh()
  scheduleCheck()
}

export function setXForm(key: keyof XForm, value: number, uniform = false) {
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
  })
}

export function setDimension(axis: 'x' | 'y' | 'z', mm: number, uniform: boolean) {
  const current = ws.stats?.size[axis]
  if (!current || !Number.isFinite(mm) || mm <= 0) return
  const f = mm / current
  apply((w) => {
    if (uniform) w.scale.multiplyScalar(f)
    else w.scale[axis] *= f
  })
}

export function mirror(axis: 'x' | 'y' | 'z') {
  apply((w) => {
    w.scale[axis] *= -1
  })
}

export function dropToBed() {
  apply((w) => {
    const box = new THREE.Box3().setFromObject(w, true)
    w.position.z -= box.min.z
  })
}

/** Scales the model down (or up) to fit the plate with a small margin, then centres and drops it. */
export function fitToBed() {
  apply((w) => {
    const size = new THREE.Box3().setFromObject(w, true).getSize(new THREE.Vector3())
    const f = Math.min(BED.x / size.x, BED.y / size.y, BED.z / size.z) * 0.95
    if (Number.isFinite(f) && f > 0) w.scale.multiplyScalar(f)
    placeOnBed(w)
  })
  setFixNote('Scaled to fit the plate.')
}

/** Rescales a model exported in other units (cm, inches, metres) to millimetres. */
export function convertUnits(factor: number) {
  apply((w) => {
    w.scale.multiplyScalar(factor)
    placeOnBed(w)
  })
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
    // Repair in world space (so a mirrored model's faces end up facing out), then map back.
    const { positions } = worldTriangles(doc.wrapper)
    const { positions: fixed, summary } = await runRepair(positions)
    if (!docs.has(id)) return
    doc.wrapper.updateMatrixWorld(true)
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(fixed, 3))
    geo.applyMatrix4(doc.wrapper.matrixWorld.clone().invert())
    geo.computeVertexNormals()
    const mesh = new THREE.Mesh(geo, defaultMaterial())
    mesh.name = 'repaired'

    const old = [...doc.wrapper.children]
    if (doc.beforeRepair) for (const c of old) disposeTree(c)
    else doc.beforeRepair = { children: old, warnings: doc.warnings, triangles: doc.triangles, meshes: doc.meshes }
    for (const c of old) doc.wrapper.remove(c)
    doc.wrapper.add(mesh)
    // The repaired mesh stands on its own; warnings about the file it came from no longer apply.
    doc.warnings = []
    doc.triangles = summary.trianglesAfter
    doc.meshes = 1
    doc.fixNote = describeRepair(summary)
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

/** Puts back the mesh as it was loaded. */
export function undoRepair() {
  const doc = activeDoc()
  const before = doc?.beforeRepair
  if (!doc || !before) return
  for (const c of [...doc.wrapper.children]) {
    doc.wrapper.remove(c)
    disposeTree(c)
  }
  for (const c of before.children) doc.wrapper.add(c)
  doc.warnings = before.warnings
  doc.triangles = before.triangles
  doc.meshes = before.meshes
  doc.beforeRepair = undefined
  doc.fixNote = null
  ws.fixNote = null
  ws.canUndoRepair = false
  afterGeometryChange(doc)
}

function afterGeometryChange(doc: Doc) {
  doc.wrapper.updateMatrixWorld(true)
  markModified()
  modelListener?.('edit')
  doc.marks = null
  if (docs.get(ws.activeId ?? '') === doc) {
    showMarks(false)
    viewer?.setModel(doc.wrapper)
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
  })
}

export function resetTransform() {
  apply((w, doc) => {
    w.position.set(0, 0, doc.initialZ)
    w.rotation.set(0, 0, 0)
    w.scale.set(1, 1, 1)
  })
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
    const data = exportModel(doc.wrapper, ws.exportFormat)
    const stem = meta.name.replace(/\.[^.]+$/, '')
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
  if (res.ok) ws.notice = { text: `Opened in ${res.slicer}. The exported copy is in Birdy/Exports/Slicer.` }
  else ws.error = res.error ?? 'Could not open the slicer.'
}

export function toggleWorkspace() {
  ws.layout = ws.layout === 'browse' ? 'split' : 'browse'
}
