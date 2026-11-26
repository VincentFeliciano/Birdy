<script lang="ts">
  import { onMount } from 'svelte'
  import TopBar from '../features/browser/TopBar.svelte'
  import WebPanel from '../features/browser/WebPanel.svelte'
  import DownloadsPanel from '../features/downloads/DownloadsPanel.svelte'
  import Workspace from '../features/workspace/Workspace.svelte'
  import Rail from './Rail.svelte'
  import LibraryView from '../features/file-library/LibraryView.svelte'
  import { initLibrary } from '../stores/library.svelte'
  import { downloads, focusAddress, initStores } from '../stores/browser.svelte'
  import { openFromDialog, openFromDownload, remember, toggleWorkspace, ws } from '../features/workspace/store.svelte'
  import { installDemo } from './demo.svelte'
  import { applyAccent, theme } from './theme.svelte'

  let dragging = $state(false)
  let mainEl: HTMLElement

  onMount(() => {
    const offStores = initStores()
    const offLibrary = initLibrary()
    const offModel = window.api.downloads.onModelReady((id) => openFromDownload(id))
    const offKeys = window.api.app.onShortcut((s) => {
      if (s === 'toggle-workspace') toggleWorkspace()
      else if (s === 'open-model') openFromDialog()
      else if (s === 'focus-address') {
        if (ws.layout === 'workspace') ws.layout = 'split'
        focusAddress()
      }
    })
    installDemo()
    applyAccent(theme.accent)
    return () => {
      offStores()
      offLibrary()
      offModel()
      offKeys()
    }
  })

  // The website is a native view; hide it while resizing so the divider keeps the pointer.
  $effect(() => {
    window.api.layout.setWebVisible((ws.layout === 'browse' || ws.layout === 'split') && !dragging)
  })

  function startDrag(e: PointerEvent) {
    if (e.button !== 0) return
    e.preventDefault()
    dragging = true
    const rect = mainEl.getBoundingClientRect()
    const move = (ev: PointerEvent) => {
      ws.ratio = Math.min(0.8, Math.max(0.2, (ev.clientX - rect.left) / rect.width))
    }
    const up = () => {
      dragging = false
      remember()
      window.removeEventListener('pointermove', move)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up, { once: true })
  }

  function resetSplit() {
    ws.ratio = 0.45
    remember()
  }
</script>

<div class="app">
  <TopBar />
  <div class="body">
    <Rail />
    <div class="stack">
      <main class="main" bind:this={mainEl} data-layout={ws.layout} class:dragging style="--web: {ws.ratio * 100}%">
        <section class="web-col">
          <WebPanel resizing={dragging} />
        </section>
        <div
          class="divider"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize website and workspace"
          title="Drag to resize · double-click to reset"
          onpointerdown={startDrag}
          ondblclick={resetSplit}>
          <span></span>
        </div>
        <section class="ws-col">
          <Workspace />
        </section>
        {#if ws.layout === 'library'}
          <section class="lib-col"><LibraryView /></section>
        {/if}
      </main>
      {#if downloads.open && downloads.items.length}
        <DownloadsPanel />
      {/if}
    </div>
  </div>
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .body {
    flex: 1;
    min-height: 0;
    display: flex;
  }
  .stack {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--gap);
    padding: 0 var(--gap) var(--gap) 0;
  }
  .main {
    flex: 1;
    min-height: 0;
    display: flex;
  }
  .web-col,
  .ws-col {
    min-width: 0;
    display: flex;
  }
  .web-col {
    flex: 0 0 var(--web);
  }
  .ws-col {
    flex: 1 1 0;
  }
  .main[data-layout='browse'] .web-col {
    flex: 1 1 auto;
  }
  .main[data-layout='browse'] .ws-col,
  .main[data-layout='browse'] .divider,
  .main[data-layout='workspace'] .web-col,
  .main[data-layout='workspace'] .divider,
  .main[data-layout='library'] .web-col,
  .main[data-layout='library'] .ws-col,
  .main[data-layout='library'] .divider {
    display: none;
  }
  .lib-col {
    flex: 1;
    min-width: 0;
    display: flex;
  }
  .divider {
    flex: 0 0 var(--gap);
    cursor: col-resize;
    display: grid;
    place-items: center;
  }
  .divider span {
    width: 2px;
    height: 36px;
    border-radius: 2px;
    background: var(--neon-soft);
    transition: background 0.15s, height 0.15s, box-shadow 0.15s;
  }
  .divider:hover span,
  .dragging .divider span {
    background: var(--accent);
    box-shadow: var(--glow-md);
    height: 64px;
  }
  .dragging {
    cursor: col-resize;
  }
</style>
