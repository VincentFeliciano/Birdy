<script lang="ts">
  import { onDestroy } from 'svelte'
  import Icon from '../../components/Icon.svelte'
  import {
    BED,
    addShape,
    writeTextOnPart,
    type ShapeKind,
    splitToFit,
    combineParts,
    cutPart,
    getViewer,
    hollowPart,
    rebuildPart,
    selectedBounds,
    simplifyPart,
    smoothPart,
    undoEdit,
    ws,
  } from '../workspace/store.svelte'

  type Axis = 'x' | 'y' | 'z'
  let cutOpen = $state(false)
  let axis = $state<Axis>('z')
  let at = $state(0)
  let keep = $state<'both' | 'low' | 'high'>('both')
  let tol = $state(0.05)
  let passes = $state(10)
  let detail = $state(0.5)
  let wall = $state(2)
  let shape = $state<ShapeKind>('box')
  let shapeSize = $state(20)
  let textOpen = $state(false)
  let text = $state('Birdy')
  let font = $state('Arial')
  let bold = $state(true)
  let textSize = $state(8)
  let textDepth = $state(1)
  let textPlace = $state<'top' | 'front'>('top')
  let textMode = $state<'emboss' | 'engrave' | 'separate'>('emboss')
  let historyOpen = $state(false)
  const FONTS = ['Arial', 'Arial Black', 'Segoe UI', 'Impact', 'Verdana', 'Georgia', 'Times New Roman', 'Consolas', 'Comic Sans MS', 'Trebuchet MS']
  const when = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  let fitOpen = $state(false)
  let fitMode = $state<'smart' | 'grid'>('smart')
  let joiner = $state<'pegs' | 'dowels' | 'filament' | 'none'>('pegs')
  let peg = $state(5)
  let gap = $state(0.2)
  /** The selected part is bigger than the build volume (even turned). */
  const tooBig = $derived.by(() => {
    void ws.xf
    void ws.selPart
    const b = selectedBounds()
    if (!b) return false
    const e = [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z].sort((a, c) => c - a)
    const bed = [BED.x, BED.y, BED.z].sort((a, c) => c - a)
    return e.some((v, i) => v > bed[i]!)
  })

  const busy = $derived(!!ws.working)
  const range = $derived.by(() => {
    void ws.xf
    void ws.selPart
    const b = selectedBounds()
    return b ? { lo: b.min[axis], hi: b.max[axis] } : { lo: 0, hi: 0 }
  })

  function openCut() {
    cutOpen = !cutOpen
    if (cutOpen) at = Math.round(((range.lo + range.hi) / 2) * 10) / 10
  }
  function setAxis(a: Axis) {
    axis = a
    at = Math.round(((range.lo + range.hi) / 2) * 10) / 10
  }
  $effect(() => {
    getViewer()?.setCutPlane(cutOpen ? axis : null, at)
  })
  onDestroy(() => getViewer()?.setCutPlane(null, 0))

  async function doCut() {
    await cutPart(axis, at, keep)
    cutOpen = false
  }
</script>

