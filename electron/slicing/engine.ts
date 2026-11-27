import { app, dialog, type BrowserWindow } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { copyFile, cp, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import type {
  CustomPresetData,
  CustomPresetInput,
  ResolveRequest,
  EngineSource,
  EngineState,
  PresetCatalog,
  PresetKind,
  PresetRef,
  SliceRequest,
  SliceResult,
  SliceSaveResult,
} from '../../src/types/slicing'
import { MAX_MODEL_BYTES, sanitizeFileName, workspaceDirs } from '../file-system'
import { bedFromSettings, buildJobPreset, customPreset, parseCatalogLog, parseConfigBlock, pickFilament, pickProcess, stripConfChecksum, summarizeGcode, withConfChecksum } from './presets'
import { BUILTIN_PRESETS } from './builtins'

/**
 * The slicing engine is OrcaSlicer (AGPL-3.0), run as a separate command-line process.
 * Boaty installs the official portable build from OrcaSlicer's GitHub release, pinned to
 * this exact file and checked against its SHA-256 before anything is extracted.
 */
export const ENGINE = {
  version: '2.5.2',
  presetVersion: '2.5.2.0',
  url: 'https://github.com/OrcaSlicer/OrcaSlicer/releases/download/v2.5.2/OrcaSlicer_Windows_V2.5.2_x64_portable.zip',
  sha256: '730892ef174b0197e896234b8ade9df184966d2bec80cc83c8522715a25df54f',
  size: 201919243,
  exe: 'orca-slicer.exe',
} as const

const SLICE_TIMEOUT_MS = 10 * 60 * 1000
const KINDS: PresetKind[] = ['machine', 'process', 'filament']

const enginesDir = () => join(app.getPath('userData'), 'engines')
const birdyEngineDir = () => join(enginesDir(), `orcaslicer-${ENGINE.version}`)
/** OrcaSlicer's data folder for Boaty. Kept apart from the user's own OrcaSlicer settings. */
export const dataDir = () => join(enginesDir(), 'orca-data')
/** Presets imported from the user's slicers, one JSON per preset. */
export const importedDir = () => join(enginesDir(), 'imported')
const jobsDir = () => join(enginesDir(), 'jobs')

type Emit = (s: EngineState) => void

export class SlicingEngine {
  private state: EngineState = {
    source: null,
    path: null,
    version: ENGINE.version,
    installing: false,
    progress: null,
    error: null,
    downloadSize: ENGINE.size,
  }
  private abort: AbortController | null = null
  private running: ChildProcess | null = null
  private catalog: PresetCatalog | null = null

  constructor(private emit: Emit) {
    this.locate()
  }

  get(): EngineState {
    return { ...this.state }
  }

  private set(patch: Partial<EngineState>) {
    this.state = { ...this.state, ...patch }
    this.emit(this.get())
  }

  /** Prefers the engine Boaty installed, then a dev copy, then an OrcaSlicer install. */
  locate() {
    const candidates: [EngineSource, string][] = [['birdy', join(birdyEngineDir(), ENGINE.exe)]]
    if (!app.isPackaged) candidates.push(['dev', join(app.getAppPath(), '.tmp', 'orca', ENGINE.exe)])
    for (const base of [process.env['ProgramFiles'], process.env['LOCALAPPDATA'] && join(process.env['LOCALAPPDATA'], 'Programs')]) {
      if (base) candidates.push(['installed', join(base, 'OrcaSlicer', ENGINE.exe)])
    }
    const hit = candidates.find(([, p]) => existsSync(p))
    this.state.source = hit?.[0] ?? null
    this.state.path = hit?.[1] ?? null
    return this.get()
  }

  /** Downloads, verifies and unpacks the pinned OrcaSlicer build into Boaty's data folder. */
  async install(): Promise<EngineState> {
    if (this.state.installing) return this.get()
    this.abort = new AbortController()
    this.set({ installing: true, progress: 0, error: null })
    const tmp = join(enginesDir(), `.download-${randomUUID()}`)
    const zip = `${tmp}.zip`
    try {
      await mkdir(enginesDir(), { recursive: true })
      const res = await fetch(ENGINE.url, { signal: this.abort.signal, redirect: 'follow' })
      if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status}).`)
      const hash = createHash('sha256')
      let got = 0
      let lastEmit = 0
      const file = createWriteStream(zip)
      const body = Readable.fromWeb(res.body as unknown as WebReadableStream<Uint8Array>)
      await new Promise<void>((resolve, reject) => {
        body.on('data', (chunk: Buffer) => {
          got += chunk.length
          hash.update(chunk)
          if (got > ENGINE.size + 1024) body.destroy(new Error('The download is larger than expected.'))
          const now = Date.now()
          if (now - lastEmit > 250) {
            lastEmit = now
            this.set({ progress: Math.min(0.95, (got / ENGINE.size) * 0.95) })
          }
        })
        body.on('error', reject)
        file.on('error', reject)
        file.on('finish', () => resolve())
        body.pipe(file)
      })
      if (got !== ENGINE.size) throw new Error('The download was incomplete.')
      if (hash.digest('hex') !== ENGINE.sha256) throw new Error('The download did not match OrcaSlicer’s published checksum, so it was discarded.')

      this.set({ progress: 0.96 })
      await mkdir(tmp, { recursive: true })
      await run(join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', zip, '-C', tmp], 5 * 60 * 1000)
      const exeDir = findExeDir(tmp)
      if (!exeDir) throw new Error('The engine archive did not contain orca-slicer.exe.')
      await rm(birdyEngineDir(), { recursive: true, force: true })
      await moveDir(exeDir, birdyEngineDir())
      this.catalog = null
      this.locate()
      this.set({ installing: false, progress: null })
    } catch (err) {
      const aborted = this.abort?.signal.aborted
      this.set({ installing: false, progress: null, error: aborted ? null : (err as Error).message })
    } finally {
      this.abort = null
      await rm(zip, { force: true }).catch(() => {})
      await rm(tmp, { recursive: true, force: true }).catch(() => {})
    }
    return this.get()
  }

  cancelInstall() {
    this.abort?.abort()
  }

  private requirePath() {
    if (!this.state.path || !existsSync(this.state.path)) this.locate()
    if (!this.state.path) throw new Error('The slicing engine is not installed yet.')
    return this.state.path
  }

  /**
   * OrcaSlicer reads its printer profiles from packed vendor bundles in `<data>/system` and
   * deletes any bundle its config does not list, so every vendor is listed before each run.
   */
  private async prepareDataDir(exe: string) {
    const data = dataDir()
    const system = join(data, 'system')
    await mkdir(system, { recursive: true })
    const profiles = join(dirname(exe), 'resources', 'profiles')
    const bundles = (await readdir(profiles)).filter((n) => n.toLowerCase().endsWith('.opc'))
    if (!bundles.length) throw new Error('The engine has no printer profiles.')
    for (const b of bundles) {
      const src = join(profiles, b)
      const dst = join(system, b)
      const [s, d] = await Promise.all([stat(src), stat(dst).catch(() => null)])
      if (!d || d.size !== s.size || d.mtimeMs < s.mtimeMs) await copyFile(src, dst)
    }
    const confPath = join(data, 'OrcaSlicer.conf')
    let conf: Record<string, unknown> = {}
    try {
      conf = JSON.parse(stripConfChecksum(await readFile(confPath, 'utf8'))) as Record<string, unknown>
    } catch {
      conf = {}
    }
    const vendors = (conf.vendors && typeof conf.vendors === 'object' ? conf.vendors : {}) as Record<string, unknown>
    let changed = !conf.vendors
    for (const b of bundles) {
      const v = b.slice(0, -4)
      if (!(v in vendors)) {
        vendors[v] = {}
        changed = true
      }
    }
    if (changed) {
      conf.vendors = vendors
      await writeFile(confPath, withConfChecksum(JSON.stringify(conf, null, 4), (s) => createHash('md5').update(s).digest('hex')))
    }
    for (const k of KINDS) await mkdir(join(data, 'user', 'default', k), { recursive: true })
    return data
  }

  /** Lists every printer, process and filament preset the engine ships, plus imported ones. */
  async getCatalog(force = false): Promise<PresetCatalog> {
    const exe = this.requirePath()
    if (!this.catalog || force) {
      const data = await this.prepareDataDir(exe)
      const cacheFile = join(data, 'birdy-catalog.json')
      const exeStamp = `${exe}|${statSync(exe).mtimeMs}`
      let cached: { stamp: string; catalog: PresetCatalog } | null = null
      try {
        cached = JSON.parse(await readFile(cacheFile, 'utf8'))
      } catch {
        cached = null
      }
      if (!force && cached?.stamp === exeStamp && cached.catalog.machines.length) {
        this.catalog = cached.catalog
      } else {
        this.catalog = await this.buildCatalog(exe, data)
        await writeFile(cacheFile, JSON.stringify({ stamp: exeStamp, catalog: this.catalog }))
      }
    }
    await seedBuiltIns()
    return withImported(this.catalog, await listImported())
  }

  private resolved = new Map<string, Record<string, string>>()
  private probeQueue: Promise<unknown> = Promise.resolve()

  /**
   * Every setting the engine would use for these presets, read back from a tiny test slice.
   * Probes run one at a time; results are kept until a custom preset changes.
   */
  async resolve(req: ResolveRequest): Promise<Record<string, string>> {
    const catalog = await this.getCatalog()
    const machine = catalog.machines.find((m) => m.name === req.machine)
    if (!machine) throw new Error('Unknown printer.')
    const own = (list: PresetRef[]) => list.find((p) => p.user && p.name.endsWith(`@${machine.name}`))?.name
    const process = req.process && catalog.processes.some((p) => p.name === req.process) ? req.process : (own(catalog.processes) ?? pickProcess(catalog.processes, machine)?.name ?? catalog.processes.find((p) => !p.user)?.name)
    const filament = req.filament && catalog.filaments.some((f) => f.name === req.filament) ? req.filament : pickFilament(catalog.filaments, 'PLA')?.name
    if (!process || !filament) throw new Error('No process or filament preset to try this printer with.')
    const key = JSON.stringify([machine.name, process, filament])
    const hit = this.resolved.get(key)
    if (hit) return hit
    const job = this.probeQueue.then(() => this.probe({ machine: machine.name, process, filament }))
    this.probeQueue = job.catch(() => {})
    const settings = await job
    this.resolved.set(key, settings)
    return settings
  }

  private async probe(sel: Record<PresetKind, string>): Promise<Record<string, string>> {
    const exe = this.requirePath()
    const data = await this.prepareDataDir(exe)
    const dir = join(app.getPath('temp'), `birdy-probe-${randomUUID()}`)
    await mkdir(dir, { recursive: true })
    try {
      const stl = join(dir, 'probe.stl')
      await writeFile(stl, tinyStl())
      const files: string[] = []
      for (const kind of KINDS) {
        const userJson = await readImported(kind, sel[kind])
        const preset = buildJobPreset(kind, { name: sel[kind], userJson: userJson ?? undefined }, {}, ENGINE.presetVersion)
        preset.name = `Birdy probe ${kind}`
        const file = join(data, 'user', 'default', kind, `Birdy probe ${kind}.json`)
        await writeFile(file, JSON.stringify(preset, null, 2))
        files.push(file)
      }
      const logFile = join(dir, 'engine.log')
      const go = () => run(exe, [stl, '--datadir', data, '--load-settings', `${files[0]};${files[1]}`, '--load-filaments', files[2]!, '--arrange', '1', '--slice', '0', '--debug', '1', '--logfile', logFile, '--outputdir', dir], 120_000, true)
      let out = await go()
      const found = () => readdirSync(dir).find((n) => n.toLowerCase().endsWith('.gcode'))
      if (!found() && (await fixLayerReset(files[0]!, logFile))) out = await go()
      const gcode = found()
      if (!gcode) throw new Error(explainEngineError(`${out}\n${await readFile(logFile, 'utf8').catch(() => '')}`))
      const settings = parseConfigBlock(await readFile(join(dir, gcode), 'utf8'))
      if (!Object.keys(settings).length) throw new Error('The engine did not report its settings.')
      return settings
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  }

  /** A printer's build volume (mm), or null when the engine can't tell. */
  async machineBed(name: string): Promise<{ x: number; y: number; z: number } | null> {
    const cacheFile = join(dataDir(), 'birdy-beds.json')
    let cache: Record<string, { x: number; y: number; z: number }> = {}
    try {
      cache = JSON.parse(await readFile(cacheFile, 'utf8'))
    } catch {
      cache = {}
    }
    const own = (await this.getCatalog()).machines.find((m) => m.name === name)
    if (!own?.user && cache[name]) return cache[name]!
    const bed = bedFromSettings(await this.resolve({ machine: name }))
    if (bed && !own?.user) {
      cache[name] = bed
      await writeFile(cacheFile, JSON.stringify(cache)).catch(() => {})
    }
    return bed
  }

  /** Saves presets made in the printer editor. */
  async saveCustom(items: CustomPresetInput[]): Promise<PresetCatalog> {
    for (const it of items) {
      if (!KINDS.includes(it.kind) || typeof it.name !== 'string' || !it.name.trim() || it.name.length > 200 || typeof it.inherits !== 'string') throw new Error('A preset needs a name.')
      const name = it.name.trim()
      if (it.replaces && it.replaces !== name) await deleteImported(it.kind, it.replaces)
      const meta: Record<string, unknown> = { birdy_vendor: 'My printers', birdy_custom: true }
      const old = await readImported(it.kind, name)
      if (old?.birdy_vendor) meta.birdy_vendor = old.birdy_vendor
      if (it.maxNozzle !== undefined) meta.birdy_max_nozzle = it.maxNozzle
      if (it.maxBed !== undefined) meta.birdy_max_bed = it.maxBed
      if (it.heatedBed !== undefined) meta.birdy_heated_bed = it.heatedBed
      await writeImported(it.kind, customPreset(it.kind, name, it.inherits, it.values ?? {}, meta))
    }
    this.resolved.clear()
    return this.getCatalog()
  }

  async readCustom(kind: PresetKind, name: string): Promise<CustomPresetData | null> {
    const j = await readImported(kind, name)
    if (!j) return null
    const values: Record<string, string> = {}
    for (const [k, v] of Object.entries(j)) {
      if (k.startsWith('birdy_') || ['name', 'inherits', 'type', 'from', 'instantiation', 'version'].includes(k)) continue
      values[k] = Array.isArray(v) ? v.join(',') : String(v)
    }
    const n = (v: unknown) => (typeof v === 'number' ? v : undefined)
    return { kind, name, inherits: String(j.inherits ?? ''), values, maxNozzle: n(j.birdy_max_nozzle), maxBed: n(j.birdy_max_bed), heatedBed: typeof j.birdy_heated_bed === 'boolean' ? j.birdy_heated_bed : undefined }
  }

  async deleteCustom(kind: PresetKind, name: string): Promise<PresetCatalog> {
    await deleteImported(kind, name)
    this.resolved.clear()
    return this.getCatalog()
  }

  /** Runs the engine once with a deliberately unresolvable preset: it loads every bundle, logs each preset, and exits. */
  private async buildCatalog(exe: string, data: string): Promise<PresetCatalog> {
    const dir = join(jobsDir(), `catalog-${randomUUID()}`)
    await mkdir(dir, { recursive: true })
    try {
      const stl = join(dir, 'probe.stl')
      await writeFile(stl, tinyStl())
      const probe = join(dir, 'probe.json')
      await writeFile(probe, JSON.stringify({ type: 'machine', name: 'Birdy catalog probe', inherits: 'Birdy catalog probe parent', from: 'User', instantiation: 'true', version: ENGINE.presetVersion }))
      const log = join(dir, 'catalog.log')
      await run(exe, [stl, '--datadir', data, '--load-settings', probe, '--slice', '0', '--outputdir', dir, '--debug', '5', '--logfile', log], 120_000, true)
      const catalog = parseCatalogLog(await readFile(log, 'utf8'))
      if (!catalog.machines.length) throw new Error('The engine did not report any printer profiles.')
      return catalog
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  }

  /** Slices one model with the chosen presets and overrides. Only one slice runs at a time. */
  async slice(req: SliceRequest): Promise<SliceResult> {
    if (this.running) return { ok: false, error: 'A slice is already running.' }
    if (!req || !(req.data instanceof Uint8Array) || req.data.byteLength < 84 || req.data.byteLength > MAX_MODEL_BYTES) {
      return { ok: false, error: 'There is no model to slice.' }
    }
    const s = req.settings
    if (!s || ![s.machine, s.process, s.filament].every((n) => typeof n === 'string' && n.length > 0 && n.length < 300)) {
      return { ok: false, error: 'Choose a printer, a process and a filament first.' }
    }
    let exe: string
    try {
      exe = this.requirePath()
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
    const data = await this.prepareDataDir(exe)
    const jobId = randomUUID()
    const dir = join(jobsDir(), jobId)
    // The engine writes into the system temp folder: in folders under the user profile, a
    // virus scanner can hold its fresh G-code open and make the engine's final rename fail.
    const outDir = join(app.getPath('temp'), `birdy-slice-${jobId}`)
    await mkdir(dir, { recursive: true })
    await mkdir(outDir, { recursive: true })
    await pruneJobs(jobId)

    const stem = sanitizeFileName(req.name).replace(/\.[^.]+$/, '') || 'model'
    const stl = join(dir, `${stem}.stl`)
    await writeFile(stl, req.data)

    const files: Record<PresetKind, string> = { machine: '', process: '', filament: '' }
    const chosen: Record<PresetKind, string> = { machine: s.machine, process: s.process, filament: s.filament }
    const machineJson = await readImported('machine', s.machine)
    // A printer without a heated bed never gets a bed temperature.
    const overrides = machineJson?.birdy_heated_bed === false ? { ...s.overrides, bedTemp: 0 } : (s.overrides ?? {})
    for (const kind of KINDS) {
      const userJson = await readImported(kind, chosen[kind])
      const preset = buildJobPreset(kind, { name: chosen[kind], userJson: userJson ?? undefined }, overrides, ENGINE.presetVersion)
      // The engine only resolves an inheriting preset when the file is one it loaded from its user folder.
      const file = join(data, 'user', 'default', kind, `Birdy job ${kind}.json`)
      await writeFile(file, JSON.stringify(preset, null, 2))
      files[kind] = file
    }

    const args = [
      stl,
      '--datadir', data,
      '--load-settings', `${files.machine};${files.process}`,
      '--load-filaments', files.filament,
      '--arrange', '1',
      '--slice', '0',
      '--outputdir', outDir,
    ]
    let output = ''
    let failure: string | null = null
    const logFile = join(dir, 'engine.log')
    for (let attempt = 0; attempt < 2; attempt++) {
      failure = null
      try {
        output = await run(exe, [...args, '--debug', '1', '--logfile', logFile], SLICE_TIMEOUT_MS, false, (c) => (this.running = c))
      } catch (err) {
        failure = (err as Error).message
      } finally {
        this.running = null
      }
      if (!failure || attempt > 0 || !(await fixLayerReset(files.machine, logFile))) break
    }
    try {
      const produced = await finishedGcode(outDir, failure)
      if (!produced) {
        const msg = `${failure ?? output}\n${await readFile(logFile, 'utf8').catch(() => '')}`.trim()
        return { ok: false, error: explainEngineError(msg), log: msg.slice(-4000) }
      }
      const finalName = `${stem}.gcode`
      const finalPath = join(dir, finalName)
      await copyWithRetry(produced, finalPath)
      const size = statSync(finalPath).size
      return { ok: true, jobId, gcodeName: finalName, gcodeSize: size, summary: summarizeGcode(await readHeadTail(finalPath)) }
    } finally {
      await rm(outDir, { recursive: true, force: true }).catch(() => {})
    }
  }

  cancelSlice() {
    this.running?.kill()
  }

  /** Path of a finished job's G-code. Job ids are UUIDs Boaty created; nothing else resolves. */
  jobGcode(jobId: string): string {
    if (!/^[0-9a-f-]{36}$/i.test(jobId)) throw new Error('Unknown slice.')
    const dir = join(jobsDir(), jobId)
    const name = existsSync(dir) ? readdirSync(dir).find((n) => n.toLowerCase().endsWith('.gcode')) : undefined
    if (!name) throw new Error('That slice is no longer available. Slice again.')
    return join(dir, name)
  }

  async readGcode(jobId: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.jobGcode(jobId)))
  }

  /** The folder G-code is saved to (picked by the user; often a USB stick), or null. */
  gcodeFolder(): string | null {
    try {
      const f = JSON.parse(readFileSync(gcodeFolderFile(), 'utf8')).folder
      return typeof f === 'string' && f ? f : null
    } catch {
      return null
    }
  }

  private rememberGcodeFolder(folder: string) {
    try {
      writeFileSync(gcodeFolderFile(), JSON.stringify({ folder }))
    } catch {
      /* not worth failing a save over */
    }
  }

  /** Lets the user pick the folder G-code goes to. */
  async pickGcodeFolder(win: BrowserWindow): Promise<string | null> {
    const forced = process.argv.includes('--demo') ? process.env.BIRDY_DEMO_FOLDER : undefined
    const res = forced
      ? { canceled: false, filePaths: [forced] }
      : await dialog.showOpenDialog(win, {
          title: 'Choose where G-code is saved (for example your USB stick)',
          defaultPath: this.gcodeFolder() ?? undefined,
          properties: ['openDirectory', 'createDirectory'],
        })
    const dir = res.canceled ? undefined : res.filePaths[0]
    if (!dir) return null
    this.rememberGcodeFolder(dir)
    return dir
  }

  /**
   * Saves a slice's G-code. 'folder' writes straight into the chosen folder (never overwriting:
   * a number is added); 'dialog' asks where, starting in that folder.
   */
  async saveGcode(win: BrowserWindow, jobId: string, mode: 'folder' | 'dialog' = 'dialog'): Promise<SliceSaveResult> {
    let src: string
    try {
      src = this.jobGcode(jobId)
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
    const name = src.split(/[\\/]/).pop()!
    const chosen = this.gcodeFolder()
    let target: string
    if (mode === 'folder') {
      if (!chosen) return { ok: false, error: 'Choose a folder to save G-code to first.' }
      if (!existsSync(chosen)) {
        return { ok: false, error: `${chosen} isn't available. If it's a USB stick, plug it in, or choose another folder.` }
      }
      target = freeName(chosen, name)
    } else {
      let start = chosen && existsSync(chosen) ? chosen : workspaceDirs().exports
      if (start !== chosen) await mkdir(start, { recursive: true }).catch(() => (start = app.getPath('documents')))
      // Test runs (--demo with BIRDY_DEMO_SAVE) save without the dialog.
      const forced = process.argv.includes('--demo') ? process.env.BIRDY_DEMO_SAVE : undefined
      const res = forced ? { canceled: false, filePath: forced } : await dialog.showSaveDialog(win, {
        title: 'Save G-code',
        defaultPath: join(start, name),
        filters: [{ name: 'G-code', extensions: ['gcode'] }],
      })
      if (res.canceled || !res.filePath) return { ok: false, canceled: true }
      target = res.filePath
    }
    const dest = /\.(gcode|gco|g)$/i.test(target) ? target : `${target}.gcode`
    // Any failure is reported to the user, never thrown away.
    try {
      await mkdir(dirname(dest), { recursive: true })
      await copyWithRetry(src, dest)
      const [a, b] = await Promise.all([stat(src), stat(dest)])
      if (a.size !== b.size) return { ok: false, error: 'The saved file could not be verified.' }
      // Next time, start where this one went.
      this.rememberGcodeFolder(dirname(dest))
      return { ok: true, path: dest }
    } catch (err) {
      const e = err as NodeJS.ErrnoException
      const why =
        e.code === 'EPERM' || e.code === 'EACCES'
          ? 'Windows would not let Boaty write there (the folder may be protected, or the file is open in another program). Pick another folder.'
          : e.code === 'EBUSY'
            ? 'The file is open in another program. Close it or pick another name.'
            : e.code === 'ENOSPC'
              ? 'The drive is full.'
              : e.message
      return { ok: false, error: `Couldn't save the G-code: ${why}` }
    }
  }
}

