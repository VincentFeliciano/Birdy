import { app, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import {
  formatFromName,
  type Bookmark,
  type LibraryData,
  type ModelFile,
  type NewBookmark,
  type NewLibraryModel,
  type SavedModel,
} from '../src/types/ipc'
import { MAX_MODEL_BYTES, sanitizeFileName } from './file-system'

export const UNSORTED = 'Unsorted'
const MAX_THUMB = 400_000

/**
 * Bookmarks and saved models, organised into groups. Metadata lives in library.json; model
 * files are copied into Birdy/Library/<group>/ so the library never depends on Downloads.
 * (The plan moves this metadata to SQLite later.)
 */
export class Library {
  private file = join(app.getPath('userData'), 'library.json')
  private data: LibraryData = { groups: [UNSORTED], bookmarks: [], models: [] }

  constructor(
    private dir: string,
    private onChange: (d: LibraryData) => void,
  ) {
    try {
      if (existsSync(this.file)) {
        const d = JSON.parse(readFileSync(this.file, 'utf8')) as LibraryData
        this.data = {
          groups: Array.isArray(d.groups) && d.groups.length ? d.groups : [UNSORTED],
          bookmarks: Array.isArray(d.bookmarks) ? d.bookmarks : [],
          models: Array.isArray(d.models) ? d.models : [],
        }
      }
    } catch {
      // Keep an empty library rather than failing to start.
    }
    if (!this.data.groups.includes(UNSORTED)) this.data.groups.unshift(UNSORTED)
  }

  get() {
    return this.data
  }

  private commit() {
    writeFileSync(this.file, JSON.stringify(this.data, null, 2))
    this.onChange(this.data)
  }

  private group(name: unknown) {
    return typeof name === 'string' && this.data.groups.includes(name) ? name : UNSORTED
  }

  private cleanGroupName(name: unknown) {
    if (typeof name !== 'string') return null
    const n = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim().slice(0, 60)
    return n || null
  }

  createGroup(name: unknown) {
    const n = this.cleanGroupName(name)
    if (!n || this.data.groups.some((g) => g.toLowerCase() === n.toLowerCase())) return
    this.data.groups.push(n)
    this.commit()
  }

  renameGroup(from: unknown, to: unknown) {
    const n = this.cleanGroupName(to)
    if (typeof from !== 'string' || from === UNSORTED || !n || !this.data.groups.includes(from)) return
    if (this.data.groups.some((g) => g !== from && g.toLowerCase() === n.toLowerCase())) return
    this.data.groups = this.data.groups.map((g) => (g === from ? n : g))
    for (const b of this.data.bookmarks) if (b.group === from) b.group = n
    for (const m of this.data.models) if (m.group === from) m.group = n
    this.commit()
  }

  /** Deleting a group keeps its items; they move to Unsorted. */
  deleteGroup(name: unknown) {
    if (typeof name !== 'string' || name === UNSORTED || !this.data.groups.includes(name)) return
    this.data.groups = this.data.groups.filter((g) => g !== name)
    for (const b of this.data.bookmarks) if (b.group === name) b.group = UNSORTED
    for (const m of this.data.models) if (m.group === name) m.group = UNSORTED
    this.commit()
  }

  addBookmark(b: NewBookmark) {
    if (!b || typeof b.url !== 'string' || !/^https?:\/\//i.test(b.url) || b.url.length > 4096) return
    if (this.data.bookmarks.some((x) => x.url === b.url)) return
    const entry: Bookmark = {
      id: randomUUID(),
      url: b.url,
      title: typeof b.title === 'string' && b.title ? b.title.slice(0, 300) : b.url,
      favicon: typeof b.favicon === 'string' && /^https?:\/\//i.test(b.favicon) ? b.favicon : null,
      group: this.group(b.group),
      createdAt: Date.now(),
    }
    this.data.bookmarks.unshift(entry)
    this.commit()
  }

  removeBookmark(id: unknown) {
    const before = this.data.bookmarks.length
    this.data.bookmarks = this.data.bookmarks.filter((b) => b.id !== id)
    if (this.data.bookmarks.length !== before) this.commit()
  }

  async addModel(m: NewLibraryModel): Promise<SavedModel> {
    const format = formatFromName(m?.name ?? '')
    if (!format) throw new Error('Only supported model files can be saved to the library.')
    const group = this.group(m.group)
    const folder = join(this.dir, sanitizeFileName(group))
    await mkdir(folder, { recursive: true })
    const name = sanitizeFileName(m.name)
    const ext = extname(name)
    let target = join(folder, name)
    for (let n = 1; existsSync(target); n++) target = join(folder, `${name.slice(0, -ext.length)} (${n})${ext}`)

    if (m.data instanceof Uint8Array && m.data.byteLength > 0 && m.data.byteLength <= MAX_MODEL_BYTES) {
      await writeFile(target, m.data)
    } else {
      throw new Error('There is no model data to save.')
    }
    const { size } = await stat(target)
    const entry: SavedModel = {
      id: randomUUID(),
      name: basename(target),
      format,
      size,
      path: target,
      group,
      sourceUrl: typeof m.sourceUrl === 'string' && /^https?:\/\//i.test(m.sourceUrl) ? m.sourceUrl : undefined,
      thumbnail: typeof m.thumbnail === 'string' && m.thumbnail.startsWith('data:image/') && m.thumbnail.length < MAX_THUMB ? m.thumbnail : undefined,
      check: m.check && ['ready', 'attention', 'fail'].includes(m.check.verdict) ? { verdict: m.check.verdict, issues: Number(m.check.issues) || 0 } : undefined,
      savedAt: Date.now(),
    }
    this.data.models.unshift(entry)
    this.commit()
    return entry
  }

  moveItem(kind: unknown, id: unknown, group: unknown) {
    const g = this.group(group)
    const list = kind === 'bookmark' ? this.data.bookmarks : kind === 'model' ? this.data.models : null
    const item = list?.find((x) => x.id === id)
    if (!item) return
    item.group = g
    this.commit()
  }

  /** Removes the entry. The file stays on disk in Birdy/Library unless deleteFile is true. */
  async removeModel(id: unknown) {
    const before = this.data.models.length
    this.data.models = this.data.models.filter((m) => m.id !== id)
    if (this.data.models.length !== before) this.commit()
  }

  async readModel(id: unknown): Promise<ModelFile> {
    const m = this.data.models.find((x) => x.id === id)
    if (!m) throw new Error('That model is not in the library.')
    const { size } = await stat(m.path)
    if (size > MAX_MODEL_BYTES) throw new Error('That model is too large to open.')
    return { name: m.name, format: m.format, size, data: await readFile(m.path), sourceUrl: m.sourceUrl, path: m.path }
  }

  showModel(id: unknown) {
    const m = this.data.models.find((x) => x.id === id)
    if (m && existsSync(m.path)) shell.showItemInFolder(m.path)
  }
}
