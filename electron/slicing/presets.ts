// Pure helpers for the OrcaSlicer engine: catalog parsing, preset matching, job presets and
// G-code summaries. No Electron or file-system imports, so tests can run them directly.
import type { BrimType, PresetCatalog, PresetKind, PresetRef, SliceOverrides, SliceSummary, SupportMode } from '../../src/types/slicing'

const KINDS: readonly PresetKind[] = ['machine', 'process', 'filament']

/**
 * Builds the preset catalog from an OrcaSlicer debug log. With `--debug 5` the engine logs one
 * line per system preset it loads, e.g.
 * `commit_vendor_preset, got preset <name>, filament_id <id>, from <datadir>\system/<Vendor>/<kind>/<file>.json`
 */
export function parseCatalogLog(log: string): PresetCatalog {
  const seen = new Set<string>()
  const lists: Record<PresetKind, PresetRef[]> = { machine: [], process: [], filament: [] }
  const vendors = new Set<string>()
  const re = /got preset (.+?), filament_id [^,]*, from (.+)$/gm
  for (let m = re.exec(log); m; m = re.exec(log)) {
    const name = m[1]!.trim()
    const parts = m[2]!.trim().split(/[\\/]/)
    const sys = parts.lastIndexOf('system')
    if (sys < 0 || parts.length < sys + 4) continue
    const vendor = parts[sys + 1]!
    const kind = parts[sys + 2] as PresetKind
    if (!KINDS.includes(kind)) continue
    const key = `${kind}\u0000${name}`
    if (seen.has(key)) continue
    seen.add(key)
    lists[kind].push({ name, vendor, kind })
    if (kind === 'machine') vendors.add(vendor)
  }
  const byName = (a: PresetRef, b: PresetRef) => a.name.localeCompare(b.name, undefined, { numeric: true })
  return {
    vendors: [...vendors].sort((a, b) => a.localeCompare(b)),
    machines: lists.machine.sort(byName),
    processes: lists.process.sort(byName),
    filaments: lists.filament.sort(byName),
  }
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/bambu\s*lab/g, 'bbl')
    .replace(/\bcarbon\b/g, 'c')
    .replace(/[^a-z0-9]/g, '')

const nozzleOf = (s: string) => /(\d+(?:\.\d+)?)\s*nozzle/i.exec(s)?.[1] ?? null
const withoutNozzle = (s: string) => s.replace(/\s*\d+(?:\.\d+)?\s*nozzle/i, '').trim()

/**
 * Whether a process or filament preset is meant for a machine. OrcaSlicer names them
 * `<setting> @<printer>[ <nozzle> nozzle]`; generic filaments end in `@System`.
 * This is a name heuristic: the UI still lets people pick any preset.
 */
export function fitsMachine(preset: PresetRef, machine: PresetRef | undefined): boolean {
  if (!machine) return true
  // A user's own preset made for this exact printer ("PLA @My Printer").
  if (preset.user && preset.name.endsWith(`@${machine.name}`)) return true
  if (machine.user && machine.base) machine = { ...machine, name: machine.base }
  const at = preset.name.lastIndexOf('@')
  if (at < 0) return preset.vendor === machine.vendor || preset.vendor === 'OrcaFilamentLibrary'
  const target = preset.name.slice(at + 1).trim()
  if (/^system$/i.test(target)) return true
  if (preset.vendor !== machine.vendor && preset.vendor !== 'OrcaFilamentLibrary') return false
  const mNozzle = nozzleOf(machine.name) ?? '0.4'
  const pNozzle = nozzleOf(target) ?? '0.4'
  if (Number(mNozzle) !== Number(pNozzle)) return false
  const t = norm(withoutNozzle(target))
  const mm = norm(withoutNozzle(machine.name))
  return t.length > 0 && (mm.includes(t) || t.includes(mm))
}

