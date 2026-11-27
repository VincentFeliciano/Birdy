import { app, shell, type BrowserWindow } from 'electron'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, watch, type FSWatcher } from 'node:fs'
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'
import { formatFromName, type ModelFile } from '../src/types/ipc'
import { MAX_MODEL_BYTES } from './file-system'
import { importIntoModels, isArchiveName, listModels, searchModels, type FolderEntry, type ImportResult } from './models-import'

const MAX_THUMB_BYTES = 400 * 1024

/**
 * The Models folder (Documents/Birdy/Models): downloaded models are copied in and ZIPs unpacked,
 * and anything the user puts there shows up in the Models panel. Paths from the UI are relative
 * to this folder and checked to stay inside it.
 */
export class ModelsManager {
  private watcher: FSWatcher | null = null
  private changeTimer: NodeJS.Timeout | null = null
  private thumbDir = join(app.getPath('userData'), 'model-thumbs')

  constructor(
    private win: BrowserWindow,
    readonly root: string,
  ) {
    mkdirSync(root, { recursive: true })
    mkdirSync(this.thumbDir, { recursive: true })
    try {
      this.watcher = watch(root, { recursive: true }, () => this.changed())
      this.watcher.on('error', () => {
        this.watcher?.close()
        this.watcher = null
      })
    } catch {
      // Without a watcher the panel still refreshes on demand.
    }
  }

  private changed() {
    if (this.changeTimer) clearTimeout(this.changeTimer)
    this.changeTimer = setTimeout(() => {
      if (!this.win.isDestroyed()) this.win.webContents.send('models:changed')
    }, 400)
  }

  /** Absolute path for a relative one, refusing anything outside the Models folder. */
  private resolve(rel: string) {
    const full = join(this.root, ...rel.split('/').filter(Boolean))
    const r = relative(this.root, full)
    if (r.startsWith('..') || /^[a-z]:/i.test(r)) throw new Error('That path is outside the Models folder.')
    return full
  }

  list(rel: string): Promise<FolderEntry[]> {
    return listModels(this.root, rel)
  }

  search(query: string): Promise<FolderEntry[]> {
    return searchModels(this.root, query)
  }

  async lookup(rels: string[]): Promise<FolderEntry[]> {
    const out: FolderEntry[] = []
    for (const rel of rels) {
      try {
        const full = this.resolve(rel)
        const st = await stat(full)
        if (st.isDirectory()) out.push({ name: basename(full), rel, kind: 'dir', size: 0, mtime: st.mtimeMs })
        else if (st.isFile() && formatFromName(full)) out.push({ name: basename(full), rel, kind: 'model', size: st.size, mtime: st.mtimeMs })
      } catch {
        // Moved or deleted: leave it out.
      }
    }
    return out
  }

  async read(rel: string): Promise<ModelFile> {
    const full = this.resolve(rel)
    const format = formatFromName(full)
    if (!format) throw new Error('That file is not a supported 3D model.')
    const { size } = await stat(full)
    if (size > MAX_MODEL_BYTES) throw new Error('That model is too large to open (limit 512 MB).')
    return { name: basename(full), format, size, data: await readFile(full), path: full }
  }

  reveal(rel: string) {
    const full = rel ? this.resolve(rel) : this.root
    if (!existsSync(full)) return
    if (rel) shell.showItemInFolder(full)
    else void shell.openPath(full)
  }

  async importDownload(path: string): Promise<ImportResult | null> {
    const r = await importIntoModels(this.root, path)
    if (r && r.models > 0 && !this.win.isDestroyed()) this.win.webContents.send('models:imported', r)
    return r
  }

  /** Brings models and ZIPs already in the Downloads folder into the Models folder. */
  async importFolder(dir: string): Promise<{ added: number; models: number; failed: number }> {
    let added = 0
    let count = 0
    let failed = 0
    for (const d of await readdir(dir, { withFileTypes: true })) {
      if (!d.isFile() || !(formatFromName(d.name) || isArchiveName(d.name))) continue
      try {
        const r = await importIntoModels(this.root, join(dir, d.name))
        if (r && r.models > 0 && !r.existing) {
          added++
          count += r.models
        }
      } catch {
        failed++
      }
    }
    return { added, models: count, failed }
  }

  /** Thumbnails are cached per file content version (path, size, modified time). */
  private async thumbPath(rel: string) {
    const st = await stat(this.resolve(rel))
    const key = createHash('sha1').update(`${rel}|${st.size}|${st.mtimeMs}`).digest('hex')
    return join(this.thumbDir, `${key}.webp`)
  }

  async getThumb(rel: string): Promise<string | null> {
    try {
      const p = await this.thumbPath(rel)
      if (!existsSync(p)) return null
      return `data:image/webp;base64,${(await readFile(p)).toString('base64')}`
    } catch {
      return null
    }
  }

  async saveThumb(rel: string, dataUrl: string) {
    const m = /^data:image\/webp;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
    if (!m) return
    const buf = Buffer.from(m[1]!, 'base64')
    if (buf.length > MAX_THUMB_BYTES || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') return
    await writeFile(await this.thumbPath(rel), buf)
  }

  close() {
    this.watcher?.close()
  }
}
