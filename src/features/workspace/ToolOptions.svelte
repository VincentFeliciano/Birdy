<script lang="ts">
  import Icon from '../../components/Icon.svelte'
  import { fmtNum } from '../../app/format'
  import {
    arrangePlate,
    autoOrient,
    centerOnBed,
    convertUnits,
    dropToBed,
    fitToBed,
    moveBy,
    rotateBy,
    scaleBy,
    scaleTo,
    setDimension,
    setUniform,
    setXForm,
    settleModel,
    ws,
  } from './store.svelte'

  // Options for the active tool, shown beside the tool rail.
  const xf = $derived(ws.xf)
  const size = $derived(ws.stats?.size)
  const pct = $derived(xf ? Math.abs(xf.sx) : 100)
  const evenScale = $derived(!xf || (Math.abs(Math.abs(xf.sx) - Math.abs(xf.sy)) < 0.05 && Math.abs(Math.abs(xf.sx) - Math.abs(xf.sz)) < 0.05))
  let byPct = $state(110)
  let turnAxis = $state<'x' | 'y' | 'z'>('z')
  let turnDeg = $state(45)
  let nudge = $state(10)

  const val = (e: Event) => Number((e.currentTarget as HTMLInputElement).value)
  const AXES = ['x', 'y', 'z'] as const
</script>

