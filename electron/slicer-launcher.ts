import { app, dialog, type BrowserWindow } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { createHash } from 'node:crypto'
import type { SlicerHandoff, SlicerHandoffResult, SlicerInfo, SlicersState } from '../src/types/ipc'
import { MAX_MODEL_BYTES, sanitizeFileName } from './file-system'

/** Known slicers and where their Windows installers put them. Each one accepts a model path argument. */
const KNOWN: { id: string; name: string; candidates: () => string[] }[] = [
  {
    id: 'orca',
    name: 'OrcaSlicer',
    candidates: () => programDirs().map((d) => join(d, 'OrcaSlicer', 'orca-slicer.exe')),
  },
  {
    id: 'bambu',
    name: 'Bambu Studio',
    candidates: () => programDirs().map((d) => join(d, 'Bambu Studio', 'bambu-studio.exe')),
  },
  {
    id: 'prusa',
    name: 'PrusaSlicer',
    candidates: () => programDirs().map((d) => join(d, 'Prusa3D', 'PrusaSlicer', 'prusa-slicer.exe')),
  },
  {
    id: 'cura',
    name: 'UltiMaker Cura',
    candidates: () =>
      programDirs().flatMap((d) => {
        try {
          return readdirSync(d)
            .filter((n) => /^ulti?maker cura/i.test(n))
            .sort()
            .reverse()
            .flatMap((n) => [join(d, n, 'UltiMaker-Cura.exe'), join(d, n, 'Ultimaker-Cura.exe'), join(d, n, 'Cura.exe')])
        } catch {
          return []
        }
      }),
  },
]

function programDirs() {
  return [process.env['ProgramFiles'], process.env['ProgramFiles(x86)'], process.env['LOCALAPPDATA'] && join(process.env['LOCALAPPDATA'], 'Programs')].filter(
    (d): d is string => !!d,
  )
}

interface Config {
  defaultId: string | null
  custom: { id: string; name: string; path: string }[]
  history: { file: string; slicer: string; at: number }[]
}

const configFile = () => join(app.getPath('userData'), 'slicers.json')

function loadConfig(): Config {
  try {
    const c = JSON.parse(readFileSync(configFile(), 'utf8')) as Config
    return { defaultId: c.defaultId ?? null, custom: c.custom ?? [], history: c.history ?? [] }
  } catch {
    return { defaultId: null, custom: [], history: [] }
  }
}

function saveConfig(c: Config) {
  writeFileSync(configFile(), JSON.stringify(c, null, 2))
}

function isExe(p: string) {
  try {
    return extname(p).toLowerCase() === '.exe' && statSync(p).isFile()
  } catch {
    return false
  }
}

export function listSlicers(): SlicersState {
  const cfg = loadConfig()
  const found: SlicerInfo[] = []
  for (const k of KNOWN) {
    const path = k.candidates().find((p) => existsSync(p))
    if (path) found.push({ id: k.id, name: k.name, path, custom: false })
  }
  for (const c of cfg.custom) if (isExe(c.path)) found.push({ ...c, custom: true })
  const defaultId = found.some((s) => s.id === cfg.defaultId) ? cfg.defaultId : (found[0]?.id ?? null)
  return { slicers: found, defaultId }
}

export function setDefaultSlicer(id: string) {
  const cfg = loadConfig()
  cfg.defaultId = id
  saveConfig(cfg)
}

/** Lets the user point at any slicer executable. Only files they pick in the dialog are accepted. */
export async function chooseSlicer(win: BrowserWindow): Promise<SlicersState> {
  const res = await dialog.showOpenDialog(win, {
    title: 'Choose your slicer application',
    properties: ['openFile'],
    filters: [{ name: 'Applications', extensions: ['exe'] }],
  })
  if (!res.canceled && res.filePaths[0] && isExe(res.filePaths[0])) {
    const path = res.filePaths[0]
    const cfg = loadConfig()
    const id = `custom-${createHash('sha1').update(path.toLowerCase()).digest('hex').slice(0, 8)}`
    if (!cfg.custom.some((c) => c.id === id)) cfg.custom.push({ id, name: basename(path, '.exe'), path })
    cfg.defaultId = id
    saveConfig(cfg)
  }
  return listSlicers()
}

/**
 * Writes the model to Birdy/Exports/Slicer, confirms the file is complete, then starts the
 * chosen slicer with that one file as its only argument (no shell, no other input).
 */
export async function openInSlicer(req: SlicerHandoff, exportsDir: string): Promise<SlicerHandoffResult> {
  if (!req || !(req.data instanceof Uint8Array) || req.data.byteLength === 0 || req.data.byteLength > MAX_MODEL_BYTES) {
    return { ok: false, error: 'There is no model data to send.' }
  }
  const { slicers, defaultId } = listSlicers()
  const slicer = slicers.find((s) => s.id === (req.slicerId ?? defaultId))
  if (!slicer) return { ok: false, error: 'No slicer found. Install OrcaSlicer, or choose your slicer’s .exe.' }

  const dir = join(exportsDir, 'Slicer')
  await mkdir(dir, { recursive: true })
  const stem = sanitizeFileName(req.name).replace(/\.[^.]+$/, '')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const file = join(dir, `${stem}-${stamp}.stl`)
  await writeFile(file, req.data)
  const back = await readFile(file)
  if (back.byteLength !== req.data.byteLength) return { ok: false, error: 'The exported file could not be verified.' }

  try {
    const child = spawn(slicer.path, [file], { detached: true, stdio: 'ignore', windowsHide: false, shell: false })
    child.on('error', () => {})
    child.unref()
  } catch (err) {
    return { ok: false, error: `Couldn't start ${slicer.name}: ${(err as Error).message}` }
  }
  const cfg = loadConfig()
  cfg.history = [{ file, slicer: slicer.name, at: Date.now() }, ...cfg.history].slice(0, 50)
  saveConfig(cfg)
  return { ok: true, path: file, slicer: slicer.name }
}
