<script lang="ts">
  import Icon from '../../components/Icon.svelte'
  import { fmtInt } from '../../app/format'
  import { addToPlateFromDialog, arrangePlate, duplicatePart, removePart, selectPart, setIsolate, splitIntoParts, ws } from '../workspace/store.svelte'

  let note = $state<string | null>(null)
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
            <Icon name="cube" size={12} />
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
</section>

<style>
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
