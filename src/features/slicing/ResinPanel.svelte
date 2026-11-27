<script lang="ts">
  import Icon from '../../components/Icon.svelte'
  import { fmtBytes } from '../../app/format'
  import { RESIN_PRINTERS, type ResinPrinter, type ResinSettings } from '../../engine/resin/printers'
  import { activeModel, ws } from '../workspace/store.svelte'
  import {
    cancelResinSlice,
    choosePrinter,
    clearResult,
    makeExposureTest,
    pickIsland,
    resetSettings,
    resin,
    resinPrinter,
    saveResin,
    setCustom,
    setSetting,
    showLayer,
    sliceResinModel,
  } from './resin.svelte'

  const printer = $derived(resinPrinter())
  const s = $derived(resin.settings)
  const r = $derived(resin.result)
  const pxUm = $derived(`${((printer.sizeX / printer.resX) * 1000).toFixed(0)} × ${((printer.sizeY / printer.resY) * 1000).toFixed(0)} µm`)

  // A result belongs to the model it was sliced from.
  $effect(() => {
    if (r && r.modelId !== ws.activeId) clearResult()
  })

  const num = (e: Event) => Number((e.currentTarget as HTMLInputElement).value)
  function setNum<K extends keyof ResinSettings>(key: K, e: Event, min: number, max: number) {
    const v = num(e)
    if (Number.isFinite(v) && v >= min && v <= max) setSetting(key, v as ResinSettings[K])
    else (e.currentTarget as HTMLInputElement).value = String(resin.settings[key])
  }
  function setPrinterNum(key: keyof ResinPrinter, e: Event, min: number, max: number, int = false) {
    const v = num(e)
    if (Number.isFinite(v) && v >= min && v <= max && (!int || Number.isInteger(v))) setCustom(key, v as never)
    else (e.currentTarget as HTMLInputElement).value = String(resin.custom[key])
  }
  const fmtDur = (sec: number) => {
    const h = Math.floor(sec / 3600)
    const m = Math.round((sec % 3600) / 60)
    return h ? `${h}h ${m}m` : `${m}m`
  }
  const pct = (n: number) => `${Math.round(n * 100)}%`
</script>

