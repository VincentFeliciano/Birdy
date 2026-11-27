import type { ModelsEntry, ModelsImport } from '../../types/ipc'
import { openModelFile } from '../workspace/store.svelte'
import { queueThumbs } from './thumbs'

/** The Models panel: browsing Documents/Birdy/Models. */
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

/** Breadcrumb for the current folder. */
export function crumbs() {
  const parts = models.cwd.split('/').filter(Boolean)
  return parts.map((name, i) => ({ name, rel: parts.slice(0, i + 1).join('/') }))
}

export async function openModel(rel: string) {
  models.opening = rel
  try {
    const file = await window.api.models.read(rel)
    await openModelFile(file)
  } catch (err) {
    models.notice = `Couldn't open it: ${(err as Error).message}`
  } finally {
    models.opening = null
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
