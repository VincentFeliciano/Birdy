<script lang="ts">
  import Icon from '../../components/Icon.svelte'
  import { downloads } from '../../stores/browser.svelte'
  import { openFromDownload } from '../workspace/store.svelte'
  import { fmtBytes } from '../../app/format'
  import type { DownloadInfo } from '../../types/ipc'

  const api = window.api

  function status(d: DownloadInfo) {
    if (d.state === 'progressing') {
      const pct = d.total ? ` · ${Math.floor((d.received / d.total) * 100)}%` : ''
      return `${fmtBytes(d.received)}${d.total ? ` / ${fmtBytes(d.total)}` : ''}${pct}${d.paused ? ' · paused' : ''}`
    }
    if (d.state === 'completed') return d.duplicateOf ? `Already downloaded as ${d.duplicateOf}` : fmtBytes(d.received)
    if (d.state === 'cancelled') return 'Cancelled'
    return d.error ?? 'Interrupted'
  }

  const items = $derived([...downloads.items].reverse())
</script>

<div class="dl neon-panel" role="region" aria-label="Downloads">
  <div class="head">
    <span class="hud-label">Downloads</span>
    <div class="spacer"></div>
    <button class="icon-btn" title="Open downloads folder" aria-label="Open downloads folder" onclick={() => api.downloads.openFolder()}><Icon name="folder" size={15} /></button>
    <button class="icon-btn" title="Clear finished" aria-label="Clear finished downloads" onclick={() => api.downloads.clear()}><Icon name="trash" size={15} /></button>
    <button class="icon-btn" title="Hide" aria-label="Hide downloads" onclick={() => (downloads.open = false)}><Icon name="close" size={15} /></button>
  </div>
  <div class="list">
    {#each items as d (d.id)}
      <div class="item" class:failed={d.state === 'interrupted' || d.state === 'cancelled'}>
        <div class="icon" class:model={d.isModel}><Icon name={d.isModel ? 'cube' : 'download'} size={16} /></div>
        <div class="meta">
          <div class="name" title={d.filename}>{d.filename}</div>
          <div class="status mono">{status(d)}</div>
          {#if d.state === 'progressing'}
            <div class="bar"><span style="width: {d.total ? (d.received / d.total) * 100 : 30}%" class:indeterminate={!d.total}></span></div>
          {/if}
        </div>
        <div class="acts">
          {#if d.state === 'completed' && d.isModel}
            <button class="ghost" onclick={() => openFromDownload(d.id)}>Open</button>
          {/if}
          {#if d.state === 'progressing'}
            <button class="icon-btn" title="Cancel" aria-label="Cancel download" onclick={() => api.downloads.cancel(d.id)}><Icon name="close" size={14} /></button>
          {:else if d.state === 'interrupted' || d.state === 'cancelled'}
            <button class="icon-btn" title="Retry" aria-label="Retry download" onclick={() => api.downloads.retry(d.id)}><Icon name="reload" size={14} /></button>
          {:else}
            <button class="icon-btn" title="Show in folder" aria-label="Show in folder" onclick={() => api.downloads.showInFolder(d.id)}><Icon name="folder" size={14} /></button>
          {/if}
        </div>
      </div>
    {/each}
  </div>
</div>

<style>
  .dl {
    flex: none;
    display: flex;
    flex-direction: column;
    max-height: 150px;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 6px 6px 2px 12px;
  }
  .spacer {
    flex: 1;
  }
  .list {
    display: flex;
    gap: 8px;
    padding: 4px 10px 10px;
    overflow-x: auto;
  }
  .item {
    flex: 0 0 280px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px;
    border-radius: var(--r-md);
    background: var(--surface);
    border: 1px solid var(--border);
  }
  .item.failed {
    border-color: rgba(255, 77, 94, 0.45);
  }
  .icon {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: var(--r-md);
    background: var(--bg);
    color: var(--muted);
    flex: none;
  }
  .icon.model {
    color: var(--accent);
    box-shadow: 0 0 0 1px var(--neon-line), var(--glow-sm);
  }
  .meta {
    flex: 1;
    min-width: 0;
  }
  .name {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .status {
    font-size: 11px;
    color: var(--muted);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .failed .status {
    color: #ff8a95;
  }
  .bar {
    height: 3px;
    margin-top: 5px;
    border-radius: 2px;
    background: var(--elevated);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--accent);
    box-shadow: var(--glow-sm);
    transition: width 0.2s;
  }
  .bar .indeterminate {
    animation: slide 1.2s ease-in-out infinite;
  }
  @keyframes slide {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(340%);
    }
  }
  .acts {
    display: flex;
    gap: 2px;
    flex: none;
  }
</style>
