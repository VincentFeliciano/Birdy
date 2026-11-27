import { app, shell, type BrowserWindow } from 'electron'
import { existsSync } from 'node:fs'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type { HistoryEntry, HistoryInput } from '../src/types/ipc'

const MAX_ENTRIES = 1000
const MAX_THUMB = 60_000

/** Print history: every file Birdy saved or sent to a printer, kept in userData/print-history.json. */
export class PrintHistory {
  private file = join(app.getPath('userData'), 'print-history.json')
  private entries: HistoryEntry[] = []
  private loaded: Promise<void>
  private writing: Promise<void> = Promise.resolve()

  constructor(private win: BrowserWindow) {
    this.loaded = readFile(this.file, 'utf8')
      .then((t) => {
        const data = JSON.parse(t) as unknown
        if (Array.isArray(data)) this.entries = data.filter((e) => e && typeof e.id === 'string')
      })
      .catch(() => {})
  }

  async list() {
    await this.loaded
    return this.entries
  }

  async add(input: unknown) {
    await this.loaded
    const e = clean(input)
    if (!e) throw new Error('Not a valid history entry.')
    this.entries.unshift(e)
    if (this.entries.length > MAX_ENTRIES) this.entries.length = MAX_ENTRIES
    await this.save()
    return e
  }

  async update(id: unknown, patch: unknown) {
    await this.loaded
    const e = this.entries.find((x) => x.id === id)
    const p = patch as Partial<HistoryEntry> | null
    if (!e || !p) return
    if (p.outcome === null || p.outcome === 'ok' || p.outcome === 'failed') e.outcome = p.outcome
    if (typeof p.note === 'string') e.note = p.note.slice(0, 500)
    await this.save()
  }

  async remove(id: unknown) {
    await this.loaded
    this.entries = this.entries.filter((x) => x.id !== id)
    await this.save()
  }

  /** Shows the entry's saved file in File Explorer, if it is still there. */
  async reveal(id: unknown) {
    await this.loaded
    const path = this.entries.find((x) => x.id === id)?.path
    if (path && isAbsolute(path) && existsSync(path)) shell.showItemInFolder(path)
    return !!path && existsSync(path)
  }

  private save() {
    // Writes go one after another, each atomically.
    this.writing = this.writing.then(async () => {
      const tmp = `${this.file}.partial`
      await writeFile(tmp, JSON.stringify(this.entries))
      await rename(tmp, this.file)
    }).catch(() => {})
    if (!this.win.isDestroyed()) this.win.webContents.send('history:changed', this.entries)
    return this.writing
  }
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : undefined)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function clean(input: unknown): HistoryEntry | null {
  const i = input as Partial<HistoryInput> | null
  if (!i || (i.kind !== 'fdm' && i.kind !== 'resin')) return null
  if (i.how !== 'saved' && i.how !== 'sent' && i.how !== 'usb') return null
  const name = str(i.name, 200)
  if (!name) return null
  const thumb = str(i.thumbnail, MAX_THUMB)
  return {
    id: crypto.randomUUID(),
    at: Date.now(),
    name,
    kind: i.kind,
    how: i.how,
    printer: str(i.printer, 120) ?? '',
    path: str(i.path, 1000),
    seconds: num(i.seconds),
    grams: num(i.grams),
    ml: num(i.ml),
    cost: num(i.cost),
    settings: str(i.settings, 300) ?? '',
    thumbnail: thumb && /^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(thumb) ? thumb : undefined,
    outcome: null,
    note: '',
  }
}