/**
 * The engine's G-code, or null. If only its final rename failed ("…tmp.postprocess locked?"),
 * the post-processed file is complete and is used as-is once its end marker is confirmed.
 */
async function finishedGcode(outDir: string, failure: string | null): Promise<string | null> {
  const names = readdirSync(outDir)
  const done = names.find((n) => n.toLowerCase().endsWith('.gcode'))
  if (done) return join(outDir, done)
  if (!failure || !/Failed to rename the output G-code/i.test(failure)) return null
  const post = names.find((n) => n.toLowerCase().endsWith('.gcode.tmp.postprocess'))
  if (!post) return null
  const text = await readHeadTail(join(outDir, post))
  return /; (EXECUTABLE_BLOCK_END|CONFIG_BLOCK_END)/.test(text) ? join(outDir, post) : null
}

function gcodeFolderFile() {
  return join(app.getPath('userData'), 'gcode-folder.json')
}

/** `name` in `dir`, numbered (name (2).gcode) when a file by that name is already there. */
function freeName(dir: string, name: string): string {
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  let p = join(dir, name)
  for (let i = 2; existsSync(p) && i < 1000; i++) p = join(dir, `${stem} (${i})${ext}`)
  return p
}

/** Copies a file, retrying while another program (often a virus scanner) still holds it. */
async function copyWithRetry(src: string, dst: string) {
  let last: unknown
  for (let i = 0; i < 20; i++) {
    try {
      await copyFile(src, dst)
      const [a, b] = await Promise.all([stat(src), stat(dst)])
      if (a.size === b.size) return
      last = new Error('The copied G-code was incomplete.')
    } catch (err) {
      last = err
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw last instanceof Error ? last : new Error('Couldn’t copy the G-code.')
}

function findExeDir(root: string, depth = 0): string | null {
  if (existsSync(join(root, ENGINE.exe))) return root
  if (depth > 1) return null
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (e.isDirectory()) {
      const hit = findExeDir(join(root, e.name), depth + 1)
      if (hit) return hit
    }
  }
  return null
}

/**
 * Moves a freshly unpacked folder into place. Antivirus scanners briefly lock new files under the
 * user profile, so Windows can refuse the rename (EPERM, EBUSY, EXDEV): retry, then copy instead.
 */
async function moveDir(from: string, to: string) {
  for (let i = 0; i < 5; i++) {
    try {
      await rename(from, to)
      return
    } catch {
      await new Promise((r) => setTimeout(r, 400 * (i + 1)))
    }
  }
  await rm(to, { recursive: true, force: true })
  try {
    await cp(from, to, { recursive: true, errorOnExist: false, force: true })
  } catch (err) {
    await rm(to, { recursive: true, force: true }).catch(() => {})
    throw err
  }
}

/** Runs a program without a shell. Rejects on a non-zero exit unless `allowFail`. */
function run(exe: string, args: string[], timeoutMs: number, allowFail = false, onStart?: (c: ChildProcess) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    // Run from the temp folder: OrcaSlicer drops result logs (00000.log) into its working folder.
    const child = spawn(exe, args, { shell: false, windowsHide: true, cwd: app.getPath('temp'), stdio: ['ignore', 'pipe', 'pipe'] })
    onStart?.(child)
    let out = ''
    const add = (b: Buffer) => {
      out += b.toString('utf8')
      if (out.length > 200_000) out = out.slice(-100_000)
    }
    child.stdout.on('data', add)
    child.stderr.on('data', add)
    const timer = setTimeout(() => child.kill(), timeoutMs)
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      if (signal) reject(new Error(`The engine was stopped.${out ? `\n${out}` : ''}`))
      else if (code === 0 || allowFail) resolve(out)
      else reject(new Error(out || `The engine exited with code ${code}.`))
    })
  })
}