const SUPPORT_STYLES: Record<Exclude<SupportMode, 'off'>, { type: string; style?: string }> = {
  normal: { type: 'normal(auto)', style: 'default' },
  snug: { type: 'normal(auto)', style: 'snug' },
  tree: { type: 'tree(auto)', style: 'default' },
  'tree-slim': { type: 'tree(auto)', style: 'tree_slim' },
  'tree-strong': { type: 'tree(auto)', style: 'tree_strong' },
  'tree-hybrid': { type: 'tree(auto)', style: 'tree_hybrid' },
  organic: { type: 'tree(auto)', style: 'organic' },
}
const BRIM_TYPES: Record<BrimType, string> = { none: 'no_brim', outer: 'outer_only', inner: 'inner_only', both: 'outer_and_inner', auto: 'auto_brim', ears: 'brim_ears' }
/** Engine setting keys the "All settings" window may set. */
export const EXTRA_KEY = /^[a-z][a-z0-9_]{0,79}$/
/** Keys that name or tie presets together, which a job preset sets itself. */
export const EXTRA_BLOCKED = new Set([
  'name', 'inherits', 'inherits_group', 'type', 'from', 'instantiation', 'version', 'setting_id', 'base_id', 'filament_id', 'user_id',
  'print_settings_id', 'printer_settings_id', 'filament_settings_id', 'compatible_printers', 'compatible_printers_condition', 'compatible_prints',
  'compatible_prints_condition', 'post_process', 'printer_model', 'printer_variant', 'default_print_profile', 'default_filament_profile',
])

const pct = (n: number) => `${Math.round(n)}%`
const num = (n: number) => String(Math.round(n * 1000) / 1000)

/** Orca setting keys for each override, as the string values its preset JSON uses. */
export function overrideKeys(kind: PresetKind, o: SliceOverrides): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}
  // Settings from the "All settings" window go in every job preset (the engine reads each key from
  // the preset it belongs to); the named settings below then win over them.
  for (const [k, v] of Object.entries(o.extra ?? {})) if (EXTRA_KEY.test(k) && !EXTRA_BLOCKED.has(k) && typeof v === 'string') out[k] = v
  if (kind === 'process') {
    if (o.layerHeight !== undefined) out.layer_height = num(o.layerHeight)
    if (o.infill !== undefined) out.sparse_infill_density = pct(o.infill)
    if (o.walls !== undefined) out.wall_loops = String(Math.round(o.walls))
    if (o.supports !== undefined) {
      out.enable_support = o.supports === 'off' ? '0' : '1'
      if (o.supports !== 'off') {
        const s = SUPPORT_STYLES[o.supports]
        out.support_type = s.type
        if (s.style) out.support_style = s.style
      }
    }
    if (o.supportsPlateOnly !== undefined) out.support_on_build_plate_only = o.supportsPlateOnly ? '1' : '0'
    if (o.supportAngle !== undefined) out.support_threshold_angle = String(Math.round(o.supportAngle))
    const brim = o.brimType ?? (o.brim === undefined ? undefined : o.brim ? 'outer' : 'none')
    if (brim !== undefined) {
      out.brim_type = BRIM_TYPES[brim]
      if (brim !== 'none' && o.brimWidth !== undefined) out.brim_width = num(o.brimWidth)
    }
    if (o.brimGap !== undefined) out.brim_object_gap = num(o.brimGap)
    if (o.skirt !== undefined) {
      out.skirt_loops = o.skirt === 'off' ? '0' : String(Math.max(1, Math.round(o.skirtLoops ?? 1)))
      out.draft_shield = o.skirt === 'shield' ? 'enabled' : 'disabled'
    }
    if (o.skirt !== 'off') {
      if (o.skirtDistance !== undefined) out.skirt_distance = num(o.skirtDistance)
      if (o.skirtHeight !== undefined) out.skirt_height = String(Math.max(1, Math.round(o.skirtHeight)))
    }
    if (o.raftLayers !== undefined) out.raft_layers = String(Math.max(0, Math.round(o.raftLayers)))
    const speed = (keys: string[], v: number | undefined) => {
      if (v !== undefined && v > 0) for (const k of keys) out[k] = num(v)
    }
    speed(['outer_wall_speed'], o.speedOuterWall)
    speed(['inner_wall_speed'], o.speedInnerWall)
    speed(['sparse_infill_speed', 'internal_solid_infill_speed'], o.speedInfill)
    speed(['top_surface_speed'], o.speedTop)
    speed(['initial_layer_speed', 'initial_layer_infill_speed'], o.speedFirstLayer)
    speed(['travel_speed'], o.speedTravel)
    speed(
      ['default_acceleration', 'outer_wall_acceleration', 'inner_wall_acceleration', 'top_surface_acceleration', 'sparse_infill_acceleration', 'internal_solid_infill_acceleration', 'initial_layer_acceleration', 'travel_acceleration'],
      o.acceleration,
    )
  } else if (kind === 'filament') {
    const p = (n: number) => [String(Math.max(0, Math.min(100, Math.round(n))))]
    if (o.coolingOff) {
      // Every fan that blows on the part: normal cooling, the overhang/bridge boost and the side fan.
      out.fan_min_speed = ['0']
      out.fan_max_speed = ['0']
      out.enable_overhang_bridge_fan = ['0']
      out.overhang_fan_speed = ['0']
      out.internal_bridge_fan_speed = ['-1']
      out.support_material_interface_fan_speed = ['-1']
      out.ironing_fan_speed = ['-1']
      out.additional_cooling_fan_speed = ['0']
    } else {
      if (o.fanMin !== undefined) out.fan_min_speed = p(o.fanMin)
      if (o.fanMax !== undefined) out.fan_max_speed = p(o.fanMax)
      if (o.overhangFan !== undefined) {
        out.enable_overhang_bridge_fan = [o.overhangFan > 0 ? '1' : '0']
        out.overhang_fan_speed = p(o.overhangFan)
      }
      if (o.auxFan !== undefined) out.additional_cooling_fan_speed = p(o.auxFan)
    }
    if (o.fanOffLayers !== undefined) out.close_fan_the_first_x_layers = [String(Math.max(0, Math.round(o.fanOffLayers)))]
    if (o.fanFullLayer !== undefined) out.full_fan_speed_layer = [String(Math.max(0, Math.round(o.fanFullLayer)))]
    if (o.exhaustFan !== undefined) {
      out.activate_air_filtration = [o.exhaustFan > 0 ? '1' : '0']
      out.during_print_exhaust_fan_speed = p(o.exhaustFan)
    }
    if (o.nozzleTemp !== undefined) {
      out.nozzle_temperature = [num(o.nozzleTemp)]
      out.nozzle_temperature_initial_layer = [num(o.nozzleTemp)]
    }
    if (o.bedTemp !== undefined) {
      const t = [num(o.bedTemp)]
      for (const plate of ['hot_plate_temp', 'textured_plate_temp', 'cool_plate_temp', 'eng_plate_temp', 'textured_cool_plate_temp', 'supertack_plate_temp']) {
        out[plate] = t
        out[`${plate}_initial_layer`] = t
      }
    }
  }
  return out
}

