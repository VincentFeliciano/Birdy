// Puts downloaded models into the Models folder: model files are copied in, ZIP archives are
// unpacked into a folder of their own (model files only). No Electron imports, so it runs in tests.
import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { copyFile, mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, relative } from 'node:path'
import { formatFromName } from '../src/types/ipc.ts'
import { openZip, readZipEntries, readZipEntry, safeRelativePath, type ZipEntry } from './zip.ts'

export const MAX_FILE_BYTES = 512 * 1024 * 1024
export const MAX_ARCHIVE_BYTES = 4 * 1024 * 1024 * 1024
export const MAX_ARCHIVE_MODELS = 2000

export interface ImportResult {
  kind: 'file' | 'folder'
  /** Path inside the Models folder, forward slashes. Empty when nothing was imported. */
  rel: string
  models: number
  /** The model to open right away (the only one, or null when there are several). */
  openRel: string | null
  /** Every model unpacked from an archive (paths inside the Models folder), for opening them together. */
  modelRels?: string[]
  /** It was already in the Models folder. */
  existing: boolean
  /** Entries left out, with the reason. */
  skipped: string[]
}

export const isArchiveName = (name: string) => extname(name).toLowerCase() === '.zip'

const toRel = (root: string, p: string) => relative(root, p).split('\\').join('/')

/** A path the UI gave that points outside the Models folder: "C:" or "C:/Users/…". */
export const isAbsRel = (rel: string) => /^[a-z]:(\/|$)/i.test(rel)

/** The Windows path for an absolute UI path, refusing ".." so it stays the folder it names. */
export function absPath(rel: string): string {
  const parts = rel.split('/').filter(Boolean)
  if (parts.some((p) => p === '..' || p === '.')) throw new Error('Bad path.')
  return parts.length === 1 ? `${parts[0]}\\` : parts.join('\\')
}
const absRel = (p: string) => p.replace(/\\/g, '/').replace(/\/$/, '')
/** Windows system folders that are never useful to browse for models. */
const HIDDEN_DIRS = /^(\$|System Volume Information$|Windows$|ProgramData$|Recovery$|PerfLogs$|Config\.Msi$|node_modules$|AppData$)/i

function sha256(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    createReadStream(path)
      .on('data', (c) => h.update(c))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject)
  })
}

function cleanName(name: string, fallback: string) {
  const s = name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '')
    .trim()
    .slice(0, 120)
  return s || fallback
}

/** "name.ext", "name (2).ext", … that does not exist yet. */
function unique(dir: string, name: string) {
  const ext = extname(name)
  const stem = name.slice(0, name.length - ext.length)
  let candidate = join(dir, name)
  for (let n = 2; existsSync(candidate); n++) candidate = join(dir, `${stem} (${n})${ext}`)
  return candidate
}

/** Strips " (3)" that the downloads folder adds to repeated names. */
const stemOf = (fileName: string) => basename(fileName, extname(fileName)).replace(/ \(\d+\)$/, '')

export async function importIntoModels(root: string, src: string): Promise<ImportResult | null> {
  await mkdir(root, { recursive: true })
  const name = basename(src)
  if (formatFromName(name)) return importFile(root, src)
  if (isArchiveName(name)) return importArchive(root, src)
  return null
}

async function importFile(root: string, src: string): Promise<ImportResult> {
  const { size } = await stat(src)
  const name = cleanName(`${stemOf(src)}${extname(src).toLowerCase()}`, 'model.stl')
  // Same name with the same content: it is already there.
  const same = join(root, name)
  if (existsSync(same) && (await stat(same)).size === size && (await sha256(same)) === (await sha256(src))) {
    return { kind: 'file', rel: toRel(root, same), models: 1, openRel: toRel(root, same), existing: true, skipped: [] }
  }
  const dest = unique(root, name)
  await copyFile(src, dest)
  return { kind: 'file', rel: toRel(root, dest), models: 1, openRel: toRel(root, dest), existing: false, skipped: [] }
}

