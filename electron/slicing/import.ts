import { existsSync, readdirSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { ImportCandidate, ImportResult, ImportSource, PresetCatalog, PresetKind, PresetRef, SliceOverrides, SliceSettings } from '../../src/types/slicing'
import { writeImported } from './engine'
import {
  matchMachine,
  parseIni,
  pickFilament,
  pickProcess,
  resolveIniPreset,
  settingNumber,
  stripConfChecksum,
  type IniSections,
} from './presets'

/**
 * Reads the printer, process and filament the user last used in another slicer and turns them
 * into Boaty slice settings. Only reads those slicers' own settings folders; never writes to them.
 */
const appData = () => process.env['APPDATA'] ?? ''

const SOURCES: Record<ImportSource, { name: string; dir: () => string }> = {
  orca: { name: 'OrcaSlicer', dir: () => join(appData(), 'OrcaSlicer') },
  bambu: { name: 'Bambu Studio', dir: () => join(appData(), 'BambuStudio') },
  prusa: { name: 'PrusaSlicer', dir: () => join(appData(), 'PrusaSlicer') },
  cura: { name: 'UltiMaker Cura', dir: () => join(appData(), 'cura') },
}

const KINDS: PresetKind[] = ['machine', 'process', 'filament']

export function importCandidates(): ImportCandidate[] {
  return (Object.keys(SOURCES) as ImportSource[]).map((source) => {
    const s = SOURCES[source]
    const dir = s.dir()
    const found = !!appData() && existsSync(dir)
    return { source, name: s.name, found, detail: found ? dir : 'No settings found on this PC' }
  })
}

export async function importSettings(source: ImportSource, catalog: PresetCatalog): Promise<ImportResult> {
  const s = SOURCES[source]
  if (!s) return { ok: false, source, importedPresets: 0, notes: [], error: 'Unknown slicer.' }
  const dir = s.dir()
  if (!appData() || !existsSync(dir)) return { ok: false, source, importedPresets: 0, notes: [], error: `${s.name} settings were not found on this PC.` }
  try {
    if (source === 'orca') return await importOrcaLike(source, dir, 'OrcaSlicer.conf', catalog)
    if (source === 'bambu') return await importOrcaLike(source, dir, 'BambuStudio.conf', catalog)
    if (source === 'prusa') return await importPrusa(dir, catalog)
    return await importCura(dir, catalog)
  } catch (err) {
    return { ok: false, source, importedPresets: 0, notes: [], error: `Couldn't read ${s.name} settings: ${(err as Error).message}` }
  }
}

const has = (list: PresetRef[], name: unknown): name is string => typeof name === 'string' && list.some((p) => p.name === name)
const listOf = (c: PresetCatalog, k: PresetKind) => (k === 'machine' ? c.machines : k === 'process' ? c.processes : c.filaments)

function jsonFiles(dir: string, depth = 0): string[] {
  if (!existsSync(dir) || depth > 2) return []
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...jsonFiles(p, depth + 1))
    else if (e.name.toLowerCase().endsWith('.json') && statSync(p).size < 2_000_000) out.push(p)
  }
  return out
}

