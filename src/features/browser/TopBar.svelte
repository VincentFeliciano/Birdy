<script lang="ts">
  import Icon from '../../components/Icon.svelte'
  import Logo from '../../components/Logo.svelte'
  import { browser } from '../../stores/browser.svelte'

  const api = window.api
</script>

<header class="topbar">
  <div class="brand">
    <Logo />
    <span class="word mono">BOATY</span>
  </div>
  <div class="tabs" role="tablist" aria-label="Website tabs">
    {#each browser.tabs as t (t.id)}
      <div
        class="tab"
        class:active={t.id === browser.activeId}
        role="tab"
        tabindex="0"
        aria-selected={t.id === browser.activeId}
        title={t.title}
        onclick={() => api.tabs.activate(t.id)}
        onkeydown={(e) => e.key === 'Enter' && api.tabs.activate(t.id)}
        onauxclick={(e) => e.button === 1 && api.tabs.close(t.id)}>
        {#if t.loading}
          <span class="spinner"></span>
        {:else if t.favicon}
          <img src={t.favicon} alt="" width="14" height="14" />
        {:else}
          <span class="fav"><Icon name="globe" size={14} /></span>
        {/if}
        <span class="label">{t.title || 'New tab'}</span>
        <button
          class="x"
          aria-label="Close tab"
          onclick={(e) => {
            e.stopPropagation()
            api.tabs.close(t.id)
          }}><Icon name="close" size={12} stroke={2} /></button>
      </div>
    {/each}
    <button class="icon-btn new" title="New tab (Ctrl+T)" aria-label="New tab" onclick={() => api.tabs.create()}>
      <Icon name="plus" />
    </button>
  </div>
</header>

<style>
  .topbar {
    height: 44px;
    flex: none;
    display: flex;
    align-items: center;
    gap: 10px;
    /* Room for the native minimise / maximise / close buttons. */
    padding: 0 150px 0 14px;
    -webkit-app-region: drag;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 92px;
    flex: none;
  }
  .word {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.2em;
    color: var(--accent);
    text-shadow: var(--glow-text);
  }
  .tabs {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 4px;
    overflow: hidden;
  }
  .tab,
  .new {
    -webkit-app-region: no-drag;
  }
  .tab {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 30px;
    flex: 0 1 200px;
    min-width: 72px;
    padding: 0 6px 0 10px;
    border-radius: var(--r-md);
    color: var(--muted);
    border: 1px solid transparent;
    cursor: default;
  }
  .tab:hover {
    background: var(--panel);
    color: var(--text);
  }
  .tab.active {
    position: relative;
    background: rgba(var(--accent-rgb), 0.07);
    border-color: var(--neon-line);
    color: var(--text);
    box-shadow: var(--glow-sm), inset 0 0 12px rgba(var(--accent-rgb), 0.08);
  }
  .tab.active::after {
    content: '';
    position: absolute;
    left: 12px;
    right: 12px;
    bottom: -1px;
    height: 2px;
    border-radius: 2px;
    background: var(--accent);
    box-shadow: var(--glow-sm);
  }
  .tab img {
    border-radius: 3px;
    flex: none;
  }
  .fav {
    display: grid;
    color: var(--faint);
  }
  .label {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .x {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border-radius: 5px;
    color: var(--muted);
    flex: none;
    opacity: 0;
  }
  .tab:hover .x,
  .tab.active .x {
    opacity: 1;
  }
  .x:hover {
    background: var(--elevated);
    color: var(--text);
  }
</style>
