<script lang="ts">
  import Icon from '../../components/Icon.svelte'
  import { fmtInt } from '../../app/format'
  import { alignParts, setPartColor, addToPlateFromDialog, arrangePlate, duplicatePart, removePart, selectPart, setIsolate, splitIntoParts, ws } from '../workspace/store.svelte'

  let note = $state<string | null>(null)
  const SWATCHES = ['#e8e8e8', '#2b2b2b', '#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa', '#f06292', '#8d6e63']
  const selColor = $derived(ws.parts[ws.selPart]?.color ?? null)
  function arrange() {
    note = arrangePlate() ? null : "They don't all fit on the plate. Remove one or scale them down."
  }
</script>

<section class="plate">
  <h3 class="hud-label row-head">
    Plate
    <span class="dim">{ws.parts.length} model{ws.parts.length === 1 ? '' : 's'}</span>
  </h3>
  {#if ws.parts.length > 1}
    <ul class="parts" aria-label="Models on the plate">
      {#each ws.parts as p, i}
        <li>
          <button class:on={ws.selPart === i} onclick={() => selectPart(i)} title="Edit this model (or click it in the 3D view)">
            {#if p.color}<span class="sw" style="background: {p.color}"></span>{:else}<Icon name="cube" size={12} />{/if}
            <span class="name">{p.name}</span>
            <span class="mono tri">{fmtInt(p.triangles)}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
  <div class="acts">
    <button class="ghost" title="Put another model file on this plate" onclick={addToPlateFromDialog}><Icon name="plus" size={13} />Add model</button>
    <button class="ghost" title="Copy the selected model" onclick={() => duplicatePart()}><Icon name="folderplus" size={13} />Duplicate</button>
    {#if ws.parts.length > 1}
      <button class="ghost" title="Lay all models out on the plate with a gap between them" onclick={arrange}><Icon name="grid" size={13} />Arrange</button>
      <button class="ghost danger" title="Take the selected model off the plate" onclick={removePart}><Icon name="trash" size={13} />Remove</button>
    {/if}
    {#if (ws.report?.stats.components ?? 0) > ws.parts.length}
      <button class="ghost" title="Make each separate shell of the selected model its own part, where it is" onclick={splitIntoParts}><Icon name="shells" size={13} />Split shells</button>
    {/if}
    {#if ws.parts.length > 1}
      <button class="ghost" class:on={ws.isolate} aria-pressed={ws.isolate} title="Show only the selected model in the 3D view" onclick={() => setIsolate(!ws.isolate)}><Icon name="eye" size={13} />{ws.isolate ? 'Show all' : 'Isolate'}</button>
    {/if}
  </div>
  {#if note}<p class="err">{note}</p>{/if}
  <div class="colors" role="group" aria-label="Colour of the selected model">
    <span class="lbl">Colour</span>
    {#each SWATCHES as c}
      <button class="swatch" class:on={selColor === c} style="--c: {c}" title="Colour the selected model {c}" aria-label="Colour {c}" aria-pressed={selColor === c} onclick={() => setPartColor(c)}></button>
    {/each}
    <label class="swatch custom" title="Pick any colour"><input type="color" value={selColor ?? '#e8e8e8'} onchange={(e) => setPartColor(e.currentTarget.value)} aria-label="Pick a colour" /></label>
    {#if selColor}<button class="icon-btn clear" title="Back to the default colour" aria-label="Clear colour" onclick={() => setPartColor(null)}><Icon name="close" size={11} /></button>{/if}
  </div>
  {#if ws.parts.length > 1}
    <div class="align" role="group" aria-label="Line up the other models with the selected one">
      <span class="lbl">Line up</span>
      {#each [['x', 'min', 'Left'], ['x', 'mid', 'Centre X'], ['x', 'max', 'Right'], ['y', 'min', 'Front'], ['y', 'mid', 'Centre Y'], ['y', 'max', 'Back'], ['z', 'min', 'Bottoms']] as const as [ax, to, label]}
        <button class="chip" title="Line up the other models' {label.toLowerCase()} with the selected one" onclick={() => alignParts(ax, to)}>{label}</button>
      {/each}
    </div>
  {/if}
</section>

<style>
  .colors,
  .align {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    margin-top: 8px;
  }
  .lbl {
    font-size: 11px;
    color: var(--faint);
    margin-right: 4px;
  }
  .swatch {
    width: 18px;
    height: 18px;
    padding: 0;
    border-radius: 50%;
    border: 1px solid var(--border-strong);
    background: var(--c);
    cursor: pointer;
  }
  .swatch.on {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .swatch.custom {
    position: relative;
    overflow: hidden;
    background: conic-gradient(red, yellow, lime, cyan, blue, magenta, red);
  }
  .swatch.custom input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
  }
  .clear {
    width: 20px;
    height: 20px;
  }
  .sw {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex: none;
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
  .plate {
    padding: 12px 0;
    border-bottom: 1px solid var(--border);
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
    color: var(--faint);
    font-weight: 400;
    letter-spacing: 0.05em;
    text-transform: none;
  }
  .parts {
    list-style: none;
    margin: 0 0 8px;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 160px;
    overflow-y: auto;
  }
  .parts button {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 5px 8px;
    border: 1px solid transparent;
    border-radius: 6px;
    background: none;
    color: var(--muted);
    font: inherit;
    font-size: 12px;
    text-align: left;
    cursor: pointer;
  }
  .parts button:hover {
    color: var(--text);
    background: var(--bg);
  }
  .parts button.on {
    color: var(--text);
    border-color: var(--neon-line);
    background: rgba(var(--accent-rgb), 0.08);
  }
  .parts button.on :global(svg) {
    color: var(--accent);
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tri {
    font-size: 10px;
    color: var(--faint);
  }
  .acts {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }
  .acts .ghost {
    justify-content: center;
    font-size: 12px;
    height: 28px;
  }
  .ghost.on {
    color: var(--accent);
    border-color: var(--neon-line);
  }
  .ghost.danger:hover {
    color: var(--danger);
  }
  .err {
    margin: 8px 0 0;
    font-size: 12px;
    color: var(--danger);
  }
</style>