/**
 * Some of the engine's own printer profiles use relative extrusion without resetting the extruder
 * each layer, and the engine then refuses to slice ("Add G92 E0 to layer_gcode"). When the log says
 * so, add that reset to the job's printer file and let the caller try once more.
 */
async function fixLayerReset(machineFile: string, logFile: string): Promise<boolean> {
  const log = await readFile(logFile, 'utf8').catch(() => '')
  if (!/G92 E0/.test(log)) return false
  try {
    const m = JSON.parse(await readFile(machineFile, 'utf8')) as Record<string, unknown>
    const cur = typeof m.layer_change_gcode === 'string' ? m.layer_change_gcode : ''
    if (/^\s*G92 E0\b/m.test(cur)) return false
    m.layer_change_gcode = cur ? `G92 E0\n${cur}` : 'G92 E0'
    await writeFile(machineFile, JSON.stringify(m, null, 2))
    await rm(logFile, { force: true })
    return true
  } catch {
    return false
  }
}

function explainEngineError(out: string): string {
  if (/was stopped/.test(out)) return 'Slicing was cancelled.'
  if (/not compatible with printer/i.test(out)) return 'The engine says this process or filament is not compatible with the printer. Pick one made for it.'
  {
    const v = /got error when validate: ([^\r\n]+)/.exec(out)
    if (v) return `The engine refused these settings: ${v[1]}`
  }
  if (/can not resolve preset|not found in the loaded bundle/i.test(out)) return 'The engine could not find one of the chosen presets. Pick them again or refresh the preset list.'
  if (/outside|out of (the )?(bed|plate)|exceeds/i.test(out)) return 'The model does not fit this printer’s build volume.'
  if (/empty layer|nothing to print|no object/i.test(out)) return 'The engine found nothing to print in this model.'
  const last = out.trim().split(/\r?\n/).filter(Boolean).pop()
  return last ? `Slicing failed: ${last.replace(/^.*?::operator\(\):\s*/, '')}` : 'Slicing failed.'
}

