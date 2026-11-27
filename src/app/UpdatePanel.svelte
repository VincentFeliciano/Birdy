<script lang="ts">
  import Icon from '../components/Icon.svelte'
  import { fmtBytes } from './format'
  import { dismiss, updates } from './updates.svelte'

  const s = $derived(updates.state)
  let showNotes = $state(false)
  const pct = $derived(Math.round((s?.progress ?? 0) * 100))
</script>

{#if s}
  <div class="upd neon-panel" role="region" aria-label="Birdy update" aria-live="polite">
    <div class="icon" class:ready={s.status === 'ready'}><Icon name={s.status === 'ready' ? 'check' : 'download'} size={16} /></div>
    <div class="text">
      {#if s.status === 'checking'}
        <div class="t">Checking for updates…</div>
      {:else if s.status === 'none'}
        <div class="t">Birdy is up to date</div>
        <div class="d">You have the newest version, {s.current}.</div>
      {:else if s.status === 'available'}
        <div class="t">Birdy {s.version} is available</div>
        <div class="d">
          You have {s.current}.
          {#if s.notes}<button class="link" onclick={() => (showNotes = !showNotes)}>{showNotes ? 'Hide' : "What's new"}</button>{/if}
        </div>
      {:else if s.status === 'downloading'}
        <div class="t">Downloading Birdy {s.version}… {pct}%</div>
        <div class="bar"><span style="width: {pct}%"></span></div>
        {#if s.bytesPerSecond}<div class="d mono">{fmtBytes(s.bytesPerSecond)}/s</div>{/if}
      {:else if s.status === 'ready'}
        <div class="t">Birdy {s.version} is ready to install</div>
        <div class="d">Birdy restarts to finish. Otherwise it installs the next time you close Birdy.</div>
      {:else if s.status === 'error'}
        <div class="t">Couldn't update</div>
        <div class="d">{s.error}</div>
      {/if}
      {#if showNotes && s.notes && s.status === 'available'}
        <pre class="notes">{s.notes}</pre>
      {/if}
    </div>
    <div class="actions">
      {#if s.status === 'available'}
        <button class="primary" onclick={() => window.api.updates.download()}><Icon name="download" size={14} />Download update</button>
      {:else if s.status === 'ready'}
        <button class="primary" onclick={() => window.api.updates.install()}><Icon name="reload" size={14} />Restart and update</button>
      {:else if s.status === 'error' && s.version}
        <button class="ghost" onclick={() => window.api.updates.download()}>Try again</button>
      {:else if s.status === 'error'}
        <button class="ghost" onclick={() => window.api.updates.check()}>Try again</button>
      {/if}
    </div>
    <button
      class="icon-btn"
      title={s.status === 'available' ? 'Not now' : 'Close'}
      aria-label={s.status === 'available' ? 'Not now' : 'Close'}
      onclick={dismiss}><Icon name="close" size={15} /></button>
  </div>
{/if}

<style>
  .upd {
    flex: none;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 10px 10px 10px 14px;
  }
  .icon {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    flex: none;
    border-radius: 50%;
    color: var(--accent);
    border: 1px solid var(--neon-line);
    box-shadow: var(--glow-sm);
  }
  .icon.ready {
    color: var(--ok);
    border-color: rgba(62, 224, 143, 0.55);
    box-shadow: 0 0 10px rgba(62, 224, 143, 0.3);
  }
  .text {
    flex: 1;
    min-width: 0;
  }
  .t {
    font-weight: 600;
  }
  .d {
    font-size: 12px;
    color: var(--muted);
  }
  .bar {
    height: 4px;
    margin: 6px 0 4px;
    max-width: 420px;
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
  .notes {
    margin: 8px 0 0;
    max-height: 120px;
    overflow: auto;
    white-space: pre-wrap;
    font: 12px/1.5 inherit;
    color: var(--muted);
  }
  .link {
    padding: 0;
    margin-left: 6px;
    border: 0;
    background: none;
    color: var(--accent);
    font: inherit;
    cursor: pointer;
  }
  .link:hover {
    text-decoration: underline;
  }
  .actions {
    display: flex;
    gap: 8px;
  }
  .actions .primary {
    height: 32px;
    padding: 0 14px;
  }
</style>