/**
 * The preset file Boaty hands the engine for one slice. It inherits the chosen system preset
 * (or carries an imported user preset's own settings) and adds the overrides on top.
 */
export function buildJobPreset(
  kind: PresetKind,
  base: { name: string; userJson?: Record<string, unknown> },
  overrides: SliceOverrides,
  engineVersion: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = base.userJson ? { ...base.userJson } : { inherits: base.name }
  for (const k of Object.keys(out)) {
    // post_process names programs the engine would run after slicing; Boaty never lets it.
    if (k.startsWith('birdy_') || ['setting_id', 'base_id', 'user_id', 'updated_time', 'is_custom_defined', 'post_process'].includes(k)) delete out[k]
  }
  if (typeof out.inherits !== 'string') out.inherits = ''
  Object.assign(out, overrideKeys(kind, overrides))
  // The engine refuses a process or filament made for another printer. People pick those on
  // purpose ("Show presets made for other printers"), and a custom printer's own presets name
  // a printer it only inherits from, so Boaty lifts the restriction for its own job files.
  if (kind !== 'machine') {
    out.compatible_printers = []
    out.compatible_printers_condition = ''
  }
  if (kind === 'filament') {
    out.compatible_prints = []
    out.compatible_prints_condition = ''
  }
  out.type = kind
  out.name = `Birdy job ${kind}`
  out.from = 'User'
  out.instantiation = 'true'
  out.version = engineVersion
  return out
}