interface Planned {
  entry: ZipEntry
  parts: string[]
}

async function importArchive(root: string, src: string): Promise<ImportResult> {
  const fh = await openZip(src)
  const skipped: string[] = []
  try {
    const entries = await readZipEntries(fh)
    let planned: Planned[] = []
    let total = 0
    for (const entry of entries) {
      if (entry.isDir) continue
      const leaf = entry.name.split('/').pop() ?? ''
      if (!formatFromName(leaf)) continue
      const parts = safeRelativePath(entry.name)
      if (!parts) {
        // macOS resource forks and hidden files are junk, not worth a mention; anything else is.
        const junk = entry.name.split('/').some((s) => s === '__MACOSX' || (s.startsWith('.') && s !== '..' && s !== '.'))
        if (!junk) skipped.push(`${entry.name}: unsafe path`)
        continue
      }
      if (entry.flags & 0x1) {
        skipped.push(`${entry.name}: password protected`)
        continue
      }
      if (entry.size > MAX_FILE_BYTES) {
        skipped.push(`${entry.name}: larger than 512 MB`)
        continue
      }
      if (planned.length >= MAX_ARCHIVE_MODELS) {
        skipped.push(`${entry.name}: more than ${MAX_ARCHIVE_MODELS} models in the archive`)
        continue
      }
      if (total + entry.size > MAX_ARCHIVE_BYTES) {
        skipped.push(`${entry.name}: the archive unpacks to more than 4 GB`)
        continue
      }
      total += entry.size
      planned.push({ entry, parts })
    }
    if (!planned.length) return { kind: 'folder', rel: '', models: 0, openRel: null, existing: false, skipped }

    // Drop wrapper folders every model shares ("Thing-123/files/…" becomes "…").
    while (planned.every((p) => p.parts.length > 1 && p.parts[0] === planned[0]!.parts[0])) {
      planned = planned.map((p) => ({ ...p, parts: p.parts.slice(1) }))
    }

    const folderName = cleanName(stemOf(src), 'models')
    const sameFolder = join(root, folderName)
    // Unpacked before with the same files and sizes: reuse it.
    if (existsSync(sameFolder) && (await matches(sameFolder, planned))) {
      return result(root, sameFolder, planned, true, skipped)
    }
    const dest = unique(root, folderName)
    let written = 0
    for (const p of planned) {
      const out = join(dest, ...p.parts)
      if (relative(dest, out).startsWith('..')) continue // safeRelativePath already prevents this
      try {
        const data = await readZipEntry(fh, p.entry, MAX_FILE_BYTES)
        await mkdir(dirname(out), { recursive: true })
        await writeFile(unique(dirname(out), basename(out)), data, { flag: 'wx' })
        written++
      } catch (err) {
        skipped.push(`${p.entry.name}: ${(err as Error).message}`)
      }
    }
    if (!written) return { kind: 'folder', rel: '', models: 0, openRel: null, existing: false, skipped }
    return result(root, dest, planned, false, skipped, written)
  } finally {
    await fh.close()
  }
}

async function matches(folder: string, planned: Planned[]) {
  for (const p of planned) {
    const f = join(folder, ...p.parts)
    if (!existsSync(f) || (await stat(f)).size !== p.entry.size) return false
  }
  return true
}

function result(root: string, folder: string, planned: Planned[], existing: boolean, skipped: string[], count = planned.length): ImportResult {
  const only = count === 1 ? toRel(root, join(folder, ...planned[0]!.parts)) : null
  const modelRels = planned.slice(0, count).map((p) => toRel(root, join(folder, ...p.parts)))
  return { kind: 'folder', rel: toRel(root, folder), models: count, openRel: only, modelRels, existing, skipped }
}

export interface FolderEntry {
  name: string
  rel: string
  kind: 'dir' | 'model' | 'archive'
  size: number
  mtime: number
  /** Model files inside a folder (all levels). */
  models?: number
}

