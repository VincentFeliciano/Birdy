<script lang="ts">
  import { onMount } from 'svelte'
  import Icon from '../../components/Icon.svelte'
  import { EXTRA_BLOCKED, EXTRA_KEY, overrideKeys } from '../../../electron/slicing/presets'
  import { setExtra, sl } from './store.svelte'

  // Every setting the engine uses for the chosen printer, process and filament, read back from it.
  // Changes are kept with the slice settings and go into every slice on top of the presets.

  const CATEGORIES: [string, RegExp][] = [
    ['Cooling and fans', /fan|cool|slow_down|air_filtration|exhaust/],
    ['Supports and raft', /support|raft/],
    ['Brim and skirt', /brim|skirt|draft_shield/],
    ['Temperatures', /temp/],
    ['Speed and acceleration', /speed|accel|jerk/],
    ['Walls, top and bottom', /wall|shell|top_|bottom_|perimeter|seam|surface|overhang/],
    ['Infill and ironing', /infill|ironing|bridge/],
    ['Layers and lines', /layer|line_width|resolution|precision|elephant|xy_/],
    ['Retraction and travel', /retract|z_hop|wipe|travel|deretraction|coast/],
    ['Filament', /^filament_|flow|pressure_advance|shrink|density|cost/],
    ['Printer and G-code', /machine_|printable|bed|nozzle|extruder|gcode|printer|thumbnail|chamber/],
  ]
  const OTHER = 'Other'
  const categoryOf = (k: string) => CATEGORIES.find(([, re]) => re.test(k))?.[0] ?? OTHER

  /** Choices for settings that only take certain words (checked against the engine). */
  const CHOICES: Record<string, [string, string][]> = {
    brim_type: [['no_brim', 'No brim'], ['outer_only', 'Outer only'], ['inner_only', 'Inner only'], ['outer_and_inner', 'Outer and inner'], ['auto_brim', 'Auto'], ['brim_ears', 'Mouse ears'], ['painted', 'Painted']],
    support_type: [['normal(auto)', 'Normal (auto)'], ['tree(auto)', 'Tree (auto)'], ['normal(manual)', 'Normal (painted only)'], ['tree(manual)', 'Tree (painted only)']],
    support_style: [['default', 'Default'], ['grid', 'Grid'], ['snug', 'Snug'], ['tree_slim', 'Tree slim'], ['tree_strong', 'Tree strong'], ['tree_hybrid', 'Tree hybrid'], ['organic', 'Organic']],
    skirt_type: [['combined', 'One skirt around everything'], ['perobject', 'One skirt per object']],
    draft_shield: [['disabled', 'Off'], ['enabled', 'On (full-height skirt)']],
  }

  const words: Record<string, string> = { gcode: 'G-code', z: 'Z', x: 'X', y: 'Y', xy: 'XY', pa: 'PA', id: 'ID', abs: 'ABS', tpu: 'TPU', pla: 'PLA', petg: 'PETG', aux: 'Aux' }
  const label = (k: string) => {
    const s = k
      .split('_')
      .map((w) => words[w] ?? w)
      .join(' ')
    return s.charAt(0).toUpperCase() + s.slice(1)
  }

  let defaults = $state<Record<string, string>>({})
  let loading = $state(true)
  let error = $state<string | null>(null)
  let search = $state('')
  let changedOnly = $state(false)
  let open = $state<Record<string, boolean>>({ 'Cooling and fans': true, 'Supports and raft': true, 'Brim and skirt': true })

  const extra = $derived(sl.settings.overrides.extra ?? {})
  /** Keys the quick "Adjust" fields set; those win, so they are shown but changed there. */
  const quick = $derived.by(() => {
    const { extra: _, ...o } = sl.settings.overrides
    return { ...overrideKeys('machine', o), ...overrideKeys('process', o), ...overrideKeys('filament', o) } as Record<string, string | string[]>
  })

  onMount(async () => {
    try {
      defaults = await window.api.engine.resolve({ machine: sl.settings.machine, process: sl.settings.process || undefined, filament: sl.settings.filament || undefined })
    } catch (err) {
      error = String((err as Error).message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
    } finally {
      loading = false
    }
  })

  const keys = $derived(Object.keys(defaults).filter((k) => EXTRA_KEY.test(k) && !EXTRA_BLOCKED.has(k)))
  const groups = $derived.by(() => {
    const q = search.trim().toLowerCase()
    const qk = q.replace(/\s+/g, '_')
    const out = new Map<string, string[]>()
    for (const k of keys) {
      if (changedOnly && !(k in extra) && !(k in quick)) continue
      if (q && !k.includes(qk) && !label(k).toLowerCase().includes(q)) continue
      const c = categoryOf(k)
      if (!out.has(c)) out.set(c, [])
      out.get(c)!.push(k)
    }
    for (const list of out.values()) list.sort()
    return [...CATEGORIES.map(([c]) => c), OTHER].filter((c) => out.has(c)).map((c) => ({ name: c, keys: out.get(c)! }))
  })
  const changedCount = $derived(Object.keys(extra).length)

  const value = (k: string) => (k in quick ? [quick[k]].flat().join(',') : (extra[k] ?? defaults[k] ?? ''))
  function set(k: string, v: string) {
    if (v === (defaults[k] ?? '')) setExtra(k, undefined)
    else setExtra(k, v.slice(0, 20000))
  }
  function resetAll() {
    if (!confirm(`Put all ${changedCount} changed setting${changedCount === 1 ? '' : 's'} back to the presets?`)) return
    for (const k of Object.keys(extra)) setExtra(k, undefined)
  }
  const close = () => (sl.allSettings = false)
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && close()} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="scrim" onclick={close}>
  <div class="dlg neon-panel" role="dialog" aria-modal="true" aria-label="All slicer settings" tabindex="-1" onclick={(e) => e.stopPropagation()}>
    <header>
      <h2>All slicer settings</h2>
      <button class="icon-btn" aria-label="Close" title="Close" onclick={close}><Icon name="close" size={14} /></button>
    </header>
    <p class="sub">
      Every OrcaSlicer setting for <b>{sl.settings.machine}</b>{sl.settings.filament ? `, ${sl.settings.filament}` : ''}. Changes apply to your next slice; the presets themselves are not changed.
    </p>
    <div class="tools">
      <input class="search" type="search" placeholder="Search {keys.length} settings, e.g. fan, brim, skirt, retraction" bind:value={search} />
      <label class="check"><input type="checkbox" bind:checked={changedOnly} />Changed only</label>
      {#if changedCount}<button class="link" onclick={resetAll}>Reset {changedCount} change{changedCount === 1 ? '' : 's'}</button>{/if}
    </div>

    <div class="body">
      {#if loading}
        <p class="sub"><span class="spinner"></span> Asking the slicer for its settings…</p>
      {:else if error}
        <p class="err">{error}</p>
      {:else}
        {#each groups as g (g.name)}
          <details open={open[g.name] || !!search.trim() || changedOnly} ontoggle={(e) => (open[g.name] = (e.currentTarget as HTMLDetailsElement).open)}>
            <summary>{g.name} <span class="n">{g.keys.length}</span></summary>
            <div class="all">
              {#each g.keys as k (k)}
                {@const long = /gcode|notes|template/.test(k)}
                {@const locked = k in quick}
                <label class="row" class:chg={k in extra || locked} title={k}>
                  <span class="k"><span>{label(k)}</span><span class="mono key">{k}</span></span>
                  {#if CHOICES[k]}
                    <select disabled={locked} value={value(k)} onchange={(e) => set(k, e.currentTarget.value)}>
                      {#if !CHOICES[k]!.some(([v]) => v === value(k))}<option value={value(k)}>{value(k)}</option>{/if}
                      {#each CHOICES[k]! as [v, l]}<option value={v}>{l}</option>{/each}
                    </select>
                  {:else if long}
                    <textarea rows="3" spellcheck="false" disabled={locked} value={value(k)} onchange={(e) => set(k, e.currentTarget.value)}></textarea>
                  {:else}
                    <input type="text" spellcheck="false" disabled={locked} value={value(k)} onchange={(e) => set(k, e.currentTarget.value)} />
                  {/if}
                  {#if locked}
                    <span class="tag" title="Set in the slice panel's Adjust section; change it there">Adjust</span>
                  {:else if k in extra}
                    <button class="icon-btn mini" title="Back to the preset ({defaults[k] || 'blank'})" aria-label="Reset {k}" onclick={(e) => (e.preventDefault(), setExtra(k, undefined))}><Icon name="reset" size={11} /></button>
                  {:else}<span></span>{/if}
                </label>
              {/each}
            </div>
          </details>
        {:else}
          <p class="sub">No settings match.</p>
        {/each}
      {/if}
    </div>
    <footer>
      <span class="sub grow">Values are written the way OrcaSlicer stores them: lists are separated by commas, percentages end in %.</span>
      <button class="primary" onclick={close}>Done</button>
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
    width: min(900px, calc(100vw - 40px));
    height: calc(100vh - 60px);
    display: flex;
    flex-direction: column;
    padding: 16px 18px;
    gap: 10px;
  }
  header,
  .tools,
  footer {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  header {
    justify-content: space-between;
  }
  h2 {
    margin: 0;
    font-size: 15px;
  }
  .sub {
    margin: 0;
    font-size: 11px;
    color: var(--muted);
  }
  .sub b {
    color: var(--text);
  }
  .grow,
  .search {
    flex: 1;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--muted);
    white-space: nowrap;
  }
  .check input {
    height: auto;
    accent-color: var(--accent);
  }
  .body {
    flex: 1;
    overflow: auto;
    padding-right: 4px;
  }
  details {
    border-bottom: 1px solid var(--border);
    padding: 6px 0;
  }
  summary {
    cursor: pointer;
    font-size: 12px;
    font-weight: 600;
    color: var(--text);
    padding: 4px 0;
  }
  summary .n {
    font-weight: 400;
    color: var(--faint);
    margin-left: 4px;
  }
  .all {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px 0 4px;
  }
  .row {
    display: grid;
    grid-template-columns: 300px 1fr 46px;
    gap: 8px;
    align-items: center;
  }
  .k {
    display: flex;
    flex-direction: column;
    min-width: 0;
    font-size: 12px;
    color: var(--muted);
  }
  .k > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .key {
    font-size: 10px;
    color: var(--faint);
  }
  .row.chg .k > span:first-child {
    color: var(--accent);
  }
  input,
  select,
  textarea {
    min-width: 0;
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
  :disabled {
    opacity: 0.6;
  }
  .tag {
    font-size: 10px;
    color: var(--accent);
    text-align: center;
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
    white-space: nowrap;
  }
  .err {
    margin: 0;
    color: #ff7a59;
    font-size: 12px;
  }
</style>