/** "1d 2h 3m 4s" → seconds. */
export function parseDuration(s: string): number | null {
  let total = 0
  let any = false
  for (const m of s.matchAll(/(\d+(?:\.\d+)?)\s*([dhms])/g)) {
    any = true
    total += Number(m[1]) * { d: 86400, h: 3600, m: 60, s: 1 }[m[2] as 'd' | 'h' | 'm' | 's']
  }
  return any ? Math.round(total) : null
}

/** Reads print time, filament use, layer count and bed shape from G-code comments. */
export function summarizeGcode(text: string): SliceSummary {
  const line = (re: RegExp) => re.exec(text)?.[1]?.trim() ?? null
  const time =
    line(/^; total estimated time: ([^;\r\n]+)/m) ??
    line(/^; model printing time: [^;\r\n]*; total estimated time: ([^;\r\n]+)/m) ??
    line(/^; estimated printing time \(normal mode\) = ([^\r\n]+)/m)
  const numOrNull = (v: string | null) => (v !== null && Number.isFinite(Number(v)) ? Number(v) : null)
  const area = line(/^; printable_area = ([^\r\n]+)/m)
  const bed = area
    ? area
        .split(',')
        .map((p) => p.split('x').map(Number) as [number, number])
        .filter((p) => p.length === 2 && p.every(Number.isFinite))
    : null
  return {
    printTime: time,
    printSeconds: time ? parseDuration(time) : null,
    filamentMm: numOrNull(line(/^; filament used \[mm\] = ([\d.]+)/m)),
    filamentG: numOrNull(line(/^; (?:total )?filament used \[g\] = ([\d.]+)/m)),
    layers: numOrNull(line(/^; total layer number: (\d+)/m)),
    printerModel: line(/^; printer_model = ([^\r\n]+)/m),
    bed: bed && bed.length >= 3 ? bed : null,
    bedHeight: numOrNull(line(/^; printable_height = ([\d.]+)/m)),
    maxZ: numOrNull(line(/^; max_z_height: ([\d.]+)/m)),
  }
}

/** OrcaSlicer.conf is JSON followed by an MD5 line over the JSON text. */
export function withConfChecksum(json: string, md5Hex: (s: string) => string): string {
  const body = json.replace(/\n+$/, '')
  return `${body}\n# MD5 checksum ${md5Hex(body).toUpperCase()}\n`
}

export function stripConfChecksum(text: string): string {
  const i = text.lastIndexOf('# MD5 checksum')
  return (i >= 0 ? text.slice(0, i) : text).trim()
}

// ---- Importing settings from other slicers ---------------------------------

export type IniSections = Record<string, Record<string, string>>

/** Parses INI text. Keys before the first section go under "". */
export function parseIni(text: string): IniSections {
  const out: IniSections = { '': {} }
  let cur = out['']!
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith(';')) continue
    const sec = /^\[(.+)\]$/.exec(line)
    if (sec) {
      cur = out[sec[1]!] ??= {}
      continue
    }
    const eq = line.indexOf('=')
    if (eq > 0) cur[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
  }
  return out
}

/**
 * Resolves a PrusaSlicer vendor-bundle section such as `[printer:Original Prusa MK4]` through its
 * `inherits = *parent*; *other*` chain. Later parents override earlier ones; the section wins last.
 */
export function resolveIniPreset(bundle: IniSections, type: string, name: string, depth = 0): Record<string, string> | null {
  const own = bundle[`${type}:${name}`]
  if (!own || depth > 12) return null
  const merged: Record<string, string> = {}
  for (const parent of (own.inherits ?? '').split(';').map((s) => s.trim()).filter(Boolean)) {
    Object.assign(merged, resolveIniPreset(bundle, type, parent, depth + 1) ?? {})
  }
  Object.assign(merged, own)
  delete merged.inherits
  return merged
}

/** Finds the engine's built-in machine preset for a printer named in another slicer. */
export function matchMachine(machines: PresetRef[], printerName: string, nozzle = '0.4'): PresetRef | null {
  const want = norm(withoutNozzle(printerName))
  if (!want) return null
  const sameNozzle = machines.filter((m) => !m.user && Number(nozzleOf(m.name) ?? '0.4') === Number(nozzle))
  return (
    sameNozzle.find((m) => norm(withoutNozzle(m.name)) === want) ??
    sameNozzle.find((m) => {
      const n = norm(withoutNozzle(m.name))
      return n.length > 4 && (want.includes(n) || n.includes(want))
    }) ??
    null
  )
}