<section class="modify">
  <h3 class="hud-label row-head">
    Modify
    {#if ws.working}<span class="dim"><span class="spinner"></span>{ws.working}…</span>{/if}
  </h3>

  {#if ws.parts.length > 1}
    <p class="sub">Combine the models on the plate</p>
    <div class="row3">
      <button class="ghost" disabled={busy} title="Join every model on the plate into one solid" onclick={() => combineParts('union')}><Icon name="merge" size={13} />Merge</button>
      <button class="ghost" disabled={busy} title="Cut the selected model out of the others (it acts as the cutting tool and is removed)" onclick={() => combineParts('difference')}><Icon name="subtract" size={13} />Subtract</button>
      <button class="ghost" disabled={busy} title="Keep only where the selected model overlaps the others" onclick={() => combineParts('intersect')}><Icon name="intersect" size={13} />Overlap</button>
    </div>
  {/if}

  <button class="ghost wide" class:on={fitOpen} class:warn={tooBig && !fitOpen} disabled={busy} title="Cut a model that's too big for the printer into pieces that each fit, with pegs or pin holes so they line up when glued" onclick={() => (fitOpen = !fitOpen)}>
    <Icon name="cut" size={13} />Split to fit printer…{#if tooBig}<span class="tag">too big</span>{/if}
  </button>
  {#if fitOpen}
    <div class="cut">
      <p class="sub">Pieces will fit {BED.x} × {BED.y} × {BED.z} mm. Cuts are flat and square, so they print without support.</p>
      <div class="seg" role="radiogroup" aria-label="How to cut">
        <button role="radio" aria-checked={fitMode === 'smart'} class:on={fitMode === 'smart'} title="Tries many cut positions and keeps the fewest, best-fitting pieces" onclick={() => (fitMode = 'smart')}>Fewest pieces</button>
        <button role="radio" aria-checked={fitMode === 'grid'} class:on={fitMode === 'grid'} title="Even cuts along X, Y and Z, so no thin slivers are left over" onclick={() => (fitMode = 'grid')}>Even grid</button>
      </div>
      <div class="opt">
        <span class="lbl">Joiners</span>
        <select bind:value={joiner} aria-label="Joiners">
          <option value="pegs">Pegs + sockets</option>
          <option value="dowels">Dowel holes + dowels</option>
          <option value="filament">1.75 mm filament pins</option>
          <option value="none">None (glue only)</option>
        </select>
      </div>
      {#if joiner === 'pegs' || joiner === 'dowels'}
        <div class="opt">
          <span class="lbl">Size</span>
          <select bind:value={peg} aria-label="Peg size">
            <option value={3}>3 mm</option>
            <option value={5}>5 mm</option>
            <option value={8}>8 mm</option>
          </select>
        </div>
      {/if}
      {#if joiner !== 'none'}
        <div class="opt">
          <span class="lbl">Fit</span>
          <select bind:value={gap} aria-label="Fit">
            <option value={0.1}>Tight (resin, 0.1 mm)</option>
            <option value={0.2}>Normal (PLA, 0.2 mm)</option>
            <option value={0.3}>Loose (PETG/TPU, 0.3 mm)</option>
          </select>
        </div>
      {/if}
      <button class="primary sm" disabled={busy} onclick={async () => { await splitToFit({ mode: fitMode, joiner, diameter: peg, clearance: gap }); fitOpen = false }}><Icon name="cut" size={13} />Split</button>
    </div>
  {/if}

  <div class="row2">
    <button class="ghost" class:on={cutOpen} disabled={busy} title="Cut the selected model with a flat plane" onclick={openCut}><Icon name="cut" size={13} />Cut…</button>
    <button class="ghost" disabled={busy} title="Rebuild as one clean, closed solid from its volume: closes holes, removes crossing and inner surfaces, joins overlapping shells" onclick={() => rebuildPart(detail)}><Icon name="cube" size={13} />Rebuild as solid</button>
  </div>

  {#if cutOpen}
    <div class="cut">
      <div class="seg" role="radiogroup" aria-label="Cut across">
        {#each ['x', 'y', 'z'] as const as a}
          <button role="radio" aria-checked={axis === a} class:on={axis === a} onclick={() => setAxis(a)}>{a.toUpperCase()}</button>
        {/each}
      </div>
      <label class="slide">
        <input type="range" min={range.lo} max={range.hi} step="0.1" bind:value={at} aria-label="Cut position" />
        <input class="mono num" type="number" step="0.1" bind:value={at} aria-label="Cut position (mm)" /><span class="u">mm</span>
      </label>
      <div class="seg" role="radiogroup" aria-label="Keep">
        <button role="radio" aria-checked={keep === 'both'} class:on={keep === 'both'} onclick={() => (keep = 'both')}>Keep both</button>
        <button role="radio" aria-checked={keep === 'low'} class:on={keep === 'low'} onclick={() => (keep = 'low')}>{axis === 'z' ? 'Bottom' : `Low ${axis.toUpperCase()}`}</button>
        <button role="radio" aria-checked={keep === 'high'} class:on={keep === 'high'} onclick={() => (keep = 'high')}>{axis === 'z' ? 'Top' : `High ${axis.toUpperCase()}`}</button>
      </div>
      <button class="primary sm" disabled={busy} onclick={doCut}><Icon name="cut" size={13} />Cut here</button>
    </div>
  {/if}

  <div class="row2">
    <button class="ghost" class:on={textOpen} disabled={busy} title="Raise text from, or cut it into, the model; or add it as its own part" onclick={() => (textOpen = !textOpen)}><Icon name="pencil" size={13} />Text…</button>
    <div class="shape">
      <select bind:value={shape} aria-label="Shape">
        <option value="box">Box</option>
        <option value="cylinder">Cylinder</option>
        <option value="sphere">Sphere</option>
        <option value="cone">Cone</option>
        <option value="pyramid">Pyramid</option>
        <option value="torus">Ring</option>
        <option value="tube">Tube</option>
      </select>
      <input class="mono num" type="number" min="1" max="1000" step="1" bind:value={shapeSize} aria-label="Shape size (mm)" title="Size (mm)" />
      <button class="icon-btn" disabled={busy} title="Add this shape to the plate" aria-label="Add shape" onclick={() => addShape(shape, shapeSize)}><Icon name="plus" size={13} /></button>
    </div>
  </div>

  {#if textOpen}
    <div class="cut">
      <textarea rows="2" bind:value={text} aria-label="Text" placeholder="Text to write"></textarea>
      <div class="opt">
        <select bind:value={font} aria-label="Font" style="font-family: {font}">
          {#each FONTS as f}<option value={f} style="font-family: {f}">{f}</option>{/each}
        </select>
        <label class="chk"><input type="checkbox" bind:checked={bold} />Bold</label>
      </div>
      <div class="opt">
        <label class="lbl">Letter height <input class="mono num" type="number" min="2" max="200" step="0.5" bind:value={textSize} />mm</label>
        <label class="lbl">Depth <input class="mono num" type="number" min="0.2" max="50" step="0.2" bind:value={textDepth} />mm</label>
      </div>
      <div class="seg" role="radiogroup" aria-label="Text mode">
        <button role="radio" aria-checked={textMode === 'emboss'} class:on={textMode === 'emboss'} onclick={() => (textMode = 'emboss')}>Raised</button>
        <button role="radio" aria-checked={textMode === 'engrave'} class:on={textMode === 'engrave'} onclick={() => (textMode = 'engrave')}>Engraved</button>
        <button role="radio" aria-checked={textMode === 'separate'} class:on={textMode === 'separate'} onclick={() => (textMode = 'separate')}>Own part</button>
      </div>
      {#if textMode !== 'separate'}
        <div class="seg" role="radiogroup" aria-label="Where">
          <button role="radio" aria-checked={textPlace === 'top'} class:on={textPlace === 'top'} onclick={() => (textPlace = 'top')}>On top</button>
          <button role="radio" aria-checked={textPlace === 'front'} class:on={textPlace === 'front'} onclick={() => (textPlace = 'front')}>On front</button>
        </div>
      {/if}
      <button class="primary sm" disabled={busy || !text.trim()} onclick={() => writeTextOnPart({ text, font, bold, size: textSize, depth: textDepth, place: textPlace, mode: textMode })}><Icon name="pencil" size={13} />Write it</button>
    </div>
  {/if}

  <div class="opts">
    <div class="opt">
      <button class="ghost" disabled={busy} title="Remove triangles while keeping the shape within the tolerance" onclick={() => simplifyPart(tol)}><Icon name="simplify" size={13} />Simplify</button>
      <select bind:value={tol} aria-label="Simplify tolerance">
        <option value={0.01}>0.01 mm</option>
        <option value={0.05}>0.05 mm</option>
        <option value={0.1}>0.1 mm</option>
        <option value={0.25}>0.25 mm</option>
      </select>
    </div>
    <div class="opt">
      <button class="ghost" disabled={busy} title="Even out bumps and scan noise without shrinking the model" onclick={() => smoothPart(passes)}><Icon name="smooth" size={13} />Smooth</button>
      <select bind:value={passes} aria-label="Smoothing strength">
        <option value={3}>Light</option>
        <option value={10}>Medium</option>
        <option value={30}>Strong</option>
      </select>
    </div>
    <div class="opt">
      <button class="ghost" disabled={busy} title="Leave walls this thick and an empty inside" onclick={() => hollowPart(wall)}><Icon name="hollow" size={13} />Hollow</button>
      <select bind:value={wall} aria-label="Wall thickness">
        <option value={1.2}>1.2 mm walls</option>
        <option value={2}>2 mm walls</option>
        <option value={3}>3 mm walls</option>
      </select>
    </div>
    <div class="opt">
      <span class="lbl">Rebuild detail</span>
      <select bind:value={detail} aria-label="Rebuild detail">
        <option value={0.25}>0.25 mm (slow)</option>
        <option value={0.5}>0.5 mm</option>
        <option value={1}>1 mm (fast)</option>
      </select>
    </div>
  </div>

  {#if ws.undoLabel}
    <button class="ghost undo" disabled={busy} onclick={undoEdit}><Icon name="reset" size={13} />Undo {ws.undoLabel.toLowerCase()}</button>
  {/if}

  {#if ws.history.length}
    <button class="hist-head" aria-expanded={historyOpen} onclick={() => (historyOpen = !historyOpen)}>
      <span class="hud-label">History</span><span class="dim2">{ws.history.length} change{ws.history.length === 1 ? '' : 's'} · {historyOpen ? 'hide' : 'show'}</span>
    </button>
    {#if historyOpen}
      <ol class="hist" aria-label="Edit and repair history">
        {#each [...ws.history].reverse() as h}
          <li><span class="mono t">{when(h.at)}</span><b>{h.label}</b><span class="n">{h.note}</span></li>
        {/each}
      </ol>
    {/if}
  {/if}
</section>

<style>
  .modify {
    padding: 12px 0 4px;
  }
  h3 {
    margin: 0 0 8px;
  }
  .row-head {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .dim {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--accent);
    font-weight: 400;
    letter-spacing: 0.04em;
    text-transform: none;
  }
  .sub {
    margin: 0 0 6px;
    font-size: 11px;
    color: var(--faint);
  }
  .row3,
  .row2 {
    display: grid;
    gap: 6px;
    margin-bottom: 6px;
  }
  .row3 {
    grid-template-columns: repeat(3, 1fr);
  }
  .row2 {
    grid-template-columns: 1fr 1fr;
  }
  .ghost {
    justify-content: center;
    font-size: 12px;
    height: 28px;
  }
  .wide {
    width: 100%;
    margin-bottom: 6px;
  }
  .ghost.warn {
    border-color: rgba(255, 176, 32, 0.6);
  }
  .tag {
    margin-left: 6px;
    padding: 0 6px;
    border-radius: 8px;
    font-size: 10px;
    background: rgba(255, 176, 32, 0.15);
    color: #ffb020;
  }
  .ghost.on {
    color: var(--accent);
    border-color: var(--neon-line);
  }
  .cut {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    margin-bottom: 6px;
    border: 1px solid var(--neon-line);
    border-radius: 8px;
    background: rgba(var(--accent-rgb), 0.04);
  }
  .seg {
    display: flex;
    gap: 4px;
  }
  .seg button {
    flex: 1;
    height: 24px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--muted);
    font: inherit;
    font-size: 11px;
    cursor: pointer;
  }
  .seg button.on {
    color: var(--accent);
    border-color: var(--neon-line);
  }
  .slide {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .slide input[type='range'] {
    flex: 1;
    accent-color: var(--accent);
  }
  .num {
    width: 64px;
    height: 24px;
    padding: 0 6px;
    border-radius: 6px;
    border: 1px solid var(--border-strong);
    background: var(--bg);
    color: var(--text);
    font-size: 11px;
  }
  .u {
    font-size: 11px;
    color: var(--faint);
  }
  .primary.sm {
    height: 28px;
    font-size: 12px;
    justify-content: center;
  }
  .shape {
    display: flex;
    gap: 4px;
    align-items: center;
  }
  .shape select {
    flex: 1;
    min-width: 0;
  }
  .shape .num {
    width: 46px;
    height: 28px;
  }
  .shape .icon-btn {
    width: 28px;
    height: 28px;
    flex: none;
  }
  textarea {
    resize: vertical;
    min-height: 40px;
    border-radius: 6px;
    border: 1px solid var(--border-strong);
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-size: 12px;
    padding: 6px;
  }
  .chk {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--muted);
  }
  .lbl .num {
    width: 48px;
    margin: 0 3px;
  }
  .hist-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    margin-top: 12px;
    padding: 0;
    border: 0;
    background: none;
    cursor: pointer;
  }
  .dim2 {
    font-size: 11px;
    color: var(--faint);
  }
  .hist {
    list-style: none;
    margin: 6px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 180px;
    overflow: auto;
  }
  .hist li {
    display: grid;
    grid-template-columns: auto 1fr;
    column-gap: 6px;
    font-size: 11px;
    color: var(--muted);
  }
  .hist .t {
    color: var(--faint);
    grid-row: span 2;
  }
  .hist b {
    color: var(--text);
    font-weight: 600;
  }
  .hist .n {
    grid-column: 2;
  }
  .opts {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .opt {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    align-items: center;
  }
  .lbl {
    font-size: 11px;
    color: var(--faint);
    padding-left: 4px;
  }
  select {
    height: 28px;
    border-radius: 6px;
    border: 1px solid var(--border-strong);
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-size: 11px;
    padding: 0 6px;
  }
  .undo {
    width: 100%;
    margin-top: 8px;
  }
  .spinner {
    width: 10px;
    height: 10px;
    border: 2px solid rgba(var(--accent-rgb), 0.3);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
