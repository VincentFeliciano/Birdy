<script lang="ts">
  import { prices, setPrice, type Prices } from '../app/costs.svelte'

  let { kind }: { kind: 'fdm' | 'resin' } = $props()

  function set(key: keyof Prices, e: Event, max: number) {
    const el = e.currentTarget as HTMLInputElement
    const v = Number(el.value)
    if (Number.isFinite(v) && v >= 0 && v <= max) setPrice(key, v as never)
    else el.value = String(prices[key])
  }
</script>

<details class="prices">
  <summary>Prices for the cost estimate</summary>
  <div class="grid">
    {#if kind === 'fdm'}
      <label><span>Filament per kg</span><input type="number" min="0" max="1000" step="0.5" value={prices.filamentKg} onchange={(e) => set('filamentKg', e, 1000)} /></label>
      <label><span>Printer power <i>W</i></span><input type="number" min="0" max="3000" step="10" value={prices.fdmWatts} onchange={(e) => set('fdmWatts', e, 3000)} /></label>
    {:else}
      <label><span>Resin per litre</span><input type="number" min="0" max="1000" step="0.5" value={prices.resinL} onchange={(e) => set('resinL', e, 1000)} /></label>
      <label><span>Printer power <i>W</i></span><input type="number" min="0" max="3000" step="10" value={prices.resinWatts} onchange={(e) => set('resinWatts', e, 3000)} /></label>
    {/if}
    <label><span>Electricity per kWh <i>0 = leave out</i></span><input type="number" min="0" max="5" step="0.01" value={prices.kwh} onchange={(e) => set('kwh', e, 5)} /></label>
    <label>
      <span>Currency</span>
      <input
        type="text"
        maxlength="4"
        value={prices.currency}
        onchange={(e) => setPrice('currency', e.currentTarget.value.trim().slice(0, 4) || '$')} />
    </label>
  </div>
</details>

<style>
  .prices {
    margin-top: 8px;
    font-size: 12px;
    color: var(--muted);
  }
  summary {
    cursor: pointer;
    color: var(--faint);
    font-size: 11px;
  }
  summary:hover {
    color: var(--accent);
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px 8px;
    margin-top: 8px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  label span {
    font-size: 11px;
    color: var(--muted);
  }
  i {
    font-style: normal;
    color: var(--faint);
  }
  input {
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
  input:focus {
    border-color: var(--neon-line);
    box-shadow: var(--glow-sm);
  }
</style>
