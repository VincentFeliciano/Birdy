import { dialog, shell, type BrowserWindow } from 'electron'
import { open, rename, rm } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { sanitizeFileName } from './file-system'

const MAX_RESIN_BYTES = 4 * 1024 * 1024 * 1024
const saved = new Set<string>()

/** Saves a sliced resin file (sent in pieces) through a Save dialog, writing atomically. */
export async function saveResinFile(win: BrowserWindow, req: unknown, exportsDir: string) {
  const r = req as { suggestedName?: unknown; parts?: unknown }
  const parts = r?.parts
  if (!Array.isArray(parts) || !parts.length || !parts.every((p) => p instanceof Uint8Array)) return { ok: false, error: 'There is no sliced file to save.' }
  const total = (parts as Uint8Array[]).reduce((s, p) => s + p.byteLength, 0)
  if (total > MAX_RESIN_BYTES) return { ok: false, error: 'The sliced file is too large.' }
  const suggested = sanitizeFileName(String(r.suggestedName ?? 'print.goo'))
  // The slicer names the file for the printer's format.
  const ext = (/\.(goo|ctb)$/i.exec(suggested)?.[1] ?? 'goo').toLowerCase()
  const label = ext === 'ctb' ? 'Chitubox CTB' : 'Elegoo GOO'
  const res = await dialog.showSaveDialog(win, {
    title: 'Save resin print file',
    defaultPath: join(exportsDir, suggested),
    filters: [{ name: label, extensions: [ext] }],
  })
  if (res.canceled || !res.filePath) return { ok: false, canceled: true }
  let target = res.filePath
  if (extname(target).toLowerCase() !== `.${ext}`) target += `.${ext}`
  const tmp = `${target}.partial`
  try {
    const fh = await open(tmp, 'w')
    try {
      for (const p of parts as Uint8Array[]) await fh.write(p)
    } finally {
      await fh.close()
    }
    await rename(tmp, target)
    saved.add(target)
    return { ok: true, path: target }
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {})
    const code = (err as NodeJS.ErrnoException).code
    const msg =
      code === 'EACCES' || code === 'EPERM' ? 'Permission denied. Choose a folder you can write to.' : code === 'ENOSPC' ? 'Not enough disk space.' : (err as Error).message
    return { ok: false, error: msg }
  }
}

/** Shows a file this session saved in File Explorer (e.g. to copy it to the printer's USB stick). */
export function revealResinFile(path: unknown) {
  if (typeof path === 'string' && saved.has(path)) shell.showItemInFolder(path)
}
