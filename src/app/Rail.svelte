<script lang="ts">
  import Icon, { type IconName } from '../components/Icon.svelte'
  import { downloads } from '../stores/browser.svelte'
  import { openFromDialog, ws, type Layout } from '../features/workspace/store.svelte'
  import { theme } from './theme.svelte'
  import { models, setModelsOpen } from '../features/models/store.svelte'

  const modes: { id: Layout; icon: IconName; label: string }[] = [
    { id: 'browse', icon: 'globe', label: 'Browse' },
    { id: 'split', icon: 'split', label: 'Split: website + workspace (Ctrl+E)' },
    { id: 'workspace', icon: 'workspace', label: 'Workspace only' },
    { id: 'library', icon: 'library', label: 'Library: bookmarks and saved models' },
  ]
  const active = $derived(downloads.items.filter((d) => d.state === 'progressing').length)
</script>

<nav class="rail" aria-label="Main navigation">
  <div class="group">
    {#each modes as m}
      <button class="icon-btn" class:on={ws.layout === m.id} title={m.label} aria-label={m.label} onclick={() => (ws.layout = m.id)}>
        <Icon name={m.icon} size={18} />
      </button>
    {/each}
  </div>
  <div class="sep"></div>
  <button class="icon-btn" title="Open model from disk (Ctrl+O)" aria-label="Open model" onclick={openFromDialog}>
    <Icon name="open" size={18} />
  </button>
  <button
    class="icon-btn badge-host"
    class:on={downloads.open && downloads.items.length > 0}
    title="Downloads"
    aria-label="Downloads"
    onclick={() => (downloads.open = !downloads.open)}>
    <Icon name="download" size={18} />
    {#if active}<span class="badge mono">{active}</span>{/if}
  </button>
  <div class="spacer"></div>
  <button
    class="icon-btn theme-btn"
    class:on={theme.panelOpen}
    title="Theme: neon colour ({theme.accent.name})"
    aria-label="Theme: change neon colour"
    aria-expanded={theme.panelOpen}
    onclick={() => (theme.panelOpen = !theme.panelOpen)}>
    <Icon name="palette" size={18} />
    <span class="swatch" style="--c: {theme.accent.hex}"></span>
  </button>
  <button
    class="icon-btn"
    class:on={models.open}
    title="Models: your downloaded and unpacked models"
    aria-label="Models folder"
    aria-expanded={models.open}
    onclick={() => setModelsOpen(!models.open)}>
    <Icon name="folder" size={18} />
  </button>
</nav>

<style>
  .rail {
    width: 52px;
    flex: none;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 4px 0 var(--gap);
  }
  .rail :global(.icon-btn) {
    width: 36px;
    height: 36px;
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 4px;
    border-radius: var(--r-lg);
    background: var(--panel);
    border: 1px solid var(--neon-soft);
    box-shadow: 0 0 14px rgba(var(--accent-rgb), 0.08);
  }
  .theme-btn {
    position: relative;
  }
  .theme-btn .swatch {
    position: absolute;
    right: 5px;
    bottom: 5px;
  }
  .swatch {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--c);
    box-shadow: 0 0 6px var(--c), 0 0 14px var(--c);
  }
  .group :global(.icon-btn) {
    width: 32px;
    height: 32px;
  }
  .sep {
    width: 20px;
    height: 1px;
    background: var(--border-strong);
    margin: 6px 0;
  }
  .spacer {
    flex: 1;
  }
  .badge-host {
    position: relative;
  }
  .badge {
    position: absolute;
    top: 3px;
    right: 3px;
    min-width: 15px;
    height: 15px;
    padding: 0 3px;
    border-radius: 8px;
    background: var(--accent);
    color: var(--accent-ink);
    box-shadow: var(--glow-sm);
    font-size: 10px;
    line-height: 15px;
    font-weight: 700;
  }
</style>
