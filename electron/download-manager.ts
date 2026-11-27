import { app, shell, type BrowserWindow, type DownloadItem, type Session } from 'electron'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { formatFromName, type DownloadInfo, type ModelFile } from '../src/types/ipc'
import { isInside, MAX_MODEL_BYTES, sanitizeFileName } from './file-system'
import { isArchiveName, type ImportResult } from './models-import'

interface Entry {
  info: DownloadInfo
  item: DownloadItem | null
  savePath: string
}

interface HashRecord {
  hash: string
  path: string
  url: string
}

function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    createReadStream(path)
      .on('data', (c) => h.update(c))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject)
  })
}

/**
 * Saves every download into the workspace Downloads folder, reports progress, detects
 * duplicate content by SHA-256, and flags supported 3D models. Downloads are never executed.
 */
export class DownloadManager {
  private entries = new Map<number, Entry>()
  private nextId = 1
  private reserved = new Set<string>()
  private indexFile = join(app.getPath('userData'), 'download-index.json')
  private index: HashRecord[] = []
  private emitTimer: NodeJS.Timeout | null = null

  constructor(
    private win: BrowserWindow,
    private session: Session,
    readonly dir: string,
    /** Copies a finished model, or unpacks a finished ZIP, into the Models folder. */
    private importer?: (path: string) => Promise<ImportResult | null>,
  ) {
    try {
      if (existsSync(this.indexFile)) this.index = JSON.parse(readFileSync(this.indexFile, 'utf8'))
    } catch {
      this.index = []
    }
    session.on('will-download', (_e, item, wc) => this.track(item, wc?.getURL() ?? ''))
  }

  private uniquePath(name: string) {
    const ext = extname(name)
    const stem = name.slice(0, name.length - ext.length) || 'download'
    let candidate = join(this.dir, name)
    for (let n = 1; existsSync(candidate) || this.reserved.has(candidate.toLowerCase()); n++) {
      candidate = join(this.dir, `${stem} (${n})${ext}`)
    }
    this.reserved.add(candidate.toLowerCase())
    return candidate
  }

  private track(item: DownloadItem, sourcePage: string) {
    const filename = sanitizeFileName(item.getFilename())
    const savePath = this.uniquePath(filename)
    item.setSavePath(savePath)
    const id = this.nextId++
    const info: DownloadInfo = {
      id,
      filename: basename(savePath),
      url: item.getURL(),
      sourcePage,
      received: 0,
      total: item.getTotalBytes(),
      state: 'progressing',
      paused: false,
      isModel: formatFromName(filename) !== null,
      isArchive: isArchiveName(filename),
      imported: null,
      importNote: null,
      duplicateOf: null,
      error: null,
      startedAt: Date.now(),
    }
    const entry: Entry = { info, item, savePath }
    this.entries.set(id, entry)

    item.on('updated', (_e, state) => {
      info.received = item.getReceivedBytes()
      info.total = item.getTotalBytes()
      info.paused = item.isPaused()
      info.state = state === 'interrupted' ? 'interrupted' : 'progressing'
      this.emit()
    })
    item.once('done', async (_e, state) => {
      this.reserved.delete(savePath.toLowerCase())
      info.received = item.getReceivedBytes()
      info.state = state
      if (state === 'interrupted') info.error = 'The download was interrupted. Check your connection and disk space, then retry.'
      if (state === 'completed') await this.finish(entry)
      if (state === 'completed' && (info.isModel || info.isArchive)) await this.importToModels(entry)
      this.emit(true)
      if (state === 'completed' && info.isModel) this.win.webContents.send('downloads:model-ready', id)
    })
    this.emit(true)
  }

  private async finish(entry: Entry) {
    try {
      const hash = await sha256File(entry.savePath)
      const existing = this.index.find((r) => r.hash === hash && r.path !== entry.savePath && existsSync(r.path))
      if (existing) {
        // Identical content already on disk: keep the original copy, drop the new one.
        unlinkSync(entry.savePath)
        entry.savePath = existing.path
        entry.info.duplicateOf = basename(existing.path)
      } else {
        this.index.push({ hash, path: entry.savePath, url: entry.info.url })
        writeFileSync(this.indexFile, JSON.stringify(this.index.slice(-5000)))
      }
    } catch {
      // Hashing is best effort; the file itself is already saved.
    }
  }

  private async importToModels(entry: Entry) {
    if (!this.importer) return
    try {
      const r = await this.importer(entry.savePath)
      if (!r) return
      if (r.models > 0) entry.info.imported = { rel: r.rel, models: r.models, kind: r.kind }
      else if (entry.info.isArchive) entry.info.importNote = 'No 3D models inside this ZIP.'
      if (r.skipped.length) entry.info.importNote = `${r.skipped.length} left out: ${r.skipped.slice(0, 3).join('; ')}${r.skipped.length > 3 ? '…' : ''}`
    } catch (err) {
      entry.info.importNote = `Couldn't unpack: ${(err as Error).message}`
    }
  }

  cancel(id: number) {
    this.entries.get(id)?.item?.cancel()
  }

  retry(id: number) {
    const entry = this.entries.get(id)
    if (!entry || entry.info.state === 'completed' || entry.info.state === 'progressing') return
    if (entry.item?.canResume()) {
      entry.info.state = 'progressing'
      entry.info.error = null
      entry.item.resume()
      this.emit(true)
      return
    }
    this.entries.delete(id)
    this.session.downloadURL(entry.info.url)
    this.emit(true)
  }

  showInFolder(id: number) {
    const entry = this.entries.get(id)
    if (entry && existsSync(entry.savePath)) shell.showItemInFolder(entry.savePath)
  }

  openFolder() {
    void shell.openPath(this.dir)
  }

  clear() {
    for (const [id, e] of this.entries) if (e.info.state !== 'progressing') this.entries.delete(id)
    this.emit(true)
  }

  async readModel(id: number): Promise<ModelFile> {
    const entry = this.entries.get(id)
    if (!entry || entry.info.state !== 'completed') throw new Error('That download is not finished.')
    const format = formatFromName(entry.savePath)
    if (!format) throw new Error('That file is not a supported 3D model.')
    if (!isInside(this.dir, entry.savePath)) throw new Error('That file is outside the downloads folder.')
    const { size } = await stat(entry.savePath)
    if (size > MAX_MODEL_BYTES) throw new Error('That model is too large to open (limit 512 MB).')
    const data = await readFile(entry.savePath)
    return {
      name: basename(entry.savePath),
      format,
      size,
      data,
      sourceUrl: entry.info.sourcePage || entry.info.url,
      path: entry.savePath,
    }
  }

  private emit(now = false) {
    const send = () => {
      this.emitTimer = null
      if (!this.win.isDestroyed()) this.win.webContents.send('downloads:update', [...this.entries.values()].map((e) => e.info))
    }
    if (now) {
      if (this.emitTimer) clearTimeout(this.emitTimer)
      send()
    } else if (!this.emitTimer) this.emitTimer = setTimeout(send, 150)
  }
}
