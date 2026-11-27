<script lang="ts">
  import { initHistory } from '../features/history/history.svelte'
  import { onMount } from 'svelte'
  import TopBar from '../features/browser/TopBar.svelte'
  import WebPanel from '../features/browser/WebPanel.svelte'
  import DownloadsPanel from '../features/downloads/DownloadsPanel.svelte'
  import Workspace from '../features/workspace/Workspace.svelte'
  import Rail from './Rail.svelte'
  import LibraryView from '../features/file-library/LibraryView.svelte'
  import { initLibrary } from '../stores/library.svelte'
  import { downloads, focusAddress, initStores } from '../stores/browser.svelte'
  import { openDroppedFiles, openFromDialog, openFromDownload, openModelFile, remember, toggleWorkspace, ws } from '../features/workspace/store.svelte'
  import CommandPalette from './CommandPalette.svelte'
  import ShortcutsOverlay from './ShortcutsOverlay.svelte'
  import Icon from '../components/Icon.svelte'
  import { maybeStartTour, ui } from './commands.svelte'
  import Tour from './Tour.svelte'
  import { installDemo } from './demo.svelte'
  import { applyAccent, theme } from './theme.svelte'
  import ThemePanel from './ThemePanel.svelte'
  import ModelsPanel from '../features/models/ModelsPanel.svelte'
  import { addModelToPlate, initModels, models, openModel } from '../features/models/store.svelte'
  import UpdatePanel from './UpdatePanel.svelte'
  import PrinterBar from '../features/printers/PrinterBar.svelte'
  import { bar, initPrinterBar, networkPrinters } from '../features/printers/status.svelte'
  import { initUpdates, stripVisible } from './updates.svelte'

  let dragging = $state(false)
  // Files dragged in from Explorer: the whole window becomes a drop target.
  let fileDrag = $state(false)
  let dragDepth = 0
  const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false

  function onDragEnter(e: DragEvent) {
    if (!hasFiles(e)) return
    dragDepth++
    fileDrag = true
  }
  function onDragLeave(e: DragEvent) {
    if (!hasFiles(e)) return
    dragDepth = Math.max(0, dragDepth - 1)
    if (!dragDepth) fileDrag = false
  }
  // A model tile dragged from the Models panel.
  const MODEL_DRAG = 'application/x-birdy-model'
  const hasTile = (e: DragEvent) => e.dataTransfer?.types.includes(MODEL_DRAG) ?? false
  function onDragOver(e: DragEvent) {
    if (hasTile(e)) {
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
      return
    }
    if (!hasFiles(e)) return
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  }
  function onDrop(e: DragEvent) {
    if (hasTile(e)) {
      e.preventDefault()
      const rel = e.dataTransfer!.getData(MODEL_DRAG)
      // Onto the 3D view with a model open: add it to that plate. Anywhere else: open it.
      const onView = (e.target as HTMLElement | null)?.closest?.('canvas, .canvas')
      if (rel && ws.activeId && ws.layout !== 'browse' && onView) void addModelToPlate(rel)
      else if (rel) {
        if (ws.layout === 'browse') ws.layout = 'split'
        void openModel(rel)
      }
      return
    }
    if (!hasFiles(e)) return
    e.preventDefault()
    dragDepth = 0
    fileDrag = false
    void openDroppedFiles([...(e.dataTransfer?.files ?? [])])
  }

  /** "?" opens the shortcuts list, unless the user is typing. */
  function onKey(e: KeyboardEvent) {
    if (e.key !== '?' || e.ctrlKey || e.altKey || e.metaKey || ui.palette || ui.tour) return
    const t = e.target as HTMLElement | null
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
    e.preventDefault()
    ui.shortcuts = !ui.shortcuts
  }
  let mainEl: HTMLElement

  onMount(() => {
    const offStores = initStores()
    const offLibrary = initLibrary()
    const offModel = window.api.downloads.onModelReady((id) => openFromDownload(id))
    const offDropped = window.api.downloads.onModelDropped((file) => {
      if (ws.layout === 'browse') ws.layout = 'split'
      void openModelFile(file).catch((err: Error) => (ws.error = err.message))
    })
    const offKeys = window.api.app.onShortcut((s) => {
      if (s === 'toggle-workspace') toggleWorkspace()
      else if (s === 'open-model') openFromDialog()
      else if (s === 'palette') {
        ui.shortcuts = false
        ui.palette = !ui.palette
      } else if (s === 'shortcuts') {
        ui.palette = false
        ui.shortcuts = !ui.shortcuts
      }
      else if (s === 'focus-address') {
        if (ws.layout === 'workspace') ws.layout = 'split'
        focusAddress()
      }
    })
    installDemo()
    applyAccent(theme.accent)
    void initUpdates()
    const offModels = initModels()
    const offHistory = initHistory()
    // Give screenshot runs time to opt out before the first-run tour appears.
    const tourTimer = setTimeout(maybeStartTour, 1200)
    const offPrinters = initPrinterBar()
    return () => {
      offHistory()
      clearTimeout(tourTimer)
      offPrinters()
      offStores()
      offLibrary()
      offModel()
      offDropped()
      offKeys()
      offModels()
    }
  })

  // The website is a native view; hide it while resizing so the divider keeps the pointer.
  $effect(() => {
    window.api.layout.setWebVisible((ws.layout === 'browse' || ws.layout === 'split') && !dragging && !fileDrag && !ui.palette && !ui.shortcuts && !ui.tour)
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

<svelte:window ondragenter={onDragEnter} ondragleave={onDragLeave} ondragover={onDragOver} ondrop={onDrop} onkeydown={onKey} />

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
      {#if models.open}
        <ModelsPanel />
      {/if}
      {#if downloads.open && downloads.items.length}
        <DownloadsPanel />
      {/if}
      {#if !bar.hidden && networkPrinters().length}
        <PrinterBar />
      {/if}
      {#if stripVisible()}
        <UpdatePanel />
      {/if}
      {#if fileDrag}
        <div class="dropzone" aria-hidden="true">
          <div class="dz-inner">
            <Icon name="download" size={34} />
            <span class="dz-t">Drop to open in Birdy</span>
            <span class="dz-d mono">STL · 3MF · OBJ · GLB · glTF · PLY</span>
          </div>
        </div>
      {/if}
      {#if theme.panelOpen}
        <ThemePanel onclose={() => (theme.panelOpen = false)} />
      {/if}
    </div>
  </div>
</div>
{#if ui.tour}
  <Tour />
{/if}
{#if ui.palette}
  <CommandPalette />
{/if}
{#if ui.shortcuts}
  <ShortcutsOverlay />
{/if}

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
    position: relative;
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
  .dropzone {
    position: absolute;
    inset: 0 var(--gap) var(--gap) 0;
    z-index: 50;
    display: grid;
    place-items: center;
    border: 2px dashed var(--neon-line);
    border-radius: 12px;
    background: rgba(0, 0, 0, 0.55);
    box-shadow: inset 0 0 60px rgba(var(--accent-rgb), 0.18);
    pointer-events: none;
  }
  .dz-inner {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    color: var(--accent);
  }
  .dz-t {
    font-size: 18px;
    font-weight: 600;
  }
  .dz-d {
    font-size: 11px;
    color: var(--muted);
  }
</style>
