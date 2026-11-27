<script lang="ts">
  import Icon from '../../components/Icon.svelte'
  import { fmtBytes } from '../../app/format'
  import { crumbs, importDownloads, models, openFolder, openModel, refresh, setModelsOpen, up } from './store.svelte'

  const api = window.api
  const path = $derived(crumbs())
</script>

<div class="mp neon-panel" role="region" aria-label="Models folder">
  <div class="head">
    <Icon name="cube" size={15} />
    <nav class="crumbs" aria-label="Folder">
      <button class="crumb" class:here={!models.cwd} onclick={() => openFolder('')}>Models</button>
      {#each path as c}
        <span class="sep">›</span>
        <button class="crumb" class:here={c.rel === models.cwd} onclick={() => openFolder(c.rel)}>{c.name}</button>
      {/each}
    </nav>
    {#if models.notice}
      <span class="notice" title={models.notice}>{models.notice}</span>
    {/if}
    <div class="spacer"></div>
    {#if models.cwd}
      <button class="icon-btn" title="Up one folder" aria-label="Up one folder" onclick={up}><Icon name="back" size={15} /></button>
    {/if}
    <button class="ghost sm" title="Copy models and unpack ZIPs that are already in your Downloads folder" onclick={importDownloads}><Icon name="import" size={13} />Add from Downloads</button>
    <button class="icon-btn" title="Refresh" aria-label="Refresh" onclick={refresh}><Icon name="reload" size={15} /></button>
    <button class="icon-btn" title="Open this folder in File Explorer" aria-label="Open in File Explorer" onclick={() => api.models.reveal(models.cwd)}><Icon name="external" size={15} /></button>
    <button class="icon-btn" title="Hide" aria-label="Hide models" onclick={() => setModelsOpen(false)}><Icon name="close" size={15} /></button>
  </div>

  <div class="grid">
    {#if models.error}
      <p class="empty">{models.error}</p>
    {:else if !models.entries.length && !models.loading}
      <div class="empty">
        <p>
          {models.cwd ? 'No models in this folder.' : 'No models yet. STL, 3MF, OBJ, GLB and PLY files you download land here, and ZIP downloads are unpacked into folders of their own. You can also put your own files in this folder.'}
        </p>
        <button class="ghost" onclick={() => api.models.reveal(models.cwd)}><Icon name="folder" size={14} />Open in File Explorer</button>
      </div>
    {/if}
    {#each models.entries as e (e.rel)}
      <div class="tile" class:hl={models.highlight === e.rel} class:busy={models.opening === e.rel}>
        <button
          class="main"
          title={e.kind === 'dir' ? `Open folder ${e.name}` : `Open ${e.name} in the workspace`}
          onclick={() => (e.kind === 'dir' ? openFolder(e.rel) : openModel(e.rel))}>
          <span class="thumb" class:dir={e.kind === 'dir'}>
            {#if e.kind === 'dir'}
              <Icon name="folder" size={34} />
              <span class="count mono">{e.models ?? 0}</span>
            {:else if models.thumbs[e.rel]}
              <img src={models.thumbs[e.rel]} alt="" draggable="false" />
            {:else}
              <Icon name="cube" size={28} />
            {/if}
            {#if models.opening === e.rel}<span class="spin"><span class="spinner"></span></span>{/if}
          </span>
          <span class="name">{e.name}</span>
          <span class="meta mono">{e.kind === 'dir' ? `${e.models ?? 0} model${e.models === 1 ? '' : 's'}` : fmtBytes(e.size)}</span>
        </button>
        <button class="reveal icon-btn" title="Show in File Explorer" aria-label="Show {e.name} in File Explorer" onclick={() => api.models.reveal(e.rel)}>
          <Icon name="external" size={12} />
        </button>
      </div>
    {/each}
  </div>
</div>

<style>
  .mp {
    flex: none;
    display: flex;
    flex-direction: column;
    height: 232px;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 6px 4px 12px;
    color: var(--accent);
  }
  .crumbs {
    display: flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
    overflow: hidden;
  }
  .crumb {
    padding: 2px 6px;
    border: 0;
    border-radius: var(--r-sm, 4px);
    background: none;
    color: var(--muted);
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
  }
  .crumb:hover {
    color: var(--accent);
  }
  .crumb.here {
    color: var(--text);
  }
  .sep {
    color: var(--faint);
  }
  .notice {
    margin-left: 10px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    color: var(--ok);
  }
  .spacer {
    flex: 1;
  }
  .ghost.sm {
    height: 26px;
    padding: 0 8px;
    font-size: 12px;
    margin-right: 4px;
  }
  .grid {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-wrap: wrap;
    align-content: flex-start;
    gap: 8px;
    padding: 4px 10px 10px;
  }
  .empty {
    display: flex;
    align-items: center;
    gap: 14px;
    margin: 8px 4px;
    color: var(--muted);
    font-size: 13px;
  }
  .empty p {
    margin: 0;
    max-width: 640px;
  }
  .tile {
    position: relative;
    width: 124px;
  }
  .main {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 3px;
    width: 100%;
    padding: 6px;
    border-radius: var(--r-md);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    text-align: left;
    font: inherit;
    cursor: pointer;
    transition: border-color 0.12s, box-shadow 0.12s;
  }
  .main:hover {
    border-color: var(--neon-line);
    box-shadow: var(--glow-sm);
  }
  .tile.hl .main {
    border-color: var(--accent);
    box-shadow: var(--glow-sm), inset 0 0 12px rgba(var(--accent-rgb), 0.12);
  }
  .thumb {
    position: relative;
    display: grid;
    place-items: center;
    height: 86px;
    border-radius: 6px;
    background: radial-gradient(circle at 50% 40%, #1b1e24, var(--bg) 75%);
    color: var(--faint);
    overflow: hidden;
  }
  .thumb.dir {
    color: var(--accent);
    filter: drop-shadow(0 0 4px rgba(var(--accent-rgb), 0.45));
  }
  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  .count {
    position: absolute;
    right: 6px;
    bottom: 4px;
    font-size: 11px;
    color: var(--muted);
    filter: none;
  }
  .spin {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: rgba(0, 0, 0, 0.45);
  }
  .name {
    font-size: 12px;
    font-weight: 600;
    line-height: 1.3;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    word-break: break-word;
  }
  .meta {
    font-size: 10px;
    color: var(--muted);
  }
  .reveal {
    position: absolute;
    top: 9px;
    right: 9px;
    width: 22px;
    height: 22px;
    opacity: 0;
    background: rgba(11, 12, 15, 0.8);
  }
  .tile:hover .reveal,
  .reveal:focus-visible {
    opacity: 1;
  }
</style>