/** OrcaSlicer and Bambu Studio share a format: a JSON app config and JSON user presets. */
async function importOrcaLike(source: ImportSource, dir: string, confName: string, catalog: PresetCatalog): Promise<ImportResult> {
  const notes: string[] = []
  const imported: Record<PresetKind, Set<string>> = { machine: new Set(), process: new Set(), filament: new Set() }
  let count = 0

  const userRoot = join(dir, 'user')
  const accounts = existsSync(userRoot) ? readdirSync(userRoot, { withFileTypes: true }).filter((e) => e.isDirectory()) : []
  for (const acct of accounts) {
    for (const kind of KINDS) {
      for (const file of jsonFiles(join(userRoot, acct.name, kind))) {
        let j: Record<string, unknown>
        try {
          j = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
        } catch {
          continue
        }
        const name = typeof j.name === 'string' && j.name ? j.name : basename(file, '.json')
        if (imported[kind].has(name)) continue
        const parent = typeof j.inherits === 'string' ? listOf(catalog, kind).find((p) => p.name === j.inherits) : undefined
        if (j.inherits && !parent) notes.push(`“${name}” is based on “${String(j.inherits)}”, which Boaty’s engine doesn’t have.`)
        await writeImported(kind, { ...j, name, birdy_vendor: parent?.vendor ?? 'Imported', birdy_source: source })
        imported[kind].add(name)
        count++
      }
    }
  }

  const known = (k: PresetKind, n: unknown) => has(listOf(catalog, k), n) || (typeof n === 'string' && imported[k].has(n))
  let conf: Record<string, unknown> = {}
  const confPath = join(dir, confName)
  if (existsSync(confPath)) conf = JSON.parse(stripConfChecksum(await readFile(confPath, 'utf8'))) as Record<string, unknown>
  const p = (conf.presets ?? {}) as Record<string, unknown>
  const filaments = Array.isArray(p.filaments) ? p.filaments : [p.filament]
  const want: Record<PresetKind, unknown> = { machine: p.machine, process: p.process ?? p.print, filament: filaments[0] }

  const settings: Partial<SliceSettings> = {}
  for (const k of KINDS) {
    if (known(k, want[k])) settings[k] = want[k] as string
    else if (typeof want[k] === 'string' && want[k]) notes.push(`The selected ${k} “${want[k]}” isn’t available in Boaty’s engine.`)
  }
  const machine = catalog.machines.find((m) => m.name === settings.machine) ?? (settings.machine ? { name: settings.machine, vendor: 'Imported', kind: 'machine' as const } : undefined)
  if (settings.machine && !settings.process) settings.process = pickProcess(catalog.processes, machine)?.name
  if (settings.machine && !settings.filament) settings.filament = pickFilament(catalog.filaments, 'PLA')?.name
  if (!settings.machine) notes.push('No printer was selected there, so pick one below.')
  return { ok: true, source, settings, importedPresets: count, notes }
}

// ---- PrusaSlicer ------------------------------------------------------------

async function importPrusa(dir: string, catalog: PresetCatalog): Promise<ImportResult> {
  const notes: string[] = []
  const app = parseIni(await readFile(join(dir, 'PrusaSlicer.ini'), 'utf8'))
  const sel = app['presets'] ?? {}
  const vendorDir = join(dir, 'vendor')
  const bundles: IniSections[] = []
  if (existsSync(vendorDir)) {
    for (const f of readdirSync(vendorDir).filter((n) => n.toLowerCase().endsWith('.ini'))) {
      bundles.push(parseIni(await readFile(join(vendorDir, f), 'utf8')))
    }
  }
  const load = async (type: 'printer' | 'print' | 'filament', name: string | undefined) => {
    if (!name || name.startsWith('- default')) return null
    const userFile = join(dir, type, `${name}.ini`)
    let own: Record<string, string> | null = null
    if (existsSync(userFile)) own = parseIni(await readFile(userFile, 'utf8'))['']!
    const parentName = own ? own.inherits : name
    let base: Record<string, string> | null = null
    if (parentName) for (const b of bundles) if ((base = resolveIniPreset(b, type, parentName))) break
    if (!own && !base) return null
    return { ...(base ?? {}), ...(own ?? {}) }
  }
  const printer = await load('printer', sel.printer)
  const print = await load('print', sel.print)
  const filament = await load('filament', sel.filament)
  if (!printer) return { ok: true, source: 'prusa', importedPresets: 0, notes: ['PrusaSlicer is still on its default printer, so there was nothing to import. Pick a printer below.'] }

  const nozzle = String(settingNumber(printer.nozzle_diameter) ?? 0.4)
  const printerName = sel.printer!
  const settings: Partial<SliceSettings> = {}
  let imported = 0
  let machine = matchMachine(catalog.machines, printerName, nozzle) ?? (printer.printer_model ? matchMachine(catalog.machines, printer.printer_model, nozzle) : null)
  if (machine) {
    settings.machine = machine.name
  } else {
    const made = await customMachine(catalog, `${printerName} (PrusaSlicer)`, printer.bed_shape, printer.max_print_height, nozzle, printer.gcode_flavor, 'prusa')
    settings.machine = made.name
    machine = made
    imported++
    notes.push(`Boaty’s engine has no built-in profile for “${printerName}”, so it made one from your bed size and nozzle. Check its start G-code before printing.`)
  }
  const o = overridesFromPrusa(print, filament)
  settings.process = (pickProcess(catalog.processes, machine, o.layerHeight) ?? anyProcess(catalog, machine))?.name
  settings.filament = pickFilament(catalog.filaments, filament?.filament_type)?.name
  settings.overrides = o
  return { ok: true, source: 'prusa', settings, importedPresets: imported, notes }
}

