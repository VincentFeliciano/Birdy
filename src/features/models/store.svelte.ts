import type { ModelsEntry, ModelsImport } from '../../types/ipc'
import { addToPlate, arrangePlate, openModelFile, ws } from '../workspace/store.svelte'
import { queueThumbs } from './thumbs'

/** The Models panel: browsing Documents/Boaty/Models. */
export const models = $state({
  open: localStorage.getItem('birdy.modelsOpen') === '1',
  /** Folder being shown, relative to the Models folder ('' = top). */
  cwd: '',
  entries: [] as ModelsEntry[],
  loading: false,
  error: null as string | null,
  /** rel -> thumbnail data URL */
  thumbs: {} as Record<string, string>,
  /** Recently arrived item to point out. */
  highlight: null as string | null,
  /** Model being opened. */
  opening: null as string | null,
  notice: null as string | null,
  /** Search across the whole Models folder. */
  query: '',
  /** Show favourites instead of the current folder. */
  favsOnly: false,
  /** Search results or favourites, when either is on. */
  results: [] as ModelsEntry[],
  favs: loadFavs(),
})

function loadFavs(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem('birdy.modelFavs') ?? '[]')
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 500) : []
  } catch {
    return []
  }
}

export const isFav = (rel: string) => models.favs.includes(rel)

export function toggleFav(rel: string) {
  models.favs = isFav(rel) ? models.favs.filter((r) => r !== rel) : [...models.favs, rel]
  localStorage.setItem('birdy.modelFavs', JSON.stringify(models.favs))
  if (models.favsOnly) void refreshResults()
}

/** What the grid shows: search hits, favourites, or the current folder. */
export const shown = () => (models.query.trim() || models.favsOnly ? models.results : models.entries)

let rseq = 0
async function refreshResults() {
  const id = ++rseq
  const q = models.query.trim()
  if (!q && !models.favsOnly) return
  models.loading = true
  try {
    let list = q ? await window.api.models.search(q) : await window.api.models.lookup([...models.favs])
    if (q && models.favsOnly) list = list.filter((e) => isFav(e.rel))
    if (id !== rseq) return
    models.results = list
    queueThumbs(list.filter((e) => e.kind === 'model'))
  } catch (err) {
    if (id === rseq) {
      models.results = []
      models.notice = `Couldn't search: ${(err as Error).message}`
    }
  } finally {
    if (id === rseq) models.loading = false
  }
}

let searchTimer: ReturnType<typeof setTimeout> | null = null
export function setQuery(q: string) {
  models.query = q
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => void refreshResults(), 180)
}

export function setFavsOnly(on: boolean) {
  models.favsOnly = on
  void refreshResults()
}

/** Folder of a search hit or favourite, for "show in folder". */
export function showInFolder(rel: string) {
  models.query = ''
  models.favsOnly = false
  openFolder(rel.split('/').slice(0, -1).join('/'))
  models.highlight = rel
}

let seq = 0

export function setModelsOpen(open: boolean) {
  models.open = open
  localStorage.setItem('birdy.modelsOpen', open ? '1' : '0')
  if (open) void refresh()
}

export async function refresh() {
  const id = ++seq
  models.loading = true
  try {
    const entries = await window.api.models.list(models.cwd)
    if (id !== seq) return
    models.entries = entries
    models.error = null
    queueThumbs(entries.filter((e) => e.kind === 'model'))
  } catch (err) {
    if (id !== seq) return
    // The folder was moved or deleted: go back to the top.
    if (models.cwd) {
      models.cwd = ''
      return refresh()
    }
    models.error = (err as Error).message
  } finally {
    if (id === seq) models.loading = false
  }
}

export function openFolder(rel: string) {
  models.query = ''
  models.favsOnly = false
  models.cwd = rel
  models.highlight = null
  void refresh()
}

export function up() {
  openFolder(models.cwd.split('/').slice(0, -1).join('/'))
}

/** True when browsing somewhere on the PC other than the Models folder. */
export const isElsewhere = (rel = models.cwd) => /^[a-z]:(\/|$)/i.test(rel)

/** Breadcrumb for the current folder (for a folder elsewhere it starts at the drive). */
export function crumbs() {
  const parts = models.cwd.split('/').filter(Boolean)
  return parts.map((name, i) => ({ name, rel: parts.slice(0, i + 1).join('/') }))
}

/** Picks any folder on the PC to browse. */
export async function browseFolder() {
  const rel = await window.api.models.pickFolder()
  if (rel) openFolder(rel)
}

