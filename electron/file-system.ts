import { app, dialog, type BrowserWindow } from 'electron'
import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { readFile, rename, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join, relative, isAbsolute } from 'node:path'
import { formatFromName, MODEL_FORMATS, type ModelFile, type SaveRequest, type SaveResult } from '../src/types/ipc'

export const MAX_MODEL_BYTES = 512 * 1024 * 1024

/** Root of the local workspace: Documents/Birdy/{Downloads,Exports,Library}. */
export function workspaceDirs() {
  // Development runs can work in a scratch folder instead of the real Documents/Birdy.
  const devRoot = !app.isPackaged ? process.env['BIRDY_WORKSPACE'] : undefined
  const root = devRoot || join(app.getPath('documents'), 'Birdy')
  const dirs = { root, downloads: join(root, 'Downloads'), exports: join(root, 'Exports'), library: join(root, 'Library'), models: join(root, 'Models') }
  try {
    mkdirSync(dirs.downloads, { recursive: true })
    mkdirSync(dirs.exports, { recursive: true })
    mkdirSync(dirs.library, { recursive: true })
    mkdirSync(dirs.models, { recursive: true })
  } catch {
    const fallback = app.getPath('downloads')
    return { root: fallback, downloads: fallback, exports: fallback, library: fallback, models: join(fallback, 'Birdy Models') }
  }
  return dirs
}

export function sanitizeFileName(name: string) {
  const clean = basename(name)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 180)
  return clean || 'download'
}

export function isInside(dir: string, file: string) {
  const rel = relative(dir, file)
  return !!rel && !rel.startsWith('..') && !isAbsolute(rel)
}

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

/** Paths the user saved this session; only these can be reopened without a dialog. */
const savedThisSession = new Set<string>()

async function readModelFile(path: string): Promise<ModelFile> {
  const format = formatFromName(path)
  if (!format) throw new Error('Unsupported file type.')
  const { size } = await stat(path)
  if (size > MAX_MODEL_BYTES) throw new Error('That model is too large to open (limit 512 MB).')
  return { name: basename(path), format, size, data: await readFile(path), path }
}

/** A model file the user dragged from Explorer onto a website. */
export async function readDroppedModel(path: string): Promise<ModelFile> {
  return readModelFile(path)
}

export async function openModelDialog(win: BrowserWindow): Promise<ModelFile | null> {
  const res = await dialog.showOpenDialog(win, {
    title: 'Open 3D model',
    properties: ['openFile'],
    filters: [
      { name: '3D models', extensions: [...MODEL_FORMATS] },
      { name: 'All files', extensions: ['*'] },
    ],
  })
  if (res.canceled || !res.filePaths[0]) return null
  return readModelFile(res.filePaths[0])
}

export async function reopenSaved(path: unknown): Promise<ModelFile> {
  if (typeof path !== 'string' || !savedThisSession.has(path)) throw new Error('That file was not saved in this session.')
  return readModelFile(path)
}

/** Save As: never touches the original, writes atomically, then reads back to verify. */
export async function saveModel(win: BrowserWindow, req: SaveRequest, exportsDir: string): Promise<SaveResult> {
  if (!req || (req.format !== 'stl' && req.format !== 'obj')) return { ok: false, error: 'Unsupported export format.' }
  if (!(req.data instanceof Uint8Array) || req.data.byteLength === 0 || req.data.byteLength > MAX_MODEL_BYTES) {
    return { ok: false, error: 'There is no model data to save.' }
  }
  const ext = `.${req.format}`
  const res = await dialog.showSaveDialog(win, {
    title: 'Save model as',
    defaultPath: join(exportsDir, sanitizeFileName(req.suggestedName)),
    filters: [{ name: req.format.toUpperCase(), extensions: [req.format] }],
  })
  if (res.canceled || !res.filePath) return { ok: false, canceled: true }
  let target = res.filePath
  if (extname(target).toLowerCase() !== ext) target += ext
  try {
    const tmp = `${target}.partial`
    await writeFile(tmp, req.data)
    await rename(tmp, target)
    const back = await readFile(target)
    const verified = back.byteLength === req.data.byteLength && sha(back) === sha(req.data)
    savedThisSession.add(target)
    return { ok: true, path: target, verified }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    const msg =
      code === 'EACCES' || code === 'EPERM'
        ? 'Permission denied. Choose a folder you can write to.'
        : code === 'ENOSPC'
          ? 'Not enough disk space.'
          : (err as Error).message
    return { ok: false, error: msg }
  }
}