function overridesFromPrusa(print: Record<string, string> | null, filament: Record<string, string> | null): SliceOverrides {
  const o: SliceOverrides = {}
  if (print) {
    o.layerHeight = settingNumber(print.layer_height)
    o.infill = settingNumber(print.fill_density)
    if (print.fill_density && !print.fill_density.includes('%') && o.infill !== undefined && o.infill <= 1) o.infill *= 100
    o.walls = settingNumber(print.perimeters)
    if (print.support_material !== undefined) o.supports = print.support_material === '1' ? (print.support_material_style === 'organic' ? 'tree' : 'normal') : 'off'
    const brim = settingNumber(print.brim_width)
    if (brim !== undefined) {
      o.brim = brim > 0
      if (brim > 0) o.brimWidth = brim
    }
  }
  if (filament) {
    o.nozzleTemp = settingNumber(filament.temperature)
    o.bedTemp = settingNumber(filament.bed_temperature)
  }
  return clean(o)
}

// ---- UltiMaker Cura -----------------------------------------------------------

async function importCura(root: string, catalog: PresetCatalog): Promise<ImportResult> {
  const versions = readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^\d+\.\d+/.test(e.name))
    .map((e) => e.name)
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
  const dir = versions[0] ? join(root, versions[0]) : null
  if (!dir) return { ok: false, source: 'cura', importedPresets: 0, notes: [], error: 'No Cura settings folder was found.' }
  const machinesDir = join(dir, 'machine_instances')
  const globals = existsSync(machinesDir) ? readdirSync(machinesDir).filter((n) => n.endsWith('.global.cfg')) : []
  if (!globals.length) return { ok: true, source: 'cura', importedPresets: 0, notes: [`Cura ${versions[0]} has no printers set up, so there was nothing to import.`] }

  const cfg = existsSync(join(dir, 'cura.cfg')) ? parseIni(await readFile(join(dir, 'cura.cfg'), 'utf8')) : {}
  const active = cfg['general']?.active_machine ?? cfg['cura']?.active_machine
  const file = globals.find((g) => decodeURIComponent(g.replace(/\.global\.cfg$/, '')) === active) ?? globals[0]!
  const g = parseIni(await readFile(join(machinesDir, file), 'utf8'))
  const name = g['general']?.name ?? decodeURIComponent(file.replace(/\.global\.cfg$/, ''))
  const containers = Object.values(g['containers'] ?? {})
  const readContainer = async (id: string) => {
    for (const sub of ['definition_changes', 'user', 'quality_changes']) {
      for (const fn of [`${encodeURIComponent(id)}.inst.cfg`, `${id}.inst.cfg`]) {
        const p = join(dir, sub, fn)
        if (existsSync(p)) return parseIni(await readFile(p, 'utf8'))['values'] ?? {}
      }
    }
    return {}
  }
  const values: Record<string, string> = {}
  // Containers are listed top-most first; apply from the bottom up so user changes win.
  for (const id of [...containers].reverse()) Object.assign(values, await readContainer(id))
  const extrudersDir = join(dir, 'extruders')
  if (existsSync(extrudersDir)) {
    for (const f of readdirSync(extrudersDir).filter((n) => n.endsWith('.extruder.cfg'))) {
      const e = parseIni(await readFile(join(extrudersDir, f), 'utf8'))
      if (e['metadata']?.machine !== decodeURIComponent(file.replace(/\.global\.cfg$/, '')) && e['metadata']?.machine !== name) continue
      for (const id of Object.values(e['containers'] ?? {}).reverse()) Object.assign(values, await readContainer(id))
    }
  }

  const notes: string[] = []
  const nozzle = String(settingNumber(values.machine_nozzle_size) ?? 0.4)
  const definition = containers[containers.length - 1] ?? ''
  let machine = matchMachine(catalog.machines, name, nozzle) ?? matchMachine(catalog.machines, definition.replace(/_/g, ' '), nozzle)
  const settings: Partial<SliceSettings> = {}
  let imported = 0
  if (machine) settings.machine = machine.name
  else {
    const w = settingNumber(values.machine_width)
    const d = settingNumber(values.machine_depth)
    const bed = w && d ? `0x0,${w}x0,${w}x${d},0x${d}` : undefined
    machine = await customMachine(catalog, `${name} (Cura)`, bed, values.machine_height, nozzle, values.machine_gcode_flavor?.toLowerCase().includes('klipper') ? 'klipper' : 'marlin', 'cura')
    settings.machine = machine.name
    imported++
    notes.push(`Boaty’s engine has no built-in profile for “${name}”, so it made one from your bed size and nozzle. Check its start G-code before printing.`)
  }
  const o: SliceOverrides = clean({
    layerHeight: settingNumber(values.layer_height),
    infill: settingNumber(values.infill_sparse_density),
    walls: settingNumber(values.wall_line_count),
    supports: values.support_enable === undefined ? undefined : values.support_enable === 'True' ? (values.support_structure === 'tree' ? 'tree' : 'normal') : 'off',
    brim: values.adhesion_type === undefined ? undefined : values.adhesion_type === 'brim',
    brimWidth: settingNumber(values.brim_width),
    nozzleTemp: settingNumber(values.material_print_temperature),
    bedTemp: settingNumber(values.material_bed_temperature),
  })
  settings.process = (pickProcess(catalog.processes, machine, o.layerHeight) ?? anyProcess(catalog, machine))?.name
  settings.filament = pickFilament(catalog.filaments, 'PLA')?.name
  settings.overrides = o
  if (o.nozzleTemp === undefined) notes.push('Cura keeps temperatures in its material profiles, so the filament uses Boaty’s generic PLA temperatures.')
  return { ok: true, source: 'cura', settings, importedPresets: imported, notes }
}