/** First and last part of a G-code file: summary comments live in the header and the config block. */
async function readHeadTail(path: string): Promise<string> {
  const fh = await open(path, 'r')
  try {
    const { size } = await fh.stat()
    const head = Buffer.alloc(Math.min(size, 512 * 1024))
    await fh.read(head, 0, head.length, 0)
    if (size <= head.length) return head.toString('utf8')
    const tailLen = Math.min(size - head.length, 768 * 1024)
    const tail = Buffer.alloc(tailLen)
    await fh.read(tail, 0, tailLen, size - tailLen)
    return `${head.toString('utf8')}\n${tail.toString('utf8')}`
  } finally {
    await fh.close()
  }
}

/** Keeps the five most recent slice jobs. */
async function pruneJobs(keep: string) {
  try {
    const entries = readdirSync(jobsDir(), { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== keep && /^[0-9a-f-]{36}$/i.test(e.name))
      .map((e) => ({ name: e.name, t: statSync(join(jobsDir(), e.name)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
    for (const e of entries.slice(4)) await rm(join(jobsDir(), e.name), { recursive: true, force: true })
  } catch {
    /* nothing to prune */
  }
}

/** A 1 mm binary STL cube, used only to start the engine for the catalog run. */
function tinyStl(): Buffer {
  const v = [
    [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
  ]
  const tris = [
    [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4],
    [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7],
  ]
  const buf = Buffer.alloc(84 + tris.length * 50)
  buf.writeUInt32LE(tris.length, 80)
  tris.forEach((t, i) => {
    const o = 84 + i * 50 + 12
    t.forEach((vi, j) => v[vi]!.forEach((c, k) => buf.writeFloatLE(c, o + j * 12 + k * 4)))
  })
  return buf
}

// ---- Imported presets ------------------------------------------------------

const importedFile = (kind: PresetKind, name: string) => join(importedDir(), kind, `${sanitizeFileName(name)}.json`)

export async function readImported(kind: PresetKind, name: string): Promise<Record<string, unknown> | null> {
  try {
    const json = JSON.parse(await readFile(importedFile(kind, name), 'utf8')) as Record<string, unknown>
    return json.name === name ? json : null
  } catch {
    return null
  }
}

export async function writeImported(kind: PresetKind, json: Record<string, unknown>) {
  const name = String(json.name ?? '')
  if (!name) return
  await mkdir(join(importedDir(), kind), { recursive: true })
  await writeFile(importedFile(kind, name), JSON.stringify({ ...json, type: kind }, null, 2))
}

async function deleteImported(kind: PresetKind, name: string) {
  const j = await readImported(kind, name)
  if (j && (j.birdy_custom === true || j.birdy_builtin === true)) await rm(importedFile(kind, name), { force: true })
}

/** Writes the presets Boaty ships (Anycubic Mega X…) once; later edits by the user are kept. */
let seeded = false
async function seedBuiltIns() {
  if (seeded) return
  seeded = true
  for (const { kind, json } of BUILTIN_PRESETS) {
    if (!(await readImported(kind, String(json.name)))) await writeImported(kind, json)
  }
}

async function listImported(): Promise<PresetRef[]> {
  const out: PresetRef[] = []
  for (const kind of KINDS) {
    const dir = join(importedDir(), kind)
    if (!existsSync(dir)) continue
    for (const f of await readdir(dir)) {
      if (!f.endsWith('.json')) continue
      try {
        const j = JSON.parse(await readFile(join(dir, f), 'utf8')) as Record<string, unknown>
        if (typeof j.name === 'string')
          out.push({
            name: j.name,
            kind,
            vendor: String(j.birdy_vendor ?? 'Imported'),
            user: true,
            base: typeof j.inherits === 'string' ? j.inherits : undefined,
            ...(j.birdy_custom === true || j.birdy_builtin === true ? { custom: true } : {}),
            ...(typeof j.birdy_max_nozzle === 'number' ? { maxNozzle: j.birdy_max_nozzle } : {}),
            ...(typeof j.birdy_max_bed === 'number' ? { maxBed: j.birdy_max_bed } : {}),
            ...(typeof j.birdy_heated_bed === 'boolean' ? { heatedBed: j.birdy_heated_bed } : {}),
          })
      } catch {
        /* skip unreadable files */
      }
    }
  }
  return out
}

function withImported(c: PresetCatalog, imported: PresetRef[]): PresetCatalog {
  const pick = (k: PresetKind) => imported.filter((p) => p.kind === k)
  return {
    vendors: c.vendors,
    machines: [...pick('machine'), ...c.machines],
    processes: [...pick('process'), ...c.processes],
    filaments: [...pick('filament'), ...c.filaments],
  }
}
