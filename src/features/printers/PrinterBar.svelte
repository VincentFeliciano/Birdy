<script lang="ts">
  import Icon from '../../components/Icon.svelte'
  import { ws } from '../workspace/store.svelte'
  import type { PrinterState } from '../../types/slicing'
  import { bar, fmtTemp, fmtTime, networkPrinters, setBarHidden, togglePrinter } from './status.svelte'

  const list = $derived(networkPrinters())
  const open = $derived(list.find((p) => p.id === bar.open) ?? null)
  const openStatus = $derived(open ? bar.status[open.id] : undefined)

  const label: Record<PrinterState, string> = {
    idle: 'Ready',
    printing: 'Printing',
    paused: 'Paused',
    done: 'Finished',
    error: 'Error',
    offline: 'Offline',
  }

  function openWebPage(url: string | undefined) {
    if (!url) return
    const full = /^https?:\/\//i.test(url) ? url : `http://${url}`
    if (ws.layout === 'workspace' || ws.layout === 'library') ws.layout = 'split'
    window.api.tabs.create(full)
  }
</script>

<div class="pbar neon-panel" role="region" aria-label="Printer status">
  <div class="row">
    <span class="lead"><Icon name="printer" size={15} /></span>
    <div class="chips">
      {#each list as p (p.id)}
        {@const s = bar.status[p.id]}
        <button class="chip" class:on={bar.open === p.id} data-state={s?.state ?? 'loading'} title={s?.detail ?? 'Checking…'} onclick={() => togglePrinter(p.id)}>
          <span class="dot"></span>
          <span class="name">{p.name}</span>
          <span class="st">{s ? label[s.state] : '…'}</span>
          {#if s && (s.state === 'printing' || s.state === 'paused') && s.progress !== null}
            <span class="pct mono">{Math.round(s.progress * 100)}%</span>
            <span class="mini"><span style="width: {s.progress * 100}%"></span></span>
            {#if s.remaining !== null}<span class="left mono">{fmtTime(s.remaining)} left</span>{/if}
          {/if}
          {#if s && s.state !== 'offline' && s.hotend !== null}
            <span class="temp mono" title="Nozzle">{fmtTemp(s.hotend, s.hotendTarget)}</span>
          {/if}
        </button>
      {/each}
    </div>
    <button class="icon-btn" title="Hide the printer bar (show it again from Slice → Printers)" aria-label="Hide the printer bar" onclick={() => setBarHidden(true)}>
      <Icon name="close" size={13} />
    </button>
  </div>
  {#if open}
    {@const s = openStatus}
    <div class="detail">
      {#if s?.camera}
        <div class="cam">
          {#if bar.snapshots[open.id]}
            <img src={bar.snapshots[open.id]} alt="Webcam view of {open.name}" />
          {:else}
            <span>{bar.snapshots[open.id] === null ? 'No picture from the webcam' : 'Loading webcam…'}</span>
          {/if}
        </div>
      {/if}
      <div class="info">
        <div class="t">{open.name} <span class="muted">· {s?.detail ?? 'Checking…'}</span></div>
        {#if s?.file}<div class="d" title={s.file}>File: {s.file}</div>{/if}
        {#if s && s.progress !== null && s.state !== 'idle'}
          <div class="big"><span style="width: {s.progress * 100}%"></span></div>
          <div class="d mono">{Math.round(s.progress * 100)}% · {fmtTime(s.elapsed)} printed · {fmtTime(s.remaining)} to go</div>
        {/if}
        {#if s && s.state !== 'offline'}
          <div class="d mono">Nozzle {fmtTemp(s.hotend, s.hotendTarget)} · Bed {fmtTemp(s.bed, s.bedTarget)}</div>
        {/if}
        <button class="link" onclick={() => openWebPage(open.url)}><Icon name="external" size={12} />Open the printer's web page</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .pbar {
    flex: none;
    display: flex;
    flex-direction: column;
    padding: 6px 8px 6px 12px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .lead {
    color: var(--accent);
    display: grid;
  }
  .chips {
    flex: 1;
    min-width: 0;
    display: flex;
    gap: 6px;
    overflow-x: auto;
  }
  .chip {
    flex: none;
    display: flex;
    align-items: center;
    gap: 7px;
    height: 28px;
    padding: 0 10px;
    border-radius: 14px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .chip:hover,
  .chip.on {
    border-color: var(--neon-line);
  }
  .chip.on {
    box-shadow: var(--glow-sm);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--faint);
  }
  [data-state='idle'] .dot,
  [data-state='done'] .dot {
    background: var(--ok);
  }
  [data-state='printing'] .dot {
    background: var(--accent);
    box-shadow: 0 0 6px var(--accent);
    animation: pulse 1.6s ease-in-out infinite;
  }
  [data-state='paused'] .dot {
    background: none;
    box-shadow: inset 0 0 0 2px var(--accent);
  }
  [data-state='error'] .dot {
    background: var(--danger);
  }
  @keyframes pulse {
    50% {
      opacity: 0.4;
    }
  }
  .name {
    font-weight: 600;
  }
  .st,
  .left,
  .temp {
    color: var(--muted);
  }
  .pct {
    color: var(--accent);
  }
  .mini {
    width: 48px;
    height: 4px;
    border-radius: 2px;
    background: var(--elevated);
    overflow: hidden;
  }
  .mini span,
  .big span {
    display: block;
    height: 100%;
    background: var(--accent);
    box-shadow: var(--glow-sm);
  }
  .detail {
    display: flex;
    gap: 14px;
    padding: 10px 0 4px 25px;
  }
  .cam {
    flex: none;
    width: 240px;
    aspect-ratio: 4 / 3;
    border-radius: 6px;
    background: var(--bg);
    border: 1px solid var(--border);
    display: grid;
    place-items: center;
    overflow: hidden;
    color: var(--faint);
    font-size: 12px;
  }
  .cam img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .t {
    font-weight: 600;
  }
  .muted {
    font-weight: 400;
    color: var(--muted);
  }
  .d {
    font-size: 12px;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .big {
    max-width: 420px;
    height: 6px;
    border-radius: 3px;
    background: var(--elevated);
    overflow: hidden;
  }
  .link {
    align-self: flex-start;
    display: flex;
    align-items: center;
    gap: 5px;
    margin-top: 2px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .link:hover {
    text-decoration: underline;
  }
</style>
