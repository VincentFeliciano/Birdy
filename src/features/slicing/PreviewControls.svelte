<script lang="ts">
  import Icon from '../../components/Icon.svelte'
  import { setPreviewLayer, setPreviewOn, setPreviewTravel, sl } from './store.svelte'

  const p = $derived(sl.preview)
  const z = $derived(p.layerZ[p.layer - 1])

  function onKey(e: KeyboardEvent) {
    const step = e.shiftKey ? 10 : 1
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') setPreviewLayer(p.layer + step)
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') setPreviewLayer(p.layer - step)
    else if (e.key === 'Home') setPreviewLayer(1)
    else if (e.key === 'End') setPreviewLayer(p.layers)
    else return
    e.preventDefault()
  }
</script>

{#if p.ready && p.on}
  <div class="layers mono">
    <span class="top">{p.layers}</span>
    <input
      type="range"
      min="1"
      max={p.layers}
      step="1"
      value={p.layer}
      aria-label="Layer"
      oninput={(e) => setPreviewLayer(Number(e.currentTarget.value))}
      onkeydown={onKey} />
    <span class="bottom">1</span>
  </div>
  <div class="readout mono">
    <span class="hud-tag">LAYER</span>
    <span class="val">{p.layer}<i>/{p.layers}</i></span>
    {#if z !== undefined}<span class="val">Z {z.toFixed(2)}<i>MM</i></span>{/if}
  </div>
  <div class="legend">
    {#each p.features as f}
      <span class="item"><i style:background={f.color} style:box-shadow={`0 0 6px ${f.color}`}></i>{f.name}</span>
    {/each}
    <label class="travel">
      <input type="checkbox" checked={p.travel} onchange={(e) => setPreviewTravel(e.currentTarget.checked)} />
      Travel moves
    </label>
    <button class="ghost" onclick={() => setPreviewOn(false)}><Icon name="cube" size={13} />Show model</button>
  </div>
{:else if p.ready}
  <div class="legend compact">
    <button class="ghost" onclick={() => setPreviewOn(true)}><Icon name="layers" size={13} />Show toolpaths</button>
  </div>
{/if}

<style>
  .layers {
    position: absolute;
    right: 56px;
    top: 64px;
    bottom: 84px;
    width: 34px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    font-size: 10px;
    color: var(--muted);
    z-index: 3;
  }
  .layers input {
    flex: 1;
    writing-mode: vertical-lr;
    direction: rtl;
    width: 22px;
    accent-color: var(--accent);
    cursor: ns-resize;
    filter: drop-shadow(0 0 4px rgba(var(--accent-rgb), 0.5));
  }
  .readout {
    position: absolute;
    right: 100px;
    top: 64px;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
    padding: 8px 10px;
    border-radius: var(--r-md);
    background: rgba(11, 12, 15, 0.72);
    border: 1px solid var(--neon-soft);
    font-size: 12px;
    z-index: 3;
  }
  .val {
    color: var(--accent);
    text-shadow: var(--glow-text);
    font-size: 14px;
  }
  .val i {
    font-style: normal;
    color: var(--faint);
    font-size: 10px;
    margin-left: 3px;
    text-shadow: none;
  }
  .legend {
    position: absolute;
    left: 56px;
    bottom: 52px;
    max-width: calc(100% - 200px);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 12px;
    padding: 8px 10px;
    border-radius: var(--r-md);
    background: rgba(11, 12, 15, 0.72);
    border: 1px solid var(--border-strong);
    font-size: 11px;
    color: var(--muted);
    z-index: 3;
  }
  .legend.compact {
    padding: 4px;
  }
  .item {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .item i {
    width: 10px;
    height: 3px;
    border-radius: 2px;
  }
  .travel {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .travel input {
    accent-color: var(--accent);
  }
  .legend .ghost {
    height: 24px;
    font-size: 11px;
    padding: 0 8px;
  }
</style>
