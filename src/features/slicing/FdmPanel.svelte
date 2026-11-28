<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import Icon from '../../components/Icon.svelte'
  import { fmtBytes } from '../../app/format'
  import { isFdmKind } from '../../types/slicing'
  import type { BrimType, PresetRef, SkirtMode, SliceOverrides, SupportMode } from '../../types/slicing'
  import { fitsMachine } from '../../../electron/slicing/presets'
  import PrinterManager from './PrinterManager.svelte'
  import PricesEditor from '../../components/PricesEditor.svelte'
  import { fmtMoney, prices, printCost } from '../../app/costs.svelte'
  import { cancelUsb, pauseUsb, usb, usbActive } from './usb.svelte'
  import {
    cancelSlice,
    chooseGcodeFolder,
    chooseMachine,
    choosePrinter,
    clearOverrides,
    folderLabel,
    loadGcodeFolder,
    importFrom,
    installEngine,
    loadCatalog,
    machineRef,
    openPrinterEditor,
    saveGcode,
    sendToPrinter,
    answerPort,
    setOverride,
    setPreset,
    setPreviewOn,
    sl,
    slice,
  } from './store.svelte'

  let now = $state(Date.now())
  let timer: ReturnType<typeof setInterval> | null = null
  onMount(() => {
    timer = setInterval(() => (now = Date.now()), 500)
    void loadGcodeFolder()
  })
  onDestroy(() => {
    if (timer) clearInterval(timer)
  })

  const engine = $derived(sl.engine)
  const catalog = $derived(sl.catalog)
  const machine = $derived(catalog ? machineRef() : undefined)
  const o = $derived(sl.settings.overrides)
  const result = $derived(sl.result?.ok ? sl.result : null)
  const summary = $derived(result?.summary)

  // Your own printers ("My printers", "Imported") first, then every brand. Printers Boaty adds to a
  // brand (Anycubic Mega X) are listed under that brand.
  const vendors = $derived.by(() => {
    if (!catalog) return [] as string[]
    const own = [...new Set(catalog.machines.filter((m) => m.user && !catalog.vendors.includes(m.vendor)).map((m) => m.vendor))].sort()
    return [...own, ...catalog.vendors]
  })
  let vendorPick = $state('')
  const vendor = $derived(vendorPick || (machine ? machine.vendor : ''))
  const machines = $derived(catalog ? catalog.machines.filter((m) => m.vendor === vendor).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })) : [])
  const maxNozzle = $derived(machine?.maxNozzle ?? 350)
  const maxBed = $derived(machine?.maxBed ?? 130)

  function options(list: PresetRef[] | undefined, selected: string) {
    if (!list) return { fit: [] as PresetRef[], other: [] as PresetRef[] }
    const fit = list.filter((p) => fitsMachine(p, machine))
    const other = sl.showAll ? list.filter((p) => !fitsMachine(p, machine)) : list.filter((p) => p.name === selected && !fitsMachine(p, machine))
    return { fit, other }
  }
  const procs = $derived(options(catalog?.processes, sl.settings.process))
  const fils = $derived(options(catalog?.filaments, sl.settings.filament))

  const foundSources = $derived(sl.candidates.filter((c) => c.found))
  const fdmPrinters = $derived(sl.printers.filter((p) => isFdmKind(p.kind)))
  const printer = $derived(fdmPrinters.find((p) => p.id === sl.printerId) ?? fdmPrinters[0])
  const elapsed = $derived(sl.slicing ? Math.max(0, Math.round((now - sl.sliceStarted) / 1000)) : 0)
  const hasOverrides = $derived(Object.keys(o).length > 0)
  const extraCount = $derived(Object.keys(o.extra ?? {}).length)
  const brimType = $derived<BrimType | undefined>(o.brimType ?? (o.brim === undefined ? undefined : o.brim ? 'outer' : 'none'))
  type NumKey = { [K in keyof SliceOverrides]-?: NonNullable<SliceOverrides[K]> extends number ? K : never }[keyof SliceOverrides]
  function setBrim(t: BrimType | undefined) {
    setOverride('brim', undefined)
    setOverride('brimType', t)
  }

  const num = (e: Event) => {
    const v = (e.currentTarget as HTMLInputElement).value.trim()
    return v === '' ? undefined : Number(v)
  }
  const pct = (n: number) => `${Math.round(n * 100)}%`
  const fmtTime = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`)
  const usbPct = $derived(usb.total ? usb.sent / usb.total : 0)
  const kindLabel = { octoprint: 'OctoPrint', moonraker: 'Klipper / Moonraker', prusalink: 'PrusaLink', serial: 'USB cable', elegoo: 'Elegoo Wi-Fi', flashforge: 'Flashforge Wi-Fi' } as const
</script>

{#snippet nf(key: NumKey, label: string, unit: string, min: number, max: number, step: number, title = '')}
  <label class="field" title={title || undefined}>
    <span>{label} <i>{unit}</i></span>
    <input type="number" {min} {max} {step} placeholder="preset" value={o[key] ?? ''} onchange={(e) => setOverride(key, num(e))} />
  </label>
{/snippet}

{#if sl.managePrinters}
  <PrinterManager />
{:else}
  <div class="scroll">
    {#if sl.portChoices}
      <section class="picker">
        <h3 class="hud-label">Choose the printer’s USB port</h3>
        {#if sl.portChoices.length}
          <ul class="ports">
            {#each sl.portChoices as p (p.portId)}
              <li>
                <button class="ghost wide" onclick={() => answerPort(p.portId)}>
                  <Icon name="usb" size={14} />
                  <span class="pname">{p.displayName || p.portName}</span>
                  <span class="mono dim">{p.portName}</span>
                </button>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="hint">No serial ports found. Plug in the printer’s USB cable and turn it on, then try again.</p>
        {/if}
        <button class="ghost wide" onclick={() => answerPort(null)}>Cancel</button>
      </section>
    {/if}
    {#if !engine}
      <section><div class="hint"><span class="spinner"></span> Checking for the slicing engine…</div></section>
    {:else if !engine.source}
      <section>
        <h3 class="hud-label">Slicing engine</h3>
        <p class="body">
          Boaty slices with OrcaSlicer’s open-source engine (AGPL-3.0). Download it once ({fmtBytes(engine.downloadSize)}) from OrcaSlicer’s
          official GitHub release. Boaty checks the file’s published SHA-256 before installing it.
        </p>
        {#if engine.installing}
          <div class="bar"><span style:width={pct(engine.progress ?? 0)}></span></div>
          <div class="row">
            <span class="hint mono">{engine.progress !== null && engine.progress > 0.95 ? 'UNPACKING…' : `DOWNLOADING ${pct(engine.progress ?? 0)}`}</span>
            <button class="ghost" onclick={() => window.api.engine.cancelInstall()}>Cancel</button>
          </div>
        {:else}
          <button class="primary wide" onclick={installEngine}><Icon name="download" size={15} />Download engine (OrcaSlicer {engine.version})</button>
        {/if}
        {#if engine.error}<p class="err">{engine.error}</p>{/if}
        <p class="hint small">Already have OrcaSlicer installed? Boaty uses it automatically.</p>
      </section>
    {:else}
      <section>
        <h3 class="hud-label row-head">
          Import settings
          <span class="dim">from your slicer</span>
        </h3>
        {#if foundSources.length}
          <div class="chips">
            {#each foundSources as c}
              <button class="chip" disabled={!!sl.importing || !catalog} title={c.detail} onclick={() => importFrom(c.source)}>
                {#if sl.importing === c.source}<span class="spinner"></span>{:else}<Icon name="import" size={13} />{/if}
                {c.name}
              </button>
            {/each}
          </div>
        {:else}
          <p class="hint">No OrcaSlicer, Bambu Studio, PrusaSlicer or Cura settings were found on this PC. Pick your printer below.</p>
        {/if}
        {#if sl.importNotes.length}
          <ul class="notes">
            {#each sl.importNotes as n}<li>{n}</li>{/each}
          </ul>
        {/if}
      </section>

      <section>
        <h3 class="hud-label row-head">
          Printer & presets
          <button class="icon-btn mini" title="Reload the preset list from the engine" aria-label="Reload presets" disabled={sl.catalogLoading} onclick={() => loadCatalog(true)}>
            <Icon name="reload" size={13} />
          </button>
        </h3>
        {#if sl.catalogLoading && !catalog}
          <div class="hint"><span class="spinner"></span> Loading printer profiles…</div>
        {:else if sl.catalogError}
          <p class="err">{sl.catalogError}</p>
        {:else if catalog}
          <label class="field">
            <span>Brand</span>
            <select value={vendor} onchange={(e) => (vendorPick = e.currentTarget.value)}>
              <option value="" disabled>Choose a brand</option>
              {#each vendors as v}<option value={v}>{v === 'BBL' ? 'Bambu Lab' : v}</option>{/each}
            </select>
          </label>
          <label class="field">
            <span>Printer</span>
            <select value={sl.settings.machine} disabled={!vendor} onchange={(e) => chooseMachine(e.currentTarget.value)}>
              <option value="" disabled>{machines.length ? 'Choose a printer' : 'Choose a brand first'}</option>
              {#each machines as m}<option value={m.name}>{m.name}</option>{/each}
              {#if machine && !machines.includes(machine)}<option value={machine.name}>{machine.name}</option>{/if}
            </select>
          </label>
          <label class="field">
            <span>Process</span>
            <select value={sl.settings.process} disabled={!machine} onchange={(e) => setPreset('process', e.currentTarget.value)}>
              {#each procs.fit as p}<option value={p.name}>{p.name}</option>{/each}
              {#if procs.other.length}
                <optgroup label="Made for other printers">
                  {#each procs.other as p}<option value={p.name}>{p.name}</option>{/each}
                </optgroup>
              {/if}
            </select>
          </label>
          <label class="field">
            <span>Filament</span>
            <select value={sl.settings.filament} disabled={!machine} onchange={(e) => setPreset('filament', e.currentTarget.value)}>
              {#each fils.fit as p}<option value={p.name}>{p.name}</option>{/each}
              {#if fils.other.length}
                <optgroup label="Made for other printers">
                  {#each fils.other as p}<option value={p.name}>{p.name}</option>{/each}
                </optgroup>
              {/if}
            </select>
          </label>
          <label class="check">
            <input type="checkbox" checked={sl.showAll} onchange={(e) => (sl.showAll = e.currentTarget.checked)} />
            Show presets made for other printers
          </label>
          <div class="own">
            <button class="ghost sm" title="Set up a printer that isn't in the list, with full control of its settings" onclick={() => openPrinterEditor()}><Icon name="plus" size={12} />Add a printer</button>
            {#if machine?.custom}
              <button class="ghost sm" title="Change this printer's settings" onclick={() => openPrinterEditor(machine.name)}><Icon name="pencil" size={12} />Edit {machine.name}</button>
            {/if}
          </div>
        {/if}
      </section>

      {#if catalog && machine}
        <section>
          <h3 class="hud-label row-head">
            Adjust
            <span class="dim">blank = preset</span>
            {#if hasOverrides}<button class="link" onclick={clearOverrides}>Reset</button>{/if}
          </h3>
          <div class="grid2">
            <label class="field">
              <span>Layer height <i>mm</i></span>
              <input type="number" min="0.04" max="1.2" step="0.04" placeholder="preset" value={o.layerHeight ?? ''} onchange={(e) => setOverride('layerHeight', num(e))} />
            </label>
            <label class="field">
              <span>Infill <i>%</i></span>
              <input type="number" min="0" max="100" step="5" placeholder="preset" value={o.infill ?? ''} onchange={(e) => setOverride('infill', num(e))} />
            </label>
            <label class="field">
              <span>Walls</span>
              <input type="number" min="1" max="20" step="1" placeholder="preset" value={o.walls ?? ''} onchange={(e) => setOverride('walls', num(e))} />
            </label>
            <label class="field">
              <span>Supports</span>
              <select value={o.supports ?? ''} onchange={(e) => setOverride('supports', (e.currentTarget.value || undefined) as SupportMode | undefined)}>
                <option value="">Preset</option>
                <option value="off">Off</option>
                <optgroup label="Normal">
                  <option value="normal">Normal (grid)</option>
                  <option value="snug">Snug</option>
                </optgroup>
                <optgroup label="Tree">
                  <option value="tree">Tree</option>
                  <option value="organic">Organic tree</option>
                  <option value="tree-slim">Tree, slim</option>
                  <option value="tree-strong">Tree, strong</option>
                  <option value="tree-hybrid">Tree, hybrid</option>
                </optgroup>
              </select>
            </label>
            <label class="field">
              <span>Supports from</span>
              <select disabled={o.supports === 'off'} value={o.supportsPlateOnly === undefined ? '' : o.supportsPlateOnly ? 'plate' : 'all'} onchange={(e) => setOverride('supportsPlateOnly', e.currentTarget.value === '' ? undefined : e.currentTarget.value === 'plate')}>
                <option value="">Preset</option>
                <option value="all">Plate and model</option>
                <option value="plate">Plate only</option>
              </select>
            </label>
            <label class="field" title="Overhangs flatter than this angle, measured from the horizontal, get supports">
              <span>Support below <i>°</i></span>
              <input type="number" min="0" max="90" step="5" placeholder="preset" disabled={o.supports === 'off'} value={o.supportAngle ?? ''} onchange={(e) => setOverride('supportAngle', num(e))} />
            </label>
            <label class="field" title="Layers of raft printed under the model">
              <span>Raft <i>layers</i></span>
              <input type="number" min="0" max="20" step="1" placeholder="preset" value={o.raftLayers ?? ''} onchange={(e) => setOverride('raftLayers', num(e))} />
            </label>
            <label class="field">
              <span>Nozzle <i>°C</i></span>
              <input type="number" min="150" max={maxNozzle} step="5" placeholder="preset" value={o.nozzleTemp ?? ''} onchange={(e) => setOverride('nozzleTemp', num(e))} />
              {#if (o.nozzleTemp ?? 0) > maxNozzle}<em class="warn">Over this printer's {maxNozzle} °C</em>{/if}
            </label>
            <label class="field">
              <span>Bed <i>°C</i></span>
              <input type="number" min="0" max={maxBed} step="5" placeholder={machine.heatedBed === false ? 'no heated bed' : 'preset'} disabled={machine.heatedBed === false} value={o.bedTemp ?? ''} onchange={(e) => setOverride('bedTemp', num(e))} />
              {#if (o.bedTemp ?? 0) > maxBed}<em class="warn">Over this bed's {maxBed} °C</em>{/if}
            </label>
          </div>
          <h4 class="sub-head">Speeds</h4>
          <p class="hint">Older or wobbly printers print cleaner when slowed down. Blank keeps the preset's value.</p>
          <details class="more units">
            <summary>What do mm/s and mm/s² mean?</summary>
            <dl>
              <dt>Speed <i>mm/s</i></dt>
              <dd>How fast the nozzle moves while printing: millimetres per second. Outer walls 25–50 on older printers, up to 200+ on fast ones.</dd>
              <dt>Acceleration <i>mm/s²</i></dt>
              <dd>
                How quickly the printer gets up to that speed (and slows down again): millimetres per second, every second. At 500 mm/s² it takes a
                tenth of a second to reach 50 mm/s. Lower is gentler: less shaking, ringing and layer shifts, but short moves never reach full speed, so
                prints take longer.
              </dd>
              <dd class="ranges">Big or older bed-slingers (Mega X, Ender 3): 300–1000 · Newer printers: 1000–3000 · Klipper or input shaping: 3000–20000</dd>
              <dd>The arrows step by 50 and stop at 50; you can type any value. Below about 200 prints get very slow for little gain.</dd>
              <dt>Jerk <i>mm/s</i></dt>
              <dd>How much speed may change instantly at a corner without slowing down first. Lower is smoother. Marlin printers: 5–10.</dd>
            </dl>
          </details>
          <div class="grid2">
            <label class="field" title="The outside of the model: slower looks smoother">
              <span>Outer wall <i>mm/s</i></span>
              <input type="number" min="5" max="500" step="5" placeholder="preset" value={o.speedOuterWall ?? ''} onchange={(e) => setOverride('speedOuterWall', num(e))} />
            </label>
            <label class="field">
              <span>Inner walls <i>mm/s</i></span>
              <input type="number" min="5" max="500" step="5" placeholder="preset" value={o.speedInnerWall ?? ''} onchange={(e) => setOverride('speedInnerWall', num(e))} />
            </label>
            <label class="field">
              <span>Infill <i>mm/s</i></span>
              <input type="number" min="5" max="500" step="5" placeholder="preset" value={o.speedInfill ?? ''} onchange={(e) => setOverride('speedInfill', num(e))} />
            </label>
            <label class="field">
              <span>Top surface <i>mm/s</i></span>
              <input type="number" min="5" max="500" step="5" placeholder="preset" value={o.speedTop ?? ''} onchange={(e) => setOverride('speedTop', num(e))} />
            </label>
            <label class="field" title="A slow first layer sticks better">
              <span>First layer <i>mm/s</i></span>
              <input type="number" min="5" max="200" step="5" placeholder="preset" value={o.speedFirstLayer ?? ''} onchange={(e) => setOverride('speedFirstLayer', num(e))} />
            </label>
            <label class="field" title="Moves without printing">
              <span>Travel <i>mm/s</i></span>
              <input type="number" min="10" max="1000" step="10" placeholder="preset" value={o.speedTravel ?? ''} onchange={(e) => setOverride('speedTravel', num(e))} />
            </label>
            <label class="field" title="How hard the printer speeds up and slows down, for every kind of move. Lower stops shaking (ringing, layer shifts) on big bed-slingers.">
              <span>Acceleration <i>mm/s²</i></span>
              <input type="number" min="50" max="50000" step="50" placeholder="preset" value={o.acceleration ?? ''} onchange={(e) => setOverride('acceleration', num(e))} />
            </label>
          </div>
          <details class="more">
            <summary>Fine tuning: more speeds, acceleration, jerk and smoothing</summary>
            <h5 class="mini-head">More speeds</h5>
            <div class="grid2">
              {@render nf('speedBridge', 'Bridges', 'mm/s', 5, 300, 5)}
              {@render nf('speedGapFill', 'Gap fill', 'mm/s', 5, 300, 5)}
              {@render nf('speedSupport', 'Supports', 'mm/s', 5, 300, 5)}
              {@render nf('speedSupportInterface', 'Support top', 'mm/s', 5, 300, 5, 'Where the support touches the model')}
              <label class="field" title="Holes and thin posts. A number is mm/s; with % it is that share of the outer wall speed.">
                <span>Small perimeters <i>mm/s or %</i></span>
                <input type="text" placeholder="preset" value={o.speedSmallPerimeter ?? ''} onchange={(e) => setOverride('speedSmallPerimeter', e.currentTarget.value.trim() || undefined)} />
              </label>
              {@render nf('speedFirstLayerTravel', 'First-layer travel', 'mm/s', 10, 500, 10)}
              <label class="field" title="Print overhangs slower, more as they get steeper, so they curl less">
                <span>Slow on overhangs</span>
                <select value={o.slowOverhangs === undefined ? '' : o.slowOverhangs ? 'on' : 'off'} onchange={(e) => setOverride('slowOverhangs', e.currentTarget.value === '' ? undefined : e.currentTarget.value === 'on')}>
                  <option value="">Preset</option>
                  <option value="on">On</option>
                  <option value="off">Off</option>
                </select>
              </label>
            </div>
            <h5 class="mini-head">Acceleration per move <i>mm/s²</i></h5>
            <div class="grid2">
              {@render nf('accelOuterWall', 'Outer wall', 'mm/s²', 50, 50000, 50, 'Lower gives a smoother outside with less ringing')}
              {@render nf('accelInnerWall', 'Inner walls', 'mm/s²', 50, 50000, 50)}
              {@render nf('accelTop', 'Top surface', 'mm/s²', 50, 50000, 50)}
              {@render nf('accelInfill', 'Infill', 'mm/s²', 50, 50000, 50)}
              {@render nf('accelBridge', 'Bridges', 'mm/s²', 50, 50000, 50)}
              {@render nf('accelTravel', 'Travel', 'mm/s²', 50, 50000, 50)}
              {@render nf('accelFirstLayer', 'First layer', 'mm/s²', 50, 50000, 50)}
            </div>
            <h5 class="mini-head">Jerk and smoothing</h5>
            <div class="grid2">
              {@render nf('jerk', 'Jerk, all moves', 'mm/s', 0, 50, 1, 'How fast the printer may change direction without slowing (Marlin, RepRapFirmware). Lower is smoother; 0 leaves the printer its own.')}
              {@render nf('jerkOuterWall', 'Jerk, outer wall', 'mm/s', 0, 50, 1)}
              {@render nf('junctionDeviation', 'Junction deviation', 'mm', 0, 0.3, 0.005, 'For printers set to Marlin 2 firmware (older Marlin uses jerk instead). Smaller rounds corners more gently; typical 0.01–0.08. 0 leaves the printer its own.')}
              {@render nf('accelToDecel', 'Accel to decel (Klipper)', '%', 0, 100, 5, 'Klipper max_accel_to_decel as a share of the acceleration: lower means smoother, slower corners. 0 turns it off.')}
            </div>
            <h5 class="mini-head">Flow and cooling</h5>
            <div class="grid2">
              {@render nf('maxFlow', 'Max flow', 'mm³/s', 1, 100, 0.5, 'The most plastic the hotend can melt. Every speed is capped to stay under it. Stock hotends: about 10–15 for PLA.')}
              {@render nf('pressureAdvance', 'Pressure advance', 'K', 0, 2, 0.005, 'Linear/pressure advance factor for sharper corners. Bowden: about 0.3–1.0; direct drive: 0.02–0.1. 0 turns it off.')}
              <label class="field" title="Slow down small layers so each one has time to cool">
                <span>Slow for cooling</span>
                <select value={o.coolingSlowdown === undefined ? '' : o.coolingSlowdown ? 'on' : 'off'} onchange={(e) => setOverride('coolingSlowdown', e.currentTarget.value === '' ? undefined : e.currentTarget.value === 'on')}>
                  <option value="">Preset</option>
                  <option value="on">On</option>
                  <option value="off">Off</option>
                </select>
              </label>
              {@render nf('minLayerTime', 'Min layer time', 's', 0, 120, 1)}
              {@render nf('minSpeed', 'Slowest allowed', 'mm/s', 1, 100, 1, 'Cooling never slows printing below this')}
            </div>
          </details>
          <h4 class="sub-head">Brim and skirt</h4>
          <div class="grid2">
            <label class="field">
              <span>Brim</span>
              <select value={brimType ?? ''} onchange={(e) => setBrim((e.currentTarget.value || undefined) as BrimType | undefined)}>
                <option value="">Preset</option>
                <option value="none">None</option>
                <option value="outer">Outside</option>
                <option value="inner">Inside holes</option>
                <option value="both">Outside and inside</option>
                <option value="auto">Auto</option>
                <option value="ears">Mouse ears (corners)</option>
              </select>
            </label>
            <label class="field">
              <span>Brim width <i>mm</i></span>
              <input type="number" min="1" max="30" step="1" placeholder="preset" disabled={brimType === 'none'} value={o.brimWidth ?? ''} onchange={(e) => setOverride('brimWidth', num(e))} />
            </label>
            <label class="field" title="Space between the brim and the model; a small gap makes the brim easier to peel off">
              <span>Brim gap <i>mm</i></span>
              <input type="number" min="0" max="2" step="0.05" placeholder="preset" disabled={brimType === 'none'} value={o.brimGap ?? ''} onchange={(e) => setOverride('brimGap', num(e))} />
            </label>
            <label class="field" title="A skirt is a loop around the model that primes the nozzle. A draft shield is a skirt as tall as the model that keeps drafts off ABS and ASA.">
              <span>Skirt</span>
              <select value={o.skirt ?? ''} onchange={(e) => setOverride('skirt', (e.currentTarget.value || undefined) as SkirtMode | undefined)}>
                <option value="">Preset</option>
                <option value="off">None</option>
                <option value="skirt">Skirt</option>
                <option value="shield">Draft shield (full height)</option>
              </select>
            </label>
            <label class="field">
              <span>Skirt loops</span>
              <input type="number" min="1" max="20" step="1" placeholder="1" disabled={!o.skirt || o.skirt === 'off'} value={o.skirtLoops ?? ''} onchange={(e) => setOverride('skirtLoops', num(e))} />
            </label>
            <label class="field">
              <span>Skirt distance <i>mm</i></span>
              <input type="number" min="0" max="60" step="0.5" placeholder="preset" disabled={o.skirt === 'off'} value={o.skirtDistance ?? ''} onchange={(e) => setOverride('skirtDistance', num(e))} />
            </label>
            <label class="field">
              <span>Skirt height <i>layers</i></span>
              <input type="number" min="1" max="100" step="1" placeholder="preset" disabled={o.skirt === 'off' || o.skirt === 'shield'} value={o.skirtHeight ?? ''} onchange={(e) => setOverride('skirtHeight', num(e))} />
            </label>
          </div>
          <h4 class="sub-head">Fans</h4>
          <div class="grid2">
            <label class="field" title="The part-cooling fan blows on the plastic as it leaves the nozzle. Turn it off for ABS, ASA, PC or nylon.">
              <span>Part-cooling fan</span>
              <select value={o.coolingOff ? 'off' : ''} onchange={(e) => setOverride('coolingOff', e.currentTarget.value === 'off' ? true : undefined)}>
                <option value="">On (preset or below)</option>
                <option value="off">Off for the whole print</option>
              </select>
            </label>
            <label class="field" title="Side or auxiliary part-cooling fan, on printers that have one">
              <span>Side / aux fan <i>%</i></span>
              <input type="number" min="0" max="100" step="5" placeholder="preset" disabled={o.coolingOff} value={o.coolingOff ? 0 : (o.auxFan ?? '')} onchange={(e) => setOverride('auxFan', num(e))} />
            </label>
            <label class="field">
              <span>Fan min <i>%</i></span>
              <input type="number" min="0" max="100" step="5" placeholder="preset" disabled={o.coolingOff} value={o.coolingOff ? 0 : (o.fanMin ?? '')} onchange={(e) => setOverride('fanMin', num(e))} />
            </label>
            <label class="field">
              <span>Fan max <i>%</i></span>
              <input type="number" min="0" max="100" step="5" placeholder="preset" disabled={o.coolingOff} value={o.coolingOff ? 0 : (o.fanMax ?? '')} onchange={(e) => setOverride('fanMax', num(e))} />
            </label>
            <label class="field" title="Fan speed while printing overhangs and bridges. 0 turns the extra overhang cooling off.">
              <span>Overhangs, bridges <i>%</i></span>
              <input type="number" min="0" max="100" step="5" placeholder="preset" disabled={o.coolingOff} value={o.coolingOff ? 0 : (o.overhangFan ?? '')} onchange={(e) => setOverride('overhangFan', num(e))} />
            </label>
            <label class="field">
              <span>Off for first <i>layers</i></span>
              <input type="number" min="0" max="50" step="1" placeholder="preset" disabled={o.coolingOff} value={o.fanOffLayers ?? ''} onchange={(e) => setOverride('fanOffLayers', num(e))} />
            </label>
            <label class="field">
              <span>Full speed from <i>layer</i></span>
              <input type="number" min="0" max="100" step="1" placeholder="preset" disabled={o.coolingOff} value={o.fanFullLayer ?? ''} onchange={(e) => setOverride('fanFullLayer', num(e))} />
            </label>
            <label class="field" title="Chamber exhaust or air-filter fan during the print, on printers that have one. 0 keeps it off.">
              <span>Exhaust fan <i>%</i></span>
              <input type="number" min="0" max="100" step="5" placeholder="preset" value={o.exhaustFan ?? ''} onchange={(e) => setOverride('exhaustFan', num(e))} />
            </label>
          </div>
          <p class="hint">The hotend heatsink fan is not here on purpose: the printer runs it whenever the nozzle is hot, and turning it off would clog the nozzle.</p>
          <button class="ghost all-btn" onclick={() => (sl.allSettings = true)}>
            <Icon name="settings" size={13} />All slicer settings{extraCount ? ` · ${extraCount} changed` : ''}
          </button>
        </section>
      {/if}

      {#if result && summary}
        <section>
          <h3 class="hud-label row-head">
            Sliced
            {#if sl.stale}<span class="pill warn" title="The model changed after slicing">Out of date</span>{/if}
          </h3>
          <div class="stats">
            <div><span class="k">Time</span><span class="v mono">{summary.printTime ?? '—'}</span></div>
            <div><span class="k">Filament</span><span class="v mono">{summary.filamentG !== null ? `${summary.filamentG.toFixed(1)} g` : '—'}</span></div>
            <div><span class="k">Length</span><span class="v mono">{summary.filamentMm !== null ? `${(summary.filamentMm / 1000).toFixed(2)} m` : '—'}</span></div>
            <div><span class="k">Layers</span><span class="v mono">{summary.layers ?? '—'}</span></div>
            <div class="cost" title="Filament{prices.kwh > 0 ? ' plus electricity' : ''}, at your prices">
              <span class="k">Cost</span><span class="v mono">{fmtMoney(printCost('fdm', summary.filamentG, summary.printSeconds)?.total)}</span>
            </div>
          </div>
          <PricesEditor kind="fdm" />
          <div class="row">
            <button class="ghost" class:on={sl.preview.on} disabled={!sl.preview.ready} onclick={() => setPreviewOn(!sl.preview.on)}>
              {#if sl.preview.loading}<span class="spinner"></span>{:else}<Icon name="layers" size={14} />{/if}
              {sl.preview.on ? 'Show model' : 'Show toolpaths'}
            </button>
            {#if sl.gcodeFolder}
              <button class="ghost" title="Save into {sl.gcodeFolder}" onclick={() => saveGcode()}><Icon name="save" size={14} />Save to {folderLabel(sl.gcodeFolder)}</button>
            {:else}
              <button class="ghost" onclick={() => saveGcode(true)}><Icon name="save" size={14} />Save G-code</button>
            {/if}
          </div>
          <p class="hint small mono">{result.gcodeName} · {fmtBytes(result.gcodeSize ?? 0)}</p>
          <p class="hint small save-to">
            {#if sl.gcodeFolder}Saves to <span class="mono" title={sl.gcodeFolder}>{sl.gcodeFolder}</span> ·{/if}
            <button class="link" onclick={chooseGcodeFolder}>{sl.gcodeFolder ? 'Change folder' : 'Choose a folder (e.g. USB stick)'}</button>
            · <button class="link" onclick={() => saveGcode(true)}>Save as…</button>
          </p>
        </section>

        <section>
          <h3 class="hud-label row-head">
            Print
            <button class="link" onclick={() => (sl.managePrinters = true)}>{fdmPrinters.length ? 'Printers' : 'Add printer'}</button>
          </h3>
          {#if fdmPrinters.length}
            <label class="field">
              <span>Send to</span>
              <select value={printer?.id ?? ''} onchange={(e) => choosePrinter(e.currentTarget.value)}>
                {#each fdmPrinters as p}<option value={p.id}>{p.name} · {kindLabel[p.kind]}</option>{/each}
              </select>
            </label>
            {#if printer?.kind !== 'serial'}
              <label class="check">
                <input type="checkbox" checked={sl.startPrint} onchange={(e) => (sl.startPrint = e.currentTarget.checked)} />
                Start printing after upload
              </label>
            {/if}
            <button class="primary wide" disabled={sl.sending || usbActive() || sl.stale} onclick={() => { if (printer) choosePrinter(printer.id); sendToPrinter() }}>
              {#if sl.sending}<span class="spinner"></span>{:else}<Icon name={printer?.kind === 'serial' ? 'usb' : 'send'} size={15} />{/if}
              {printer?.kind === 'serial' ? 'Print over USB' : sl.startPrint ? 'Send & print' : 'Upload'}
            </button>
            {#if sl.stale}<p class="hint small">Slice again first: the model changed.</p>{/if}
            {#if sl.sendResult}<p class={sl.sendResult.ok ? 'ok' : 'err'}>{sl.sendResult.detail}</p>{/if}
          {:else}
            <p class="hint">Add a printer on your network (OctoPrint, Klipper/Moonraker, PrusaLink, Flashforge) or one on a USB cable to print straight from Boaty.</p>
          {/if}
        </section>
      {/if}

      {#if usb.status !== 'idle' || usb.message}
        <section>
          <h3 class="hud-label row-head">
            USB print
            <span class="dim">{usb.name}</span>
          </h3>
          {#if usb.status === 'printing' || usb.status === 'paused' || usb.status === 'stopping'}
            <div class="bar"><span style:width={pct(usbPct)}></span></div>
            <div class="row mono small">
              <span>{pct(usbPct)} · {usb.sent.toLocaleString()} / {usb.total.toLocaleString()} lines</span>
            </div>
            {#if usb.temps.hotend !== undefined || usb.temps.bed !== undefined}
              <div class="row mono small">
                {#if usb.temps.hotend !== undefined}<span>Nozzle {usb.temps.hotend.toFixed(0)}/{usb.temps.hotendTarget?.toFixed(0)}°C</span>{/if}
                {#if usb.temps.bed !== undefined}<span>Bed {usb.temps.bed.toFixed(0)}/{usb.temps.bedTarget?.toFixed(0)}°C</span>{/if}
              </div>
            {/if}
            <div class="row">
              <button class="ghost" disabled={usb.status === 'stopping'} onclick={() => pauseUsb(usb.status !== 'paused')}>
                <Icon name={usb.status === 'paused' ? 'play' : 'pause'} size={14} />{usb.status === 'paused' ? 'Resume' : 'Pause'}
              </button>
              <button class="ghost danger" disabled={usb.status === 'stopping'} onclick={cancelUsb}><Icon name="stop" size={14} />Stop</button>
            </div>
            <p class="hint small">Keep Boaty open until the print finishes.</p>
          {/if}
          {#if usb.message}<p class={usb.status === 'error' ? 'err' : 'hint'}>{usb.message}</p>{/if}
        </section>
      {/if}

      {#if sl.error}<p class="err pad">{sl.error}</p>{/if}
    {/if}
  </div>

  {#if engine?.source}
    <footer class="foot">
      {#if sl.slicing}
        <button class="primary wide" onclick={cancelSlice}><span class="spinner"></span>Slicing… {fmtTime(elapsed)} · Cancel</button>
      {:else}
        <button class="primary wide" disabled={!machine || !sl.settings.process || !sl.settings.filament} onclick={slice}>
          <Icon name="layers" size={15} />{result ? 'Slice again' : 'Slice'}
        </button>
      {/if}
      <p class="note">
        Engine: OrcaSlicer {engine.source === 'birdy' ? engine.version : ''} ({engine.source === 'birdy' ? 'installed by Boaty' : engine.source === 'installed' ? 'your OrcaSlicer' : 'development copy'}), AGPL-3.0
      </p>
    </footer>
  {/if}
{/if}

<style>
  .own {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
  }
  .own .sm {
    height: 26px;
    font-size: 11px;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .warn {
    font-style: normal;
    font-size: 10px;
    color: #ff7a59;
  }
  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0 12px;
  }
  section {
    padding: 12px 0;
    border-bottom: 1px solid var(--border);
  }
  section:last-child {
    border-bottom: 0;
  }
  h3 {
    margin: 0 0 8px;
  }
  .row-head {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .row-head .link,
  .row-head .mini,
  .row-head .pill {
    margin-left: auto;
  }
  .dim {
    color: var(--faint);
    font-weight: 400;
    letter-spacing: 0.05em;
    text-transform: none;
  }
  .body {
    margin: 0 0 10px;
    color: var(--muted);
    font-size: 12px;
    line-height: 1.5;
  }
  .hint {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 6px 0 0;
    font-size: 12px;
    color: var(--muted);
  }
  .save-to {
    flex-wrap: wrap;
    gap: 4px;
  }
  .save-to .mono {
    max-width: 150px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hint.small,
  .small {
    font-size: 11px;
    color: var(--faint);
  }
  .err {
    margin: 8px 0 0;
    font-size: 12px;
    color: var(--danger);
  }
  .ok {
    margin: 8px 0 0;
    font-size: 12px;
    color: var(--ok);
  }
  .pad {
    padding: 0 0 12px;
  }
  .wide {
    width: 100%;
    justify-content: center;
  }
  .primary.wide {
    height: 36px;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    margin-top: 8px;
  }
  .row .ghost {
    flex: 1;
    justify-content: center;
    font-size: 12px;
  }
  .ghost.on {
    color: var(--accent);
    border-color: var(--neon-line);
    box-shadow: var(--glow-sm);
  }
  .ghost.danger:hover {
    color: var(--danger);
  }
  .bar {
    height: 6px;
    border-radius: 3px;
    background: var(--bg);
    border: 1px solid var(--border-strong);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--accent);
    box-shadow: var(--glow-sm);
    transition: width 0.25s;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 10px;
    border-radius: 14px;
    border: 1px solid var(--border-strong);
    background: var(--bg);
    color: var(--text);
    font-size: 12px;
  }
  .chip:hover:not(:disabled) {
    border-color: var(--neon-line);
    color: var(--accent);
    box-shadow: var(--glow-sm);
  }
  .notes {
    margin: 10px 0 0;
    padding-left: 16px;
    font-size: 12px;
    color: var(--muted);
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 8px;
    min-width: 0;
  }
  .field > span {
    font-size: 11px;
    color: var(--muted);
  }
  .field i {
    font-style: normal;
    color: var(--faint);
  }
  select,
  input[type='number'] {
    width: 100%;
    min-width: 0;
    height: 28px;
    padding: 0 6px;
    border-radius: 6px;
    background: var(--bg);
    border: 1px solid var(--border-strong);
    color: var(--text);
    outline: none;
    font: inherit;
    font-size: 12px;
  }
  select:focus,
  input:focus {
    border-color: var(--neon-line);
    box-shadow: var(--glow-sm);
  }
  input::placeholder {
    color: var(--faint);
  }
  select option,
  select optgroup {
    background: var(--panel);
  }
  select:disabled,
  input:disabled {
    opacity: 0.5;
  }
  .sub-head {
    margin: 8px 0 6px;
    font-size: 11px;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .more {
    margin: 2px 0 8px;
    font-size: 12px;
    color: var(--muted);
  }
  .more summary {
    cursor: pointer;
    padding: 4px 0;
  }
  .more summary:hover {
    color: var(--text);
  }
  .units dl {
    margin: 4px 0 0;
    font-size: 11px;
    line-height: 1.45;
  }
  .units dt {
    margin-top: 6px;
    font-weight: 600;
    color: var(--text);
  }
  .units dt i {
    font-style: normal;
    font-weight: 400;
    color: var(--faint);
  }
  .units dd {
    margin: 2px 0 0;
  }
  .units .ranges {
    color: var(--text);
  }
  .mini-head {
    margin: 8px 0 6px;
    font-size: 11px;
    font-weight: 600;
    color: var(--text);
  }
  .mini-head i {
    font-style: normal;
    font-weight: 400;
    color: var(--faint);
  }
  .all-btn {
    width: 100%;
    height: 30px;
    margin-top: 8px;
    font-size: 12px;
  }
  .grid2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0 8px;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: var(--muted);
    margin: 2px 0 8px;
  }
  .check input {
    accent-color: var(--accent);
  }
  .link {
    color: var(--accent);
    font-size: 11px;
    letter-spacing: 0;
    text-transform: none;
    font-weight: 600;
  }
  .link:hover {
    text-shadow: var(--glow-text);
  }
  .mini {
    width: 24px;
    height: 24px;
  }
  .pill {
    display: inline-block;
    padding: 1px 8px;
    border-radius: 10px;
    font-size: 10px;
    letter-spacing: 0;
    text-transform: none;
  }
  .pill.warn {
    color: var(--accent);
    background: rgba(var(--accent-rgb), 0.12);
    box-shadow: 0 0 0 1px var(--neon-line);
  }
  .stats {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }
  .stats .cost {
    grid-column: span 2;
  }
  .stats > div {
    display: flex;
    flex-direction: column;
    padding: 7px 8px;
    border-radius: var(--r-md);
    background: var(--bg);
    border: 1px solid var(--border);
  }
  .stats .k {
    font-size: 10px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .stats .v {
    font-size: 14px;
    color: var(--text);
  }
  .picker {
    border: 1px solid var(--neon-line);
    border-radius: var(--r-md);
    padding: 10px;
    margin-top: 10px;
    box-shadow: var(--glow-sm);
  }
  .ports {
    list-style: none;
    margin: 0 0 8px;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .ports .ghost {
    justify-content: flex-start;
    gap: 8px;
  }
  .pname {
    flex: 1;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .foot {
    padding: 12px;
    border-top: 1px solid var(--neon-soft);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .note {
    margin: 0;
    font-size: 10px;
    color: var(--faint);
    text-align: center;
  }
</style>
