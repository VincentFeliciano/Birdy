<script lang="ts">
  import { onMount } from 'svelte'
  import Icon from '../../components/Icon.svelte'
  import { activeTab, browser } from '../../stores/browser.svelte'
  import { isBookmarked, toggleBookmark } from '../../stores/library.svelte'
  import { SEARCH_TYPES, isSearchType, type SearchType } from '../../types/ipc'
  import { modelPage } from '../../types/modelSites'
  import { ws } from '../workspace/store.svelte'

  let { resizing = false }: { resizing?: boolean } = $props()

  const api = window.api
  let host: HTMLDivElement
  let input: HTMLInputElement
  let addr = $state('')
  let editing = $state(false)
  const savedType = localStorage.getItem('birdy.searchType')
  let searchType = $state<SearchType>(isSearchType(savedType) ? savedType : 'models')
  const searchLabel = $derived(SEARCH_TYPES.find((t) => t.id === searchType)?.label ?? '3D models')

  const tab = $derived(activeTab())
  const secure = $derived(tab?.url.startsWith('https://') ?? false)
  const starred = $derived(tab && !tab.isStartPage ? isBookmarked(tab.url) : false)
  const page = $derived(tab ? modelPage(tab.url) : null)
  let getNote = $state<{ url: string; text: string } | null>(null)
  let getting = $state(false)

  async function getModel() {
    if (!tab) return
    getting = true
    try {
      const r = await api.tabs.getModel()
      getNote = r.ok ? { url: r.action === 'files' ? '' : tab.url, text: r.detail } : { url: tab.url, text: r.detail }
      // Bring the workspace into view so the model shows up next to the page.
      if (r.ok && ws.layout === 'browse') ws.layout = 'split'
    } finally {
      getting = false
    }
  }

  // The note belongs to the page it was given on (the files tab counts as the same model).
  $effect(() => {
    if (getNote && tab && getNote.url && getNote.url !== tab.url && modelPage(tab.url)?.id !== modelPage(getNote.url)?.id) getNote = null
    if (getNote && !getNote.url && tab) getNote = { url: tab.url, text: getNote.text }
    if (!page) getNote = null
  })

  // Follow the active page's URL unless the user is typing.
  $effect(() => {
    const url = tab?.url ?? ''
    if (!editing) addr = url
  })

  $effect(() => {
    if (browser.focusAddressTick > 0) {
      input?.focus()
      input?.select()
    }
  })

  onMount(() => {
    const send = () => {
      const r = host.getBoundingClientRect()
      api.layout.setWebBounds({ x: r.left, y: r.top, width: r.width, height: r.height })
    }
    const ro = new ResizeObserver(send)
    ro.observe(host)
    window.addEventListener('resize', send)
    send()
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', send)
    }
  })

  function submit(e: SubmitEvent) {
    e.preventDefault()
    if (addr.trim()) api.tabs.navigate(addr, searchType)
    editing = false
    input.blur()
  }
</script>