<div class="scroll">
  <section>
    <h3 class="hud-label">Resin printer</h3>
    <label class="field">
      <span>Printer</span>
      <select value={resin.printerId} onchange={(e) => choosePrinter(e.currentTarget.value)}>
        {#each RESIN_PRINTERS as p}<option value={p.id}>{p.name}</option>{/each}
        <option value="custom">Custom (type the screen specs)</option>
      </select>
    </label>
    {#if resin.printerId === 'custom'}
      <div class="grid2">
        <label class="field"><span>Screen width <i>px</i></span><input type="number" min="500" max="30000" step="1" value={resin.custom.resX} onchange={(e) => setPrinterNum('resX', e, 500, 30000, true)} /></label>
        <label class="field"><span>Screen height <i>px</i></span><input type="number" min="500" max="30000" step="1" value={resin.custom.resY} onchange={(e) => setPrinterNum('resY', e, 500, 30000, true)} /></label>
        <label class="field"><span>Plate width <i>mm</i></span><input type="number" min="20" max="600" step="0.01" value={resin.custom.sizeX} onchange={(e) => setPrinterNum('sizeX', e, 20, 600)} /></label>
        <label class="field"><span>Plate depth <i>mm</i></span><input type="number" min="20" max="600" step="0.01" value={resin.custom.sizeY} onchange={(e) => setPrinterNum('sizeY', e, 20, 600)} /></label>
        <label class="field"><span>Max height <i>mm</i></span><input type="number" min="20" max="600" step="1" value={resin.custom.sizeZ} onchange={(e) => setPrinterNum('sizeZ', e, 20, 600)} /></label>
      </div>
    {/if}
    <p class="hint small mono">{printer.resX} × {printer.resY} px · {printer.sizeX} × {printer.sizeY} × {printer.sizeZ} mm · {pxUm} pixels</p>
    <p class="hint small">Writes Elegoo .goo files. Check that the screen resolution matches your printer’s; it won’t open a file made for a different screen.</p>
  </section>

  <section>
    <h3 class="hud-label row-head">
      Exposure
      <span class="dim">from your resin’s bottle or test print</span>
      <button class="link" onclick={resetSettings}>Reset</button>
    </h3>
    <div class="grid2">
      <label class="field"><span>Layer height <i>mm</i></span><input type="number" min="0.01" max="0.3" step="0.01" value={s.layerHeight} onchange={(e) => setNum('layerHeight', e, 0.01, 0.3)} /></label>
      <label class="field"><span>Exposure <i>s</i></span><input type="number" min="0.1" max="60" step="0.1" value={s.exposure} onchange={(e) => setNum('exposure', e, 0.1, 60)} /></label>
      <label class="field"><span>Bottom exposure <i>s</i></span><input type="number" min="1" max="200" step="1" value={s.bottomExposure} onchange={(e) => setNum('bottomExposure', e, 1, 200)} /></label>
      <label class="field"><span>Bottom layers</span><input type="number" min="1" max="50" step="1" value={s.bottomLayers} onchange={(e) => setNum('bottomLayers', e, 1, 50)} /></label>
      <label class="field"><span>Lift <i>mm</i></span><input type="number" min="1" max="20" step="0.5" value={s.liftDistance} onchange={(e) => setNum('liftDistance', e, 1, 20)} /></label>
      <label class="field"><span>Lift speed <i>mm/min</i></span><input type="number" min="10" max="600" step="5" value={s.liftSpeed} onchange={(e) => setNum('liftSpeed', e, 10, 600)} /></label>
      <label class="field"><span>Bottom lift <i>mm</i></span><input type="number" min="1" max="20" step="0.5" value={s.bottomLiftDistance} onchange={(e) => setNum('bottomLiftDistance', e, 1, 20)} /></label>
      <label class="field"><span>Bottom lift speed <i>mm/min</i></span><input type="number" min="10" max="600" step="5" value={s.bottomLiftSpeed} onchange={(e) => setNum('bottomLiftSpeed', e, 10, 600)} /></label>
      <label class="field"><span>Retract speed <i>mm/min</i></span><input type="number" min="10" max="600" step="5" value={s.retractSpeed} onchange={(e) => setNum('retractSpeed', e, 10, 600)} /></label>
      <label class="field"><span>Light-off wait <i>s</i></span><input type="number" min="0" max="30" step="0.1" value={s.lightOff} onchange={(e) => setNum('lightOff', e, 0, 30)} /></label>
    </div>
    <label class="check">
      <input type="checkbox" checked={s.antialias} onchange={(e) => setSetting('antialias', e.currentTarget.checked)} />
      Smooth edges (anti-aliasing)
    </label>
    <label class="check">
      <input type="checkbox" checked={s.mirror} onchange={(e) => setSetting('mirror', e.currentTarget.checked)} />
      Mirror layer images
    </label>
    <p class="hint small">Birdy slices the model as it is and doesn’t add supports yet, so use pre-supported models or ones that sit flat on the plate.</p>
  </section>

  <section>
    <h3 class="hud-label">New resin?</h3>
    <p class="hint">
      Print the exposure test: five small pieces side by side, from 60% to 140% of the exposure above. Pick the one with crisp pins and open holes,
      then use its time.
    </p>
    <button class="ghost wide test-btn" disabled={resin.slicing} onclick={makeExposureTest}><Icon name="target" size={14} />Make exposure test print</button>
  </section>

  {#if r}
    <section>
      <h3 class="hud-label row-head">{r.test ? 'Exposure test' : 'Sliced'} <span class="dim">{r.printer.name}</span></h3>
      {#if r.test}
        <ol class="levels">
          {#each r.test as t, i}<li><span class="mono">{'•'.repeat(i + 1)}</span><b class="mono">{t} s</b></li>{/each}
        </ol>
        <p class="hint small">Count the dots on each piece to find its time. Too short: thin pins are missing. Too long: small holes close up.</p>
      {/if}
      <div class="stats">
        <div><span class="k">Time</span><span class="v mono">{fmtDur(r.printSeconds)}</span></div>
        <div><span class="k">Resin</span><span class="v mono">{(r.volumeMm3 / 1000).toFixed(1)} ml</span></div>
        <div><span class="k">Weight</span><span class="v mono">{r.weightG.toFixed(1)} g</span></div>
        <div><span class="k">Layers</span><span class="v mono">{r.layers}</span></div>
      </div>
      {#if r.test}
        <!-- The test print has no islands to check. -->
      {:else if r.islandCount}
        <div class="islands">
          <p class="warn-line">
            <Icon name="alert" size={14} />
            <span><b>{r.islandCount} island{r.islandCount === 1 ? '' : 's'}</b>: spots that start in mid-air with nothing under them. They stick to the film or float in the vat. Add a support under each.</span>
          </p>
          <ul>
            {#each r.islands.slice(0, 60) as isl, i}
              <li>
                <button class:on={resin.island === i} onclick={() => pickIsland(i)} title="Show this island">
                  <span class="mono">Layer {isl.layer + 1}</span>
                  <span class="mono dim2">{isl.z.toFixed(2)} mm up · {isl.areaMm2 < 0.1 ? isl.areaMm2.toFixed(3) : isl.areaMm2.toFixed(1)} mm²</span>
                  <Icon name="target" size={12} />
                </button>
              </li>
            {/each}
          </ul>
          {#if r.islandCount > 60}<p class="hint small">Showing the first 60.</p>{/if}
        </div>
      {:else}
        <p class="ok">No islands: every part grows from the layer below.</p>
      {/if}
      {#if resin.layerUrl}
        <div class="layer">
          <img src={resin.layerUrl} alt="Layer {resin.layer + 1}" />
        </div>
        <label class="field slider">
          <span>Layer <b class="mono">{resin.layer + 1}</b> / {r.layers} <i>· {((resin.layer + 1) * s.layerHeight).toFixed(2)} mm</i></span>
          <input type="range" min="0" max={r.layers - 1} value={resin.layer} oninput={(e) => showLayer(Number(e.currentTarget.value))} />
        </label>
      {/if}
      <button class="primary wide" disabled={resin.saving} onclick={saveResin}>
        {#if resin.saving}<span class="spinner"></span>{:else}<Icon name="save" size={15} />{/if}Save .goo file
      </button>
      <p class="hint small mono">{r.name}.goo · {fmtBytes(r.bytes)}</p>
      {#if resin.savedPath}
        <p class="ok">
          Saved. Copy it to the printer’s USB stick.
          <button class="link" onclick={() => resin.savedPath && window.api.resin.reveal(resin.savedPath)}>Show in folder</button>
        </p>
      {/if}
      {#if resin.saveError}<p class="err">{resin.saveError}</p>{/if}
    </section>
  {/if}

  {#if resin.error}<p class="err pad">{resin.error}</p>{/if}
</div>

<footer class="foot">
  {#if resin.slicing}
    <div class="bar"><span style:width={pct(resin.progress)}></span></div>
    <button class="primary wide" onclick={cancelResinSlice}><span class="spinner"></span>Slicing {pct(resin.progress)} · Cancel</button>
  {:else}
    <button class="primary wide" disabled={!activeModel()} onclick={sliceResinModel}>
      <Icon name="layers" size={15} />{r ? 'Slice again' : 'Slice for resin'}
    </button>
  {/if}
  <p class="note">Birdy’s own resin slicer · Elegoo .goo</p>
</footer>

<style>
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
  .row-head .link {
    margin-left: auto;
  }
  .dim {
    color: var(--faint);
    font-weight: 400;
    letter-spacing: 0.05em;
    text-transform: none;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hint {
    margin: 6px 0 0;
    font-size: 12px;
    color: var(--muted);
    line-height: 1.45;
  }
  .hint.small {
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
    margin-top: 10px;
  }
  .foot .primary.wide {
    margin-top: 0;
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
  .field b {
    color: var(--text);
    font-weight: 600;
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
  select option {
    background: var(--panel);
  }
  input[type='range'] {
    width: 100%;
    accent-color: var(--accent);
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
  .stats {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
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
  .test-btn {
    margin-top: 8px;
    height: 30px;
    font-size: 12px;
  }
  .levels {
    list-style: none;
    margin: 0 0 6px;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 4px;
  }
  .levels li {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 5px 2px;
    border-radius: 6px;
    background: var(--bg);
    border: 1px solid var(--border);
    font-size: 11px;
  }
  .levels li span {
    color: var(--accent);
    letter-spacing: -1px;
  }
  .islands {
    margin-top: 10px;
    padding: 8px;
    border-radius: var(--r-md);
    border: 1px solid rgba(255, 61, 242, 0.45);
    background: rgba(255, 61, 242, 0.06);
  }
  .warn-line {
    display: flex;
    gap: 8px;
    margin: 0 0 6px;
    font-size: 12px;
    line-height: 1.4;
    color: var(--muted);
  }
  .warn-line :global(svg) {
    flex: none;
    margin-top: 1px;
    color: #ff3df2;
  }
  .warn-line b {
    color: var(--text);
  }
  .islands ul {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 150px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .islands li button {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 4px 6px;
    border: 0;
    border-radius: 5px;
    background: none;
    color: var(--text);
    font: inherit;
    font-size: 11px;
    text-align: left;
    cursor: pointer;
  }
  .islands li button:hover,
  .islands li button.on {
    background: rgba(255, 61, 242, 0.14);
  }
  .islands li button.on {
    box-shadow: inset 0 0 0 1px rgba(255, 61, 242, 0.6);
  }
  .dim2 {
    flex: 1;
    color: var(--faint);
  }
  .layer {
    margin-top: 10px;
    border-radius: var(--r-md);
    border: 1px solid var(--neon-line);
    background: #0c0d10;
    overflow: hidden;
    box-shadow: var(--glow-sm);
  }
  .layer img {
    display: block;
    width: 100%;
    image-rendering: auto;
  }
  .slider {
    margin-top: 8px;
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