{#if xf && size && ws.tool !== 'select'}
  <div class="opts" role="group" aria-label="{ws.tool} options">
    {#if ws.tool === 'scale'}
      <div class="head">
        <span class="t">Scale</span>
        <button class="lock" class:on={ws.uniform} title={ws.uniform ? 'Even scaling: all sides change together (click to scale one axis)' : 'Free scaling: each axis on its own (click for even)'} aria-pressed={ws.uniform} onclick={() => setUniform(!ws.uniform)}>
          <Icon name={ws.uniform ? 'lock' : 'unlock'} size={12} />{ws.uniform ? 'Even' : 'Free'}
        </button>
      </div>
      <div class="rows">
        {#each AXES as a}
          <label class="row">
            <i class="ax-{a}">{a.toUpperCase()}</i>
            <input type="number" min="0.01" step="1" value={fmtNum(size[a])} onchange={(e) => setDimension(a, val(e), ws.uniform)} aria-label="{a} size in mm" />
            <span class="u">mm</span>
          </label>
        {/each}
        <label class="row">
          <i>%</i>
          <input type="number" min="1" step="5" value={evenScale ? Math.round(pct * 10) / 10 : ''} placeholder="mixed" onchange={(e) => scaleTo(val(e))} aria-label="Size as a percentage of the original" />
          <span class="u">of original</span>
        </label>
      </div>
      <div class="chips">
        {#each [50, 75, 90, 110, 150, 200] as p}
          <button class="chip" title="Make it {p}% of its current size" onclick={() => scaleBy(p)}>{p}%</button>
        {/each}
      </div>
      <div class="row by">
        <span>By</span>
        <input type="number" min="1" step="1" bind:value={byPct} aria-label="Scale by percent" />
        <span class="u">%</span>
        <button class="chip" onclick={() => scaleBy(byPct)}>Apply</button>
      </div>
      <div class="chips">
        <button class="chip" title="Back to the size it was loaded at" onclick={() => scaleTo(100)}>100%</button>
        <button class="chip" title="Largest size that fits the plate" onclick={fitToBed}>Fit plate</button>
        <button class="chip" title="Model was made in inches" onclick={() => convertUnits(25.4)}>in → mm</button>
        <button class="chip" title="Model was made in centimetres" onclick={() => convertUnits(10)}>cm → mm</button>
      </div>
    {:else if ws.tool === 'rotate'}
      <div class="head"><span class="t">Rotate</span></div>
      {#each AXES as a}
        <div class="row turn">
          <i class="ax-{a}">{a.toUpperCase()}</i>
          <button class="chip" title="Turn −90° about {a.toUpperCase()}" onclick={() => rotateBy(a, -90)}>−90°</button>
          <button class="chip" title="Turn −45° about {a.toUpperCase()}" onclick={() => rotateBy(a, -45)}>−45°</button>
          <button class="chip" title="Turn +45° about {a.toUpperCase()}" onclick={() => rotateBy(a, 45)}>+45°</button>
          <button class="chip" title="Turn +90° about {a.toUpperCase()}" onclick={() => rotateBy(a, 90)}>+90°</button>
        </div>
      {/each}
      <div class="row by">
        <select bind:value={turnAxis} aria-label="Axis">
          {#each AXES as a}<option value={a}>{a.toUpperCase()}</option>{/each}
        </select>
        <input type="number" step="1" bind:value={turnDeg} aria-label="Degrees" />
        <span class="u">°</span>
        <button class="chip" onclick={() => rotateBy(turnAxis, turnDeg)}>Turn</button>
      </div>
      <div class="chips">
        <button class="chip" title="Turn it so it needs the fewest supports" onclick={autoOrient}>Best way up</button>
        <button class="chip" title="Let it tip over and rest as if dropped on the plate" onclick={settleModel}>Settle</button>
        <button class="chip" title="Back to how it was loaded" onclick={() => (setXForm('rx', 0), setXForm('ry', 0), setXForm('rz', 0))}>0°</button>
      </div>
    {:else if ws.tool === 'move'}
      <div class="head"><span class="t">Move</span></div>
      <div class="rows">
        {#each AXES as a}
          <label class="row">
            <i class="ax-{a}">{a.toUpperCase()}</i>
            <input type="number" step="1" value={fmtNum(a === 'x' ? xf.px : a === 'y' ? xf.py : xf.pz)} onchange={(e) => setXForm(`p${a}`, val(e))} aria-label="{a} position in mm" />
            <span class="u">mm</span>
          </label>
        {/each}
      </div>
      <div class="row by">
        <span>Nudge</span>
        <input type="number" min="0.1" step="1" bind:value={nudge} aria-label="Nudge distance" />
        <span class="u">mm</span>
      </div>
      <div class="pad">
        <span></span><button class="chip" title="Back (+Y)" onclick={() => moveBy(0, nudge, 0)}>▲</button><span></span>
        <button class="chip" title="Left (−X)" onclick={() => moveBy(-nudge, 0, 0)}>◀</button>
        <button class="chip" title="Centre on the plate" onclick={centerOnBed}>●</button>
        <button class="chip" title="Right (+X)" onclick={() => moveBy(nudge, 0, 0)}>▶</button>
        <span></span><button class="chip" title="Front (−Y)" onclick={() => moveBy(0, -nudge, 0)}>▼</button><span></span>
      </div>
      <div class="chips">
        <button class="chip" title="Rest it on the plate" onclick={dropToBed}>Drop to plate</button>
        <button class="chip" title="Centre it on the plate" onclick={centerOnBed}>Centre</button>
        {#if ws.parts.length > 1}<button class="chip" title="Lay every model out on the plate" onclick={arrangePlate}>Arrange all</button>{/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .opts {
    position: absolute;
    /* Clear of the tool rail and of the layer bar (right 56–90px) when toolpaths are shown. */
    right: 100px;
    top: 50%;
    transform: translateY(-50%);
    width: 206px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    border-radius: var(--r-lg);
    background: rgba(18, 20, 25, 0.88);
    backdrop-filter: blur(8px);
    border: 1px solid var(--neon-soft);
    box-shadow: 0 0 14px rgba(var(--accent-rgb), 0.08);
    font-size: 11px;
    color: var(--muted);
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .t {
    font-size: 10px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--accent);
  }
  .lock {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 22px;
    padding: 0 8px;
    border-radius: 11px;
    border: 1px solid var(--border);
    background: none;
    color: var(--muted);
    font: inherit;
    font-size: 11px;
    cursor: pointer;
  }
  .lock.on {
    color: var(--accent);
    border-color: var(--neon-line);
  }
  .rows {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .row i {
    width: 12px;
    font-style: normal;
    font-weight: 600;
    text-align: center;
  }
  .ax-x {
    color: #ff5a6a;
  }
  .ax-y {
    color: #4fdc7a;
  }
  .ax-z {
    color: #4f9dff;
  }
  input,
  select {
    flex: 1;
    min-width: 0;
    height: 24px;
    border-radius: 5px;
    border: 1px solid var(--border-strong);
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-size: 11px;
    padding: 0 6px;
  }
  select {
    flex: 0 0 44px;
  }
  .u {
    color: var(--faint);
    white-space: nowrap;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .chip {
    height: 22px;
    padding: 0 7px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--muted);
    font: inherit;
    font-size: 11px;
    cursor: pointer;
  }
  .chip:hover {
    color: var(--accent);
    border-color: var(--neon-line);
  }
  .turn .chip {
    flex: 1;
    padding: 0;
  }
  .by input {
    flex: 0 0 54px;
  }
  .pad {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 3px;
    width: 96px;
    align-self: center;
  }
  .pad .chip {
    padding: 0;
  }
</style>
