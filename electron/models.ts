import { app, dialog, shell, type BrowserWindow } from 'electron'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, watch, type FSWatcher } from 'node:fs'
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'
import { formatFromName, type ModelFile } from '../src/types/ipc'
import { MAX_MODEL_BYTES } from './file-system'
import { absPath, importIntoModels, isAbsRel, isArchiveName, listModels, searchModels, type FolderEntry, type ImportResult } from './models-import'

const MAX_THUMB_BYTES = 400 * 1024

/**
 * The Models folder (Documents/Boaty/Models): downloaded models are copied in and ZIPs unpacked,
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

  /**
   * Absolute path for a UI path: inside the Models folder for relative ones (refusing anything that
   * climbs out), or the folder or file the user browsed to on the PC for absolute ones ("C:/…").
   */
  private resolve(rel: string) {
    if (isAbsRel(rel)) return absPath(rel)
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

  /** The Models folder, the usual user folders, and every drive that exists. */
  places(): { name: string; rel: string; kind: 'models' | 'folder' | 'drive' }[] {
    const out: { name: string; rel: string; kind: 'models' | 'folder' | 'drive' }[] = [{ name: 'Models', rel: '', kind: 'models' }]
    const toRel = (p: string) => p.replace(/\\/g, '/').replace(/\/$/, '')
    for (const [name, key] of [['Downloads', 'downloads'], ['Desktop', 'desktop'], ['Documents', 'documents']] as const) {
      try {
        const p = app.getPath(key)
        if (existsSync(p)) out.push({ name, rel: toRel(p), kind: 'folder' })
      } catch {
        // Not set up on this PC.
      }
    }
    for (let c = 67; c <= 90; c++) {
      const d = `${String.fromCharCode(c)}:`
      if (existsSync(`${d}\\`)) out.push({ name: `${d} drive`, rel: d, kind: 'drive' })
    }
    return out
  }

  async pickFolder(): Promise<string | null> {
    const r = await dialog.showOpenDialog(this.win, { title: 'Browse a folder for models', properties: ['openDirectory'] })
    const p = r.canceled ? undefined : r.filePaths[0]
    return p ? p.replace(/\\/g, '/').replace(/\/$/, '') : null
  }

  /** Unpacks a ZIP the user picked in the panel into the Models folder. */
  async importArchive(rel: string): Promise<void> {
    if (!isAbsRel(rel) || !isArchiveName(rel)) throw new Error('That is not a ZIP file.')
    const full = this.resolve(rel)
    if (!(await stat(full)).isFile()) throw new Error('That is not a file.')
    const r = await this.importDownload(full)
    if (!r || !r.models) throw new Error('No 3D models were found in that ZIP.')
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

  /**
   * Moves a model, ZIP or folder to the Recycle Bin after the user confirms, so it can be restored.
   * Folders only inside the Models folder: elsewhere on the PC just model files and ZIPs.
   */
  async trash(rel: string): Promise<boolean> {
    if (!rel) throw new Error('The Models folder itself cannot be deleted.')
    const full = this.resolve(rel)
    const st = await stat(full)
    const isDir = st.isDirectory()
    if (isDir && isAbsRel(rel)) throw new Error('Only folders inside the Models folder can be deleted here.')
    if (!isDir && !(st.isFile() && (formatFromName(full) || isArchiveName(full)))) throw new Error('Only 3D models, ZIPs and folders can be deleted here.')
    // Dev-only test hook so a demo run can get past the question.
    const autoYes = !app.isPackaged && process.env.BOATY_TEST_CONFIRM === '1'
    const { response } = autoYes ? { response: 0 } : await dialog.showMessageBox(this.win, {
      type: 'warning',
      title: 'Delete',
      message: `Move "${basename(full)}" to the Recycle Bin?`,
      detail: isDir ? 'The folder and everything in it go to the Recycle Bin. You can restore them from there.' : 'You can restore it from the Recycle Bin.',
      buttons: ['Move to Recycle Bin', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    })
    if (response !== 0) return false
    await shell.trashItem(full)
    return true
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