/** Picks the process preset for a machine whose layer height is closest to the one wanted. */
export function pickProcess(processes: PresetRef[], machine: PresetRef | undefined, layerHeight?: number): PresetRef | null {
  const fits = processes.filter((p) => !p.user && fitsMachine(p, machine))
  if (!fits.length) return null
  const lh = (p: PresetRef) => Number(/^(\d+(?:\.\d+)?)mm/.exec(p.name)?.[1] ?? NaN)
  const target = layerHeight ?? 0.2
  return [...fits].sort((a, b) => {
    const da = Math.abs((lh(a) || 99) - target)
    const db = Math.abs((lh(b) || 99) - target)
    if (da !== db) return da - db
    return Number(/standard/i.test(b.name)) - Number(/standard/i.test(a.name))
  })[0]!
}

/** Generic filament for a material type such as PLA or PETG. */
export function pickFilament(filaments: PresetRef[], type: string | undefined): PresetRef | null {
  const t = (type ?? 'PLA').toUpperCase().replace(/[^A-Z+-]/g, '')
  return filaments.find((f) => f.name === `Generic ${t} @System`) ?? filaments.find((f) => f.name === 'Generic PLA @System') ?? null
}

/** Reads a number out of a setting such as "15%", "0.2" or "[210]". */
export function settingNumber(v: string | undefined): number | undefined {
  if (v === undefined) return undefined
  const m = /-?\d+(?:\.\d+)?/.exec(v)
  return m ? Number(m[0]) : undefined
}

// ---- Resolved settings -----------------------------------------------------

/**
 * Every setting the engine used, from the config block at the end of its G-code
 * (`; key = value`). Multi-line values such as start G-code come back with real newlines.
 */
export function parseConfigBlock(text: string): Record<string, string> {
  const start = text.lastIndexOf('; CONFIG_BLOCK_START')
  const end = text.lastIndexOf('; CONFIG_BLOCK_END')
  const body = start >= 0 ? text.slice(start, end > start ? end : undefined) : text
  const out: Record<string, string> = {}
  for (const m of body.matchAll(/^; ([a-z0-9_]+) = ?(.*)$/gm)) {
    out[m[1]!] = m[2]!.replace(/\r$/, '').replace(/\\n/g, '\n')
  }
  return out
}

/** Build volume (mm) from resolved settings: the printable area's extent and its height. */
export function bedFromSettings(s: Record<string, string>): { x: number; y: number; z: number } | null {
  const pts = (s.printable_area ?? s.bed_shape ?? '')
    .split(',')
    .map((p) => p.split('x').map(Number))
    .filter((p) => p.length === 2 && p.every(Number.isFinite))
  const z = Number(s.printable_height)
  if (pts.length < 3 || !Number.isFinite(z)) return null
  const xs = pts.map((p) => p[0]!)
  const ys = pts.map((p) => p[1]!)
  return { x: Math.max(...xs) - Math.min(...xs), y: Math.max(...ys) - Math.min(...ys), z }
}

/** The bed temperature keys a filament preset carries, one per plate type, each with a first-layer twin. */
export const BED_TEMP_KEYS = ['hot_plate_temp', 'textured_plate_temp', 'cool_plate_temp', 'eng_plate_temp', 'textured_cool_plate_temp', 'supertack_plate_temp']

/**
 * A user's own preset file: the base preset it inherits, plus every changed setting as a string
 * (the engine reads lists such as "0x0,300x0" or "4.5" from strings). Settings that belong to
 * another kind of preset are ignored by the engine, so one set of edits can go to all three.
 */
export function customPreset(kind: PresetKind, name: string, inherits: string, values: Record<string, string>, meta: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(values)) {
    if (/^[a-z0-9_]{1,80}$/.test(k) && typeof v === 'string' && !['name', 'inherits', 'type', 'from', 'instantiation', 'version', 'setting_id', 'base_id', 'filament_id'].includes(k)) out[k] = v
  }
  for (const [k, v] of Object.entries(meta)) if (k.startsWith('birdy_')) out[k] = v
  return { ...out, type: kind, name, inherits, from: 'User', instantiation: 'true' }
}