<div class="panel neon-panel">
  <div class="nav">
    <button class="icon-btn" aria-label="Back" title="Back (Alt+Left)" disabled={!tab?.canGoBack} onclick={() => api.tabs.back()}>
      <Icon name="back" />
    </button>
    <button class="icon-btn" aria-label="Forward" title="Forward (Alt+Right)" disabled={!tab?.canGoForward} onclick={() => api.tabs.forward()}>
      <Icon name="forward" />
    </button>
    {#if tab?.loading}
      <button class="icon-btn" aria-label="Stop" title="Stop" onclick={() => api.tabs.stop()}><Icon name="close" /></button>
    {:else}
      <button class="icon-btn" aria-label="Reload" title="Reload (Ctrl+R)" onclick={() => api.tabs.reload()}><Icon name="reload" /></button>
    {/if}
    <button class="icon-btn" aria-label="Home" title="Home" onclick={() => api.tabs.home()}><Icon name="home" /></button>
    <select
      class="stype mono"
      bind:value={searchType}
      onchange={() => localStorage.setItem('birdy.searchType', searchType)}
      title="What Google searches for when you type words instead of an address"
      aria-label="Search for">
      {#each SEARCH_TYPES as t}
        <option value={t.id}>{t.label}</option>
      {/each}
    </select>
    <form class="address" class:focused={editing} onsubmit={submit}>
      {#if secure && !editing}<span class="lock" title="Secure connection"><Icon name="lock" size={13} /></span>{/if}
      <input
        bind:this={input}
        bind:value={addr}
        spellcheck="false"
        autocomplete="off"
        placeholder={searchType === 'web' ? 'Search Google or enter address' : `Search Google for ${searchLabel} or enter address`}
        aria-label="Address and search bar"
        onfocus={() => {
          editing = true
          input.select()
        }}
        onblur={() => {
          editing = false
          addr = tab?.url ?? ''
        }}
        onkeydown={(e) => {
          if (e.key === 'Escape') input.blur()
        }} />
      {#if tab?.loading}<span class="loadbar"></span>{/if}
    </form>
    {#if page}
      <button class="get" disabled={getting} title="Get this {page.siteName} model into Boaty" onclick={getModel}>
        <Icon name="download" size={13} />Get in Boaty
      </button>
    {/if}
    <button
      class="icon-btn"
      class:on={starred}
      disabled={!tab || tab.isStartPage}
      title={starred ? 'Remove bookmark' : 'Bookmark this page'}
      aria-label={starred ? 'Remove bookmark' : 'Bookmark this page'}
      onclick={() => tab && toggleBookmark(tab)}><Icon name="star" /></button>
  </div>
  {#if getNote}
    <div class="getnote" role="status">
      <Icon name="download" size={13} />
      <span>{getNote.text}</span>
      <button class="icon-btn" aria-label="Dismiss" onclick={() => (getNote = null)}><Icon name="close" size={12} /></button>
    </div>
  {/if}
  <div class="web" bind:this={host}>
    {#if resizing}
      <div class="placeholder mono">RESIZING</div>
    {/if}
  </div>
</div>

<style>
  .get {
    flex: none;
    display: flex;
    align-items: center;
    gap: 5px;
    height: 28px;
    padding: 0 10px;
    border-radius: 14px;
    border: 1px solid var(--neon-line);
    background: rgba(var(--accent-rgb), 0.12);
    color: var(--accent);
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
    box-shadow: var(--glow-sm);
  }
  .get:hover {
    background: rgba(var(--accent-rgb), 0.22);
  }
  .get:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .getnote {
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px 6px 12px;
    border-top: 1px solid var(--border);
    font-size: 12px;
    color: var(--accent);
  }
  .getnote span {
    flex: 1;
    min-width: 0;
    color: var(--text);
  }
  .panel {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .nav {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 6px;
  }
  .stype {
    height: 30px;
    margin-left: 6px;
    padding: 0 6px;
    border-radius: var(--r-md);
    background: rgba(var(--accent-rgb), 0.08);
    border: 1px solid var(--neon-line);
    color: var(--accent);
    font-size: 11px;
    font-weight: 700;
    outline: none;
    cursor: pointer;
    box-shadow: var(--glow-sm);
  }
  .stype option {
    background: var(--panel);
    color: var(--text);
  }
  .address {
    position: relative;
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    height: 30px;
    margin: 0 4px 0 6px;
    padding: 0 10px;
    border-radius: var(--r-md);
    background: var(--surface);
    border: 1px solid transparent;
    overflow: hidden;
  }
  .address.focused {
    border-color: var(--neon-line);
    box-shadow: var(--glow-sm);
  }
  .lock {
    display: grid;
    color: var(--ok);
    margin-right: 6px;
  }
  .address input {
    flex: 1;
    min-width: 0;
    background: none;
    border: 0;
    outline: none;
    user-select: text;
  }
  .address input::placeholder {
    color: var(--faint);
  }
  .loadbar {
    position: absolute;
    left: 0;
    bottom: 0;
    height: 2px;
    width: 40%;
    background: var(--accent);
    box-shadow: var(--glow-sm);
    animation: slide 1.1s ease-in-out infinite;
  }
  @keyframes slide {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(260%);
    }
  }
  .web {
    flex: 1;
    min-height: 0;
    margin: 0 6px 6px;
    border-radius: 10px;
    background: var(--bg);
    position: relative;
  }
  .placeholder {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: var(--faint);
    font-size: 11px;
    letter-spacing: 0.2em;
  }
</style>