/** Folders and model files in one folder of the Models tree (other files are hidden). */
export async function listModels(root: string, rel: string): Promise<FolderEntry[]> {
  if (isAbsRel(rel)) return listAnywhere(absPath(rel))
  const dir = join(root, ...rel.split('/').filter(Boolean))
  if (relative(root, dir).startsWith('..')) throw new Error('Outside the Models folder.')
  const out: FolderEntry[] = []
  for (const d of await readdir(dir, { withFileTypes: true })) {
    if (d.name.startsWith('.')) continue
    const full = join(dir, d.name)
    if (d.isDirectory()) {
      const st = await stat(full)
      out.push({ name: d.name, rel: toRel(root, full), kind: 'dir', size: 0, mtime: st.mtimeMs, models: await countModels(full, 4) })
    } else if (d.isFile() && formatFromName(d.name)) {
      const st = await stat(full)
      out.push({ name: d.name, rel: toRel(root, full), kind: 'model', size: st.size, mtime: st.mtimeMs })
    }
  }
  return out.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.kind === 'dir' ? -1 : 1))
}

/** Folders, models and ZIPs in any folder on the PC. Counts only look one level down, to stay quick on big drives. */
async function listAnywhere(dir: string): Promise<FolderEntry[]> {
  const out: FolderEntry[] = []
  for (const d of await readdir(dir, { withFileTypes: true })) {
    if (d.name.startsWith('.')) continue
    const full = join(dir, d.name)
    try {
      if (d.isDirectory()) {
        if (HIDDEN_DIRS.test(d.name)) continue
        const st = await stat(full)
        out.push({ name: d.name, rel: absRel(full), kind: 'dir', size: 0, mtime: st.mtimeMs, models: await countModels(full, 0) })
      } else if (d.isFile() && (formatFromName(d.name) || isArchiveName(d.name))) {
        const st = await stat(full)
        out.push({ name: d.name, rel: absRel(full), kind: formatFromName(d.name) ? 'model' : 'archive', size: st.size, mtime: st.mtimeMs })
      }
    } catch {
      // Locked or vanished: leave it out.
    }
  }
  const order = { dir: 0, model: 1, archive: 2 }
  return out.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, undefined, { numeric: true }) : order[a.kind] - order[b.kind]))
}

/** Names anywhere in the Models tree containing every word of the query; models first, then folders. */
export async function searchModels(root: string, query: string, limit = 200): Promise<FolderEntry[]> {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const found: FolderEntry[] = []
  const walk = async (dir: string, depth: number) => {
    let items
    try {
      items = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const d of items) {
      if (found.length >= limit) return
      if (d.name.startsWith('.')) continue
      const full = join(dir, d.name)
      const hit = words.every((w) => d.name.toLowerCase().includes(w))
      if (d.isDirectory()) {
        if (hit) found.push({ name: d.name, rel: toRel(root, full), kind: 'dir', size: 0, mtime: (await stat(full)).mtimeMs, models: await countModels(full, 4) })
        if (depth > 0) await walk(full, depth - 1)
      } else if (hit && d.isFile() && formatFromName(d.name)) {
        const st = await stat(full)
        found.push({ name: d.name, rel: toRel(root, full), kind: 'model', size: st.size, mtime: st.mtimeMs })
      }
    }
  }
  await walk(root, 10)
  return found.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.kind === 'model' ? -1 : 1))
}

async function countModels(dir: string, depth: number): Promise<number> {
  let n = 0
  try {
    for (const d of await readdir(dir, { withFileTypes: true })) {
      if (d.name.startsWith('.')) continue
      if (d.isFile() && formatFromName(d.name)) n++
      else if (d.isDirectory() && depth > 0) n += await countModels(join(dir, d.name), depth - 1)
    }
  } catch {
    // Unreadable folder: count what we have.
  }
  return n
}