/** Moves a model, ZIP or folder to the Recycle Bin (main asks first), then updates the list. */
export async function deleteEntry(e: ModelsEntry) {
  try {
    if (!(await window.api.models.trash(e.rel))) return
  } catch (err) {
    models.notice = `Couldn't delete ${e.name}: ${(err as Error).message}`
    return
  }
  models.entries = models.entries.filter((x) => x.rel !== e.rel)
  models.results = models.results.filter((x) => x.rel !== e.rel)
  if (models.favs.includes(e.rel)) toggleFav(e.rel)
  models.notice = `Moved ${e.name} to the Recycle Bin.`
  void refresh()
  if (models.query.trim() || models.favsOnly) void refreshResults()
}

/** Unpacks a ZIP found elsewhere on the PC into the Models folder, then shows it there. */
export async function openArchive(rel: string) {
  models.opening = rel
  models.notice = 'Unpacking…'
  try {
    await window.api.models.importArchive(rel)
  } catch (err) {
    models.notice = `Couldn't unpack it: ${(err as Error).message}`
  } finally {
    models.opening = null
  }
}

/** Opens a model and goes straight to the Slice tab. */
export async function sliceModel(rel: string) {
  if (await openModel(rel)) {
    ws.layout = 'workspace'
    ws.sidebarTab = 'slice'
  }
}

/** Adds a model to the plate of the model that's open (opens it if none is). */
export async function addModelToPlate(rel: string) {
  if (!ws.activeId) return void (await openModel(rel))
  models.opening = rel
  try {
    await addToPlate(await window.api.models.read(rel))
    models.notice = 'Added to the plate.'
  } catch (err) {
    models.notice = `Couldn't add it: ${(err as Error).message}`
  } finally {
    models.opening = null
  }
}

export async function openModel(rel: string): Promise<boolean> {
  models.opening = rel
  try {
    const file = await window.api.models.read(rel)
    await openModelFile(file)
    return true
  } catch (err) {
    models.notice = `Couldn't open it: ${(err as Error).message}`
    return false
  } finally {
    models.opening = null
  }
}

/** A ZIP with this many models or fewer opens them all on one plate; more just shows the folder. */
export const ZIP_OPEN_MAX = 10

/** Opens every model from a downloaded ZIP on one plate and lays them out. */
async function openAllFromZip(r: ModelsImport) {
  const rels = r.modelRels ?? []
  if (rels.length < 2) return
  if (rels.length > ZIP_OPEN_MAX) {
    models.notice = `Unpacked ${r.models} models into ${r.rel}. That's too many to put on one plate, so pick the ones you want.`
    return
  }
  if (!(await openModel(rels[0]!))) return
  if (ws.layout === 'browse') ws.layout = 'split'
  let added = 1
  for (const rel of rels.slice(1)) {
    try {
      await addToPlate(await window.api.models.read(rel))
      added++
    } catch {
      /* one bad file shouldn't stop the rest */
    }
  }
  const onOnePlate = arrangePlate()
  ws.notice = {
    text: `Opened ${added} models from ${r.rel} on one plate${onOnePlate ? '' : " (they don't all fit; remove some with Delete)"}. Ctrl+Z undoes each one.`,
  }
}

function onImported(r: ModelsImport) {
  const parent = r.rel.split('/').slice(0, -1).join('/')
  if (r.kind === 'folder') {
    // Show the unpacked folder; with one model inside, open it too.
    setModelsOpen(true)
    openFolder(r.openRel ? r.rel : parent)
    models.highlight = r.openRel ?? r.rel
    models.notice = r.existing
      ? `Already unpacked: ${r.rel}`
      : `Unpacked ${r.models} model${r.models === 1 ? '' : 's'} into ${r.rel}${r.skipped.length ? ` (${r.skipped.length} left out)` : ''}`
    if (r.openRel) void openModel(r.openRel)
    else void openAllFromZip(r)
  } else {
    // Single files already open in the workspace from the download; just point them out.
    if (models.cwd === parent) void refresh()
    models.highlight = r.rel
  }
}

export async function importDownloads() {
  models.notice = 'Adding models from Downloads…'
  try {
    const r = await window.api.models.importDownloads()
    models.notice = r.added
      ? `Added ${r.models} model${r.models === 1 ? '' : 's'} from ${r.added} download${r.added === 1 ? '' : 's'}${r.failed ? ` (${r.failed} could not be read)` : ''}`
      : 'Everything in Downloads is already here.'
    await refresh()
  } catch (err) {
    models.notice = `Couldn't add them: ${(err as Error).message}`
  }
}

export function initModels() {
  const offChanged = window.api.models.onChanged(() => {
    if (!models.open) return
    void refresh()
    void refreshResults()
  })
  const offImported = window.api.models.onImported(onImported)
  if (models.open) void refresh()
  return () => {
    offChanged()
    offImported()
  }
}
