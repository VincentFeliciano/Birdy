<script lang="ts">
  import { onMount } from 'svelte'
  import Icon from '../../components/Icon.svelte'
  import type { CustomPresetInput, PresetRef } from '../../types/slicing'
  import { BED_TEMP_KEYS, pickFilament, pickProcess } from '../../../electron/slicing/presets'
  import { sl, useSaved } from './store.svelte'

  // Blank printers the engine ships, one per firmware; any other printer can be copied too.
  const BLANKS = [
    { name: 'MyMarlin 0.4 nozzle', label: 'Blank printer, Marlin firmware' },
    { name: 'MyKlipper 0.4 nozzle', label: 'Blank printer, Klipper firmware' },
    { name: 'MyRRF 0.4 nozzle', label: 'Blank printer, RepRapFirmware (Duet)' },
    { name: 'MyRepetier 0.4 nozzle', label: 'Blank printer, Repetier firmware' },
  ]
  const MATERIALS = ['PLA', 'PETG', 'ABS', 'ASA', 'TPU', 'PA', 'PC', 'PLA-CF', 'PETG-CF', 'PVA', 'HIPS', 'PP']

  type Tab = 'printer' | 'heat' | 'print' | 'all'
  type FieldKind = 'num' | 'text' | 'select' | 'gcode'
  interface Field {
    key: string
    label: string
    unit?: string
    kind?: FieldKind
    step?: number
    min?: number
    max?: number
    options?: [string, string][]
    hint?: string
  }

  const catalog = $derived(sl.catalog)
  const editName = sl.editor?.edit ?? null

  let tab = $state<Tab>('printer')
  let name = $state('')
  let baseMachine = $state(BLANKS[0]!.name)
  let material = $state('PLA')
  let baseProcess = $state('')
  let baseFilament = $state('')
  let maxNozzle = $state(260)
  let maxBed = $state(100)
  let heatedBed = $state(true)
  /** Settings the engine uses for the base presets: what "default" means here. */
  let defaults = $state<Record<string, string>>({})
  /** Only what the user changed. */
  let edits = $state<Record<string, string>>({})
  let loading = $state(false)
  let saving = $state(false)
  let error = $state<string | null>(null)
  let search = $state('')
  /** Names of the process and filament presets this printer had, when editing. */
  let oldProcess: string | null = null
  let oldFilament: string | null = null

  const machineRef = (n: string): PresetRef | undefined => catalog?.machines.find((m) => m.name === n)
  const systemMachines = $derived(catalog ? catalog.machines.filter((m) => !m.user && !BLANKS.some((b) => b.name === m.name)) : [])
  const vendorsOf = $derived([...new Set(systemMachines.map((m) => m.vendor))].sort((a, b) => a.localeCompare(b)))

  /** Base process and filament for the chosen base printer and material. */
  function pickBases() {
    if (!catalog) return
    baseProcess = pickProcess(catalog.processes, machineRef(baseMachine))?.name ?? ''
    baseFilament = pickFilament(catalog.filaments, material)?.name ?? ''
  }

  async function loadDefaults() {
    if (!baseMachine) return
    loading = true
    error = null
    try {
      defaults = await window.api.engine.resolve({ machine: baseMachine, process: baseProcess || undefined, filament: baseFilament || undefined })
    } catch (err) {
      error = String((err as Error).message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
    } finally {
      loading = false
    }
  }

  onMount(async () => {
    if (editName) {
      const m = await window.api.engine.readCustom('machine', editName)
      if (m) {
        name = m.name
        baseMachine = m.inherits || BLANKS[0]!.name
        maxNozzle = m.maxNozzle ?? maxNozzle
        maxBed = m.maxBed ?? maxBed
        heatedBed = m.heatedBed ?? true
        const merged: Record<string, string> = { ...m.values }
        // Its own process and filament ("… @name"), when it has them.
        const own = (list: PresetRef[] | undefined, chosen: string) =>
          list?.find((p) => p.user && p.name === chosen && p.name.endsWith(`@${editName}`))?.name ?? list?.find((p) => p.user && p.name.endsWith(`@${editName}`))?.name ?? null
        oldProcess = own(catalog?.processes, sl.settings.process)
        oldFilament = own(catalog?.filaments, sl.settings.filament)
        const p = oldProcess ? await window.api.engine.readCustom('process', oldProcess) : null
        const f = oldFilament ? await window.api.engine.readCustom('filament', oldFilament) : null
        if (p) Object.assign(merged, p.values)
        if (f) {
          Object.assign(merged, f.values)
          material = f.values.filament_type ?? /^(\S+)/.exec(f.name)?.[1] ?? material
        }
        edits = merged
        pickBases()
        if (p?.inherits) baseProcess = p.inherits
        if (f?.inherits) baseFilament = f.inherits
      }
    } else {
      pickBases()
    }
    await loadDefaults()
  })

  async function changeBase(n: string) {
    baseMachine = n
    pickBases()
    await loadDefaults()
  }
  async function changeMaterial(m: string) {
    material = m
    if (catalog) baseFilament = pickFilament(catalog.filaments, m)?.name ?? baseFilament
    // Temperatures and fans follow the new material's defaults.
    for (const k of Object.keys(edits)) if (/temp|fan_|filament_type/.test(k)) delete edits[k]
    await loadDefaults()
  }

  // ---- Values -----------------------------------------------------------------

  const value = (key: string) => edits[key] ?? defaults[key] ?? ''
  const changed = (key: string) => key in edits && edits[key] !== defaults[key]
  function set(key: string, v: string) {
    if (v === (defaults[key] ?? '')) delete edits[key]
    else edits[key] = v
  }
  function reset(key: string) {
    delete edits[key]
  }

  // The bed's width and depth live in one setting, its outline.
  function area(): [number, number] {
    const pts = value('printable_area')
      .split(',')
      .map((p) => p.split('x').map(Number))
      .filter((p) => p.length === 2 && p.every(Number.isFinite))
    if (pts.length < 3) return [0, 0]
    return [Math.max(...pts.map((p) => p[0]!)) - Math.min(...pts.map((p) => p[0]!)), Math.max(...pts.map((p) => p[1]!)) - Math.min(...pts.map((p) => p[1]!))]
  }
  function setArea(x: number, y: number) {
    if (!(x > 0 && y > 0)) return
    set('printable_area', `0x0,${x}x0,${x}x${y},0x${y}`)
  }
  // One bed temperature for every plate type the engine knows.
  function setBedTemp(v: string, first: boolean) {
    for (const k of BED_TEMP_KEYS) set(first ? `${k}_initial_layer` : k, v)
  }

  // ---- Fields -------------------------------------------------------------------

  const FLAVORS: [string, string][] = [
    ['marlin2', 'Marlin 2'],
    ['marlin', 'Marlin (legacy)'],
    ['klipper', 'Klipper'],
    ['reprapfirmware', 'RepRapFirmware'],
    ['repetier', 'Repetier'],
    ['smoothie', 'Smoothie'],
  ]
  const printerFields: Field[] = [
    { key: 'printable_height', label: 'Max height', unit: 'mm', min: 10, max: 2000 },
    { key: 'nozzle_diameter', label: 'Nozzle', unit: 'mm', step: 0.05, min: 0.1, max: 2 },
    { key: 'gcode_flavor', label: 'Firmware', kind: 'select', options: FLAVORS },
    { key: 'retraction_length', label: 'Retraction', unit: 'mm', step: 0.1, min: 0, max: 15, hint: 'Bowden: 3–6 mm. Direct drive: 0.5–2 mm.' },
    { key: 'retraction_speed', label: 'Retract speed', unit: 'mm/s', min: 1, max: 150 },
    { key: 'deretraction_speed', label: 'Unretract speed', unit: 'mm/s', min: 0, max: 150 },
    { key: 'z_hop', label: 'Z hop', unit: 'mm', step: 0.1, min: 0, max: 5 },
    { key: 'machine_max_acceleration_extruding', label: 'Max acceleration', unit: 'mm/s²', kind: 'text', hint: 'Normal, silent mode' },
    { key: 'machine_max_speed_x', label: 'Max speed X', unit: 'mm/s', kind: 'text', hint: 'Normal, silent mode' },
    { key: 'machine_max_speed_y', label: 'Max speed Y', unit: 'mm/s', kind: 'text', hint: 'Normal, silent mode' },
  ]
  const heatFields: Field[] = [
    { key: 'nozzle_temperature', label: 'Nozzle', unit: '°C', min: 0, max: 500 },
    { key: 'nozzle_temperature_initial_layer', label: 'Nozzle, first layer', unit: '°C', min: 0, max: 500 },
    { key: '@bed', label: 'Bed', unit: '°C', min: 0, max: 200 },
    { key: '@bed1', label: 'Bed, first layer', unit: '°C', min: 0, max: 200 },
    { key: 'fan_min_speed', label: 'Fan min', unit: '%', min: 0, max: 100 },
    { key: 'fan_max_speed', label: 'Fan max', unit: '%', min: 0, max: 100 },
    { key: 'close_fan_the_first_x_layers', label: 'No fan for first', unit: 'layers', min: 0, max: 20 },
    { key: 'filament_diameter', label: 'Filament diameter', unit: 'mm', step: 0.01, min: 1, max: 3.5 },
    { key: 'filament_flow_ratio', label: 'Flow ratio', step: 0.01, min: 0.5, max: 1.5 },
    { key: 'filament_max_volumetric_speed', label: 'Max flow', unit: 'mm³/s', step: 0.5, min: 1, max: 100 },
    { key: 'filament_density', label: 'Density', unit: 'g/cm³', step: 0.01, min: 0.5, max: 3 },
    { key: 'filament_cost', label: 'Cost', unit: 'per kg', step: 0.5, min: 0, max: 1000 },
  ]
  const INFILLS: [string, string][] = ['grid', 'gyroid', 'cubic', 'rectilinear', 'line', 'honeycomb', 'triangles', 'adaptivecubic', 'lightning', 'crosshatch'].map((p) => [p, p])
  const printFields: Field[] = [
    { key: 'layer_height', label: 'Layer height', unit: 'mm', step: 0.02, min: 0.04, max: 1.2 },
    { key: 'initial_layer_print_height', label: 'First layer height', unit: 'mm', step: 0.02, min: 0.05, max: 1.2 },
    { key: 'wall_loops', label: 'Walls', min: 0, max: 30 },
    { key: 'top_shell_layers', label: 'Top layers', min: 0, max: 50 },
    { key: 'bottom_shell_layers', label: 'Bottom layers', min: 0, max: 50 },
    { key: 'sparse_infill_density', label: 'Infill', kind: 'text', hint: 'e.g. 15%' },
    { key: 'sparse_infill_pattern', label: 'Infill pattern', kind: 'select', options: INFILLS },
    { key: 'outer_wall_speed', label: 'Outer wall speed', unit: 'mm/s', min: 1, max: 1000 },
    { key: 'inner_wall_speed', label: 'Inner wall speed', unit: 'mm/s', min: 1, max: 1000 },
    { key: 'sparse_infill_speed', label: 'Infill speed', unit: 'mm/s', min: 1, max: 1000 },
    { key: 'initial_layer_speed', label: 'First layer speed', unit: 'mm/s', min: 1, max: 500 },
    { key: 'travel_speed', label: 'Travel speed', unit: 'mm/s', min: 1, max: 1500 },
    { key: 'enable_support', label: 'Supports', kind: 'select', options: [['0', 'Off'], ['1', 'On']] },
    { key: 'support_type', label: 'Support type', kind: 'select', options: [['normal(auto)', 'Normal'], ['tree(auto)', 'Tree'], ['normal(manual)', 'Normal, painted only'], ['tree(manual)', 'Tree, painted only']] },
    { key: 'brim_type', label: 'Brim', kind: 'select', options: [['no_brim', 'None'], ['outer_only', 'Outside'], ['auto_brim', 'Auto'], ['brim_ears', 'Ears']] },
    { key: 'brim_width', label: 'Brim width', unit: 'mm', min: 0, max: 50 },
    { key: 'skirt_loops', label: 'Skirt loops', min: 0, max: 20 },
  ]

  function fieldValue(f: Field) {
    if (f.key === '@bed') return value('hot_plate_temp')
    if (f.key === '@bed1') return value('hot_plate_temp_initial_layer')
    return value(f.key)
  }
  function fieldSet(f: Field, v: string) {
    if (f.key === '@bed') setBedTemp(v, false)
    else if (f.key === '@bed1') setBedTemp(v, true)
    else set(f.key, v)
  }
  function fieldChanged(f: Field) {
    if (f.key === '@bed') return changed('hot_plate_temp')
    if (f.key === '@bed1') return changed('hot_plate_temp_initial_layer')
    return changed(f.key)
  }
  function fieldReset(f: Field) {
    if (f.key === '@bed' || f.key === '@bed1') for (const k of BED_TEMP_KEYS) reset(f.key === '@bed' ? k : `${k}_initial_layer`)
    else reset(f.key)
  }
  function over(f: Field): string | null {
    const n = Number(fieldValue(f))
    if (!Number.isFinite(n)) return null
    if ((f.key === 'nozzle_temperature' || f.key === 'nozzle_temperature_initial_layer') && n > maxNozzle) return `Above this printer's ${maxNozzle} °C limit`
    if ((f.key === '@bed' || f.key === '@bed1') && heatedBed && n > maxBed) return `Above this bed's ${maxBed} °C limit`
    return null
  }

  const allKeys = $derived(
    Object.keys(defaults)
      .filter((k) => !/^(print_settings_id|printer_settings_id|filament_settings_id|inherits|inherits_group|compatible_)/.test(k))
      .filter((k) => !search.trim() || k.includes(search.trim().toLowerCase().replace(/\s+/g, '_')))
      .sort(),
  )
  const editCount = $derived(Object.keys(edits).filter((k) => edits[k] !== defaults[k]).length)

  // ---- Save ---------------------------------------------------------------------

  async function save() {
    error = null
    const n = name.trim()
    if (!n) return void (error = 'Give the printer a name.')
    if (/[@;]/.test(n)) return void (error = 'A printer name cannot contain @ or ;')
    const taken = catalog?.machines.find((m) => m.name === n)
    if (taken && !taken.user) return void (error = 'That name belongs to one of the built-in printers. Pick another.')
    if (taken && taken.user && n !== editName) return void (error = 'You already have a printer with that name.')
    const values: Record<string, string> = {}
    for (const [k, v] of Object.entries(edits)) if (v !== defaults[k]) values[k] = v
    if (!heatedBed) for (const k of BED_TEMP_KEYS) values[k] = values[`${k}_initial_layer`] = '0'
    const layer = Number(value('layer_height')) || 0.2
    const processName = `${layer.toFixed(2)}mm @${n}`
    const filamentName = `${material} @${n}`
    const items: CustomPresetInput[] = [
      { kind: 'machine', name: n, inherits: baseMachine, values, maxNozzle, maxBed, heatedBed, replaces: editName ?? undefined },
      { kind: 'process', name: processName, inherits: baseProcess, values, replaces: oldProcess ?? undefined },
      { kind: 'filament', name: filamentName, inherits: baseFilament, values, replaces: oldFilament ?? undefined },
    ]
    saving = true
    try {
      const c = await window.api.engine.saveCustom(items)
      useSaved(c, n, processName, filamentName)
      sl.editor = null
    } catch (err) {
      error = String((err as Error).message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
    } finally {
      saving = false
    }
  }

  async function remove() {
    if (!editName || !confirm(`Delete the printer "${editName}" and its own settings?`)) return
    let c = await window.api.engine.deleteCustom('machine', editName)
    if (oldProcess) c = await window.api.engine.deleteCustom('process', oldProcess)
    if (oldFilament) c = await window.api.engine.deleteCustom('filament', oldFilament)
    sl.catalog = c
    if (sl.settings.machine === editName) sl.settings.machine = ''
    sl.editor = null
  }

  function close() {
    sl.editor = null
  }
  const [bedX, bedY] = $derived(area())
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && close()} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="scrim" onclick={close}>
  <div class="dlg neon-panel" role="dialog" aria-modal="true" aria-label={editName ? `Edit ${editName}` : 'Add a printer'} tabindex="-1" onclick={(e) => e.stopPropagation()}>
    <header>
      <h2>{editName ? `Edit ${editName}` : 'Add a printer'}</h2>
      <button class="icon-btn" aria-label="Close" title="Close" onclick={close}><Icon name="close" size={14} /></button>
    </header>

    <div class="top">
      <label class="field">
        <span>Name</span>
        <input type="text" maxlength="80" placeholder="e.g. My Ender 3" bind:value={name} />
      </label>
      <label class="field">
        <span>Start from</span>
        <select value={baseMachine} onchange={(e) => changeBase(e.currentTarget.value)} disabled={loading}>
          <optgroup label="Blank printers">
            {#each BLANKS as b}<option value={b.name}>{b.label}</option>{/each}
          </optgroup>
          {#each vendorsOf as v}
            <optgroup label={`Like a ${v === 'BBL' ? 'Bambu Lab' : v}`}>
              {#each systemMachines.filter((m) => m.vendor === v) as m}<option value={m.name}>{m.name}</option>{/each}
            </optgroup>
          {/each}
        </select>
      </label>
      <label class="field">
        <span>Material</span>
        <select value={material} onchange={(e) => changeMaterial(e.currentTarget.value)} disabled={loading}>
          {#each MATERIALS as m}<option value={m}>{m}</option>{/each}
        </select>
      </label>
    </div>
    <p class="sub">
      Everything starts at the defaults of the printer and material you start from. Change only what differs; changed settings are marked, and <Icon name="reset" size={11} /> puts one back.
      {#if loading}<span class="spin"><span class="spinner"></span> Reading the defaults…</span>{/if}
    </p>

    <div class="tabs" role="tablist">
      {#each [['printer', 'Printer'], ['heat', 'Heating & filament'], ['print', 'Print settings'], ['all', `All settings${editCount ? ` · ${editCount} changed` : ''}`]] as [id, label]}
        <button role="tab" aria-selected={tab === id} class:on={tab === id} onclick={() => (tab = id as Tab)}>{label}</button>
      {/each}
    </div>

    <div class="body">
      {#snippet fieldRow(f: Field)}
        {@const warn = over(f)}
        <label class="field" class:chg={fieldChanged(f)} class:wide={f.kind === 'gcode'}>
          <span>{f.label}{#if f.unit}<i>&nbsp;{f.unit}</i>{/if}</span>
          <span class="in">
            {#if f.kind === 'select'}
              {@const v = fieldValue(f)}
              <select value={v} onchange={(e) => fieldSet(f, e.currentTarget.value)}>
                {#if v && !f.options?.some((o) => o[0] === v)}<option value={v}>{v}</option>{/if}
                {#each f.options ?? [] as [ov, ol]}<option value={ov}>{ol}</option>{/each}
              </select>
            {:else if f.kind === 'text'}
              <input type="text" value={fieldValue(f)} onchange={(e) => fieldSet(f, e.currentTarget.value.trim())} />
            {:else}
              <input type="number" step={f.step ?? 1} min={f.min} max={f.max} value={fieldValue(f)} onchange={(e) => fieldSet(f, e.currentTarget.value.trim())} />
            {/if}
            {#if fieldChanged(f)}<button class="icon-btn mini" title="Back to the default ({f.key.startsWith('@') ? 'preset' : (defaults[f.key] ?? 'none')})" aria-label="Reset {f.label}" onclick={(e) => (e.preventDefault(), fieldReset(f))}><Icon name="reset" size={11} /></button>{/if}
          </span>
          {#if warn}<em class="warn">{warn}</em>{:else if f.hint}<em>{f.hint}</em>{/if}
        </label>
      {/snippet}

      {#if tab === 'printer'}
        <div class="grid">
          <label class="field" class:chg={changed('printable_area')}>
            <span>Bed width X <i>mm</i></span>
            <input type="number" min="10" max="2000" value={bedX || ''} onchange={(e) => setArea(Number(e.currentTarget.value), bedY)} />
          </label>
          <label class="field" class:chg={changed('printable_area')}>
            <span>Bed depth Y <i>mm</i></span>
            <input type="number" min="10" max="2000" value={bedY || ''} onchange={(e) => setArea(bedX, Number(e.currentTarget.value))} />
          </label>
          {#each printerFields as f}{@render fieldRow(f)}{/each}
          <label class="field">
            <span>Hottest nozzle <i>°C</i></span>
            <input type="number" min="150" max="500" bind:value={maxNozzle} />
            <em>Birdy warns above this.</em>
          </label>
          <label class="field">
            <span>Heated bed</span>
            <select value={heatedBed ? 'yes' : 'no'} onchange={(e) => (heatedBed = e.currentTarget.value === 'yes')}>
              <option value="yes">Yes</option>
              <option value="no">No (bed stays off)</option>
            </select>
          </label>
          {#if heatedBed}
            <label class="field">
              <span>Hottest bed <i>°C</i></span>
              <input type="number" min="30" max="200" bind:value={maxBed} />
            </label>
          {/if}
        </div>
        <label class="field wide" class:chg={changed('machine_start_gcode')}>
          <span>Start G-code {#if changed('machine_start_gcode')}<button class="link" onclick={(e) => (e.preventDefault(), reset('machine_start_gcode'))}>Default</button>{/if}</span>
          <textarea rows="6" spellcheck="false" value={value('machine_start_gcode')} onchange={(e) => set('machine_start_gcode', e.currentTarget.value)}></textarea>
        </label>
        <label class="field wide" class:chg={changed('machine_end_gcode')}>
          <span>End G-code {#if changed('machine_end_gcode')}<button class="link" onclick={(e) => (e.preventDefault(), reset('machine_end_gcode'))}>Default</button>{/if}</span>
          <textarea rows="5" spellcheck="false" value={value('machine_end_gcode')} onchange={(e) => set('machine_end_gcode', e.currentTarget.value)}></textarea>
        </label>
      {:else if tab === 'heat'}
        {#if !heatedBed}<p class="sub">This printer has no heated bed, so the bed temperatures are not used.</p>{/if}
        <div class="grid">{#each heatFields as f}{@render fieldRow(f)}{/each}</div>
      {:else if tab === 'print'}
        <div class="grid">{#each printFields as f}{@render fieldRow(f)}{/each}</div>
      {:else}
        <input class="search" type="search" placeholder="Search {Object.keys(defaults).length} settings, e.g. retraction, speed, fan" bind:value={search} />
        <div class="all">
          {#each allKeys as k (k)}
            {@const long = /gcode|notes|post_process|template/.test(k)}
            <label class="row" class:chg={changed(k)}>
              <span class="k mono">{k}</span>
              {#if long}
                <textarea rows="3" spellcheck="false" value={value(k)} onchange={(e) => set(k, e.currentTarget.value)}></textarea>
              {:else}
                <input type="text" spellcheck="false" value={value(k)} onchange={(e) => set(k, e.currentTarget.value)} />
              {/if}
              {#if changed(k)}<button class="icon-btn mini" title="Back to the default ({defaults[k] ?? 'none'})" aria-label="Reset {k}" onclick={(e) => (e.preventDefault(), reset(k))}><Icon name="reset" size={11} /></button>{:else}<span></span>{/if}
            </label>
          {/each}
        </div>
      {/if}
    </div>

    {#if error}<p class="err">{error}</p>{/if}
    <footer>
      {#if editName}<button class="ghost danger" onclick={remove}><Icon name="trash" size={13} />Delete</button>{/if}
      <span class="grow"></span>
      <button class="ghost" onclick={close}>Cancel</button>
      <button class="primary" disabled={saving || loading || !Object.keys(defaults).length} onclick={save}>{saving ? 'Saving…' : editName ? 'Save printer' : 'Add printer'}</button>
    </footer>
  </div>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    justify-content: center;
    align-items: center;
    background: rgba(0, 0, 0, 0.5);
  }
  .dlg {
    width: min(860px, calc(100vw - 40px));
    max-height: calc(100vh - 60px);
    display: flex;
    flex-direction: column;
    padding: 16px 18px;
    gap: 10px;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  h2 {
    margin: 0;
    font-size: 15px;
  }
  .top {
    display: grid;
    grid-template-columns: 1fr 1.4fr 0.6fr;
    gap: 10px;
  }
  .sub {
    margin: 0;
    font-size: 11px;
    color: var(--muted);
  }
  .spin {
    margin-left: 8px;
    color: var(--accent);
  }
  .tabs {
    display: flex;
    gap: 4px;
    border-bottom: 1px solid var(--border);
  }
  .tabs button {
    border: 0;
    background: none;
    color: var(--muted);
    padding: 6px 10px;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
    border-bottom: 2px solid transparent;
  }
  .tabs button.on {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }
  .body {
    overflow: auto;
    min-height: 260px;
    padding-right: 4px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 10px;
    margin-bottom: 10px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 11px;
    color: var(--muted);
  }
  .field.wide {
    margin-bottom: 10px;
  }
  .field i {
    font-style: normal;
    color: var(--faint);
  }
  .field em {
    font-style: normal;
    font-size: 10px;
    color: var(--faint);
  }
  .field em.warn {
    color: #ff7a59;
  }
  .field.chg > span:first-child,
  .row.chg .k {
    color: var(--accent);
  }
  .in {
    display: flex;
    gap: 4px;
    align-items: center;
  }
  .in > :first-child {
    flex: 1;
    min-width: 0;
  }
  input,
  select,
  textarea {
    height: 28px;
    border-radius: 6px;
    border: 1px solid var(--border-strong);
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-size: 12px;
    padding: 0 8px;
  }
  textarea {
    height: auto;
    padding: 6px 8px;
    font-family: var(--mono, monospace);
    font-size: 11px;
    resize: vertical;
  }
  .search {
    width: 100%;
    margin-bottom: 8px;
  }
  .all {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .row {
    display: grid;
    grid-template-columns: 260px 1fr 22px;
    gap: 6px;
    align-items: center;
  }
  .k {
    font-size: 11px;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .mini {
    width: 22px;
    height: 22px;
  }
  .link {
    border: 0;
    background: none;
    color: var(--accent);
    cursor: pointer;
    font: inherit;
    font-size: 11px;
    margin-left: 6px;
  }
  .err {
    margin: 0;
    color: #ff7a59;
    font-size: 12px;
  }
  footer {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .grow {
    flex: 1;
  }
  .danger {
    color: #ff7a59;
  }
</style>