// ---- Shared ------------------------------------------------------------------

/** A printer profile built on the engine's generic printer, sized to the user's bed and nozzle. */
async function customMachine(
  catalog: PresetCatalog,
  name: string,
  bedShape: string | undefined,
  height: string | undefined,
  nozzle: string,
  flavor: string | undefined,
  source: ImportSource,
): Promise<PresetRef> {
  const family = flavor && /klipper/i.test(flavor) ? 'MyKlipper' : 'MyMarlin'
  const base =
    catalog.machines.find((m) => m.name === `${family} ${nozzle} nozzle`) ??
    catalog.machines.find((m) => m.name === `${family} 0.4 nozzle`) ??
    catalog.machines.find((m) => m.vendor === 'Custom')
  const area = (bedShape ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^-?\d+(\.\d+)?x-?\d+(\.\d+)?$/.test(s))
  const json: Record<string, unknown> = {
    name,
    inherits: base?.name ?? '',
    nozzle_diameter: [nozzle],
    birdy_vendor: 'Custom',
    birdy_source: source,
  }
  if (area.length >= 3) json.printable_area = area
  const h = settingNumber(height)
  if (h) json.printable_height = String(h)
  await writeImported('machine', json)
  return { name, kind: 'machine', vendor: 'Custom', user: true, base: base?.name }
}

function anyProcess(catalog: PresetCatalog, machine: PresetRef | undefined) {
  const vendor = machine?.user ? catalog.machines.find((m) => m.name === machine.base)?.vendor : machine?.vendor
  return catalog.processes.find((p) => p.vendor === vendor && /0\.20mm Standard/.test(p.name)) ?? catalog.processes.find((p) => p.vendor === vendor) ?? null
}

function clean(o: SliceOverrides): SliceOverrides {
  const out: SliceOverrides = {}
  for (const [k, v] of Object.entries(o)) if (v !== undefined && !(typeof v === 'number' && !Number.isFinite(v))) (out as Record<string, unknown>)[k] = v
  return out
}
