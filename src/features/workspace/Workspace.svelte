<script lang="ts">
  import { onMount } from 'svelte'
  import Icon, { type IconName } from '../../components/Icon.svelte'
  import Sidebar from '../model-editor/Sidebar.svelte'
  import PreviewControls from '../slicing/PreviewControls.svelte'
  import { initSlicing } from '../slicing/store.svelte'
  import { Viewer, type Tool, type ViewPreset } from '../../engine/three/viewer'
  import { fmtInt, fmtNum } from '../../app/format'
  import { openSample } from '../../app/demo.svelte'
  import { onAccent } from '../../app/theme.svelte'
  import {
    activate,
    activeModel,
    attachViewer,
    closeModel,
    fit,
    openFromDialog,
    remember,
    reopenSaved,
    setThumbnailer,
    saveAs,
    setProjection,
    setTool,
    setView,
    toggle,
    ws,
  } from './store.svelte'

  let host: HTMLDivElement

  const model = $derived(activeModel())

  const tools: { id: Tool; icon: IconName; label: string; key: string }[] = [
    { id: 'select', icon: 'select', label: 'Select / orbit', key: 'Q' },
    { id: 'move', icon: 'move', label: 'Move', key: 'W' },
    { id: 'rotate', icon: 'rotate', label: 'Rotate', key: 'E' },
    { id: 'scale', icon: 'scale', label: 'Scale', key: 'R' },
  ]
  const views: { id: ViewPreset; label: string }[] = [
    { id: 'iso', label: 'ISO' },
    { id: 'front', label: 'F' },
    { id: 'back', label: 'BK' },
    { id: 'left', label: 'L' },
    { id: 'right', label: 'R' },
    { id: 'top', label: 'T' },
    { id: 'bottom', label: 'BT' },
  ]
  const viewNames: Record<ViewPreset, string> = {
    iso: 'Isometric',
    front: 'Front',
    back: 'Back',
    left: 'Left',
    right: 'Right',
    top: 'Top',
    bottom: 'Bottom',
  }

  onMount(() => {
    const v = new Viewer(host)
    attachViewer(v)
    setThumbnailer(() => v.snapshot())
    const offAccent = onAccent((hex) => v.setAccent(hex))
    const offSlicing = initSlicing()
    return () => {
      offSlicing?.()
      offAccent()
      setThumbnailer(null)
      attachViewer(null)
      v.dispose()
    }
  })

  function onKey(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const k = e.key.toLowerCase()
    const tool = tools.find((t) => t.key.toLowerCase() === k)
    if (tool) setTool(tool.id)
    else if (k === 'f') fit()
    else return
    e.preventDefault()
  }
</script>

<div class="panel neon-panel">
  <header class="head">
    <div class="mtabs" role="tablist" aria-label="Open models">
      {#each ws.models as m (m.id)}
        <div
          class="mtab"
          class:active={m.id === ws.activeId}
          role="tab"
          tabindex="0"
          aria-selected={m.id === ws.activeId}
          title={m.name}
          onclick={() => activate(m.id)}
          onkeydown={(e) => e.key === 'Enter' && activate(m.id)}>
          <Icon name="cube" size={14} />
          <span class="label">{m.name}</span>
          {#if m.modified}<span class="dot" title="Modified"></span>{/if}
          <button
            class="x"
            aria-label="Close model"
            onclick={(e) => {
              e.stopPropagation()
              closeModel(m.id)
            }}><Icon name="close" size={12} stroke={2} /></button>
        </div>
      {/each}
      <button class="icon-btn" title="Open model (Ctrl+O)" aria-label="Open model" onclick={openFromDialog}><Icon name="plus" /></button>
    </div>
    <button
      class="icon-btn"
      class:on={ws.sidebarOpen}
      title="Toggle properties panel"
      aria-label="Toggle properties panel"
      onclick={() => {
        ws.sidebarOpen = !ws.sidebarOpen
        remember()
      }}><Icon name="sidebar" /></button>
    <button class="primary" disabled={!model || ws.saving} onclick={saveAs}><Icon name="save" size={15} />Save as</button>
  </header>

  <div class="body">
    <div
      class="stage"
      role="application"
      aria-label="3D model viewport"
>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
      <div class="canvas" bind:this={host} role="application" aria-label="Viewport canvas (Q W E R tools, F fit)" tabindex="0" onkeydown={onKey}></div>

      <!-- HUD frame -->
      <span class="corner tl"></span><span class="corner tr"></span><span class="corner bl"></span><span class="corner br"></span>

      <div class="hud top-left mono">
        <span class="hud-tag">VIEWPORT</span>
        <span>{ws.projection === 'perspective' ? 'PERSP' : 'ORTHO'}</span>
        {#if model}<span class="hud-name">{model.name}</span>{/if}
      </div>

      {#if model}
        <button
          class="verdict-hud mono {ws.checking ? 'checking' : (ws.report?.verdict ?? 'checking')}"
          title="Open the print check"
          onclick={() => {
            ws.sidebarOpen = true
            ws.sidebarTab = 'model'
          }}>
          {#if ws.checking || !ws.report}
            <span class="spinner"></span>CHECKING
          {:else if ws.report.verdict === 'ready'}
            <Icon name="shield" size={14} />READY TO PRINT
          {:else if ws.report.verdict === 'attention'}
            <Icon name="alert" size={14} />NEEDS ATTENTION
          {:else}
            <Icon name="alert" size={14} />WON'T PRINT
          {/if}
        </button>
      {/if}

      <div class="viewbar">
        <div class="group">
          {#each views as v}
            <button class="txt mono" title={`${viewNames[v.id]} view`} onclick={() => setView(v.id)}>{v.label}</button>
          {/each}
        </div>
        <div class="group">
          <button
            class="icon-btn"
            title={ws.projection === 'perspective' ? 'Perspective (click for orthographic)' : 'Orthographic (click for perspective)'}
            aria-label="Toggle projection"
            onclick={() => setProjection(ws.projection === 'perspective' ? 'orthographic' : 'perspective')}>
            <Icon name={ws.projection === 'perspective' ? 'perspective' : 'ortho'} />
          </button>
          <button class="icon-btn" class:on={ws.wireframe} title="Wireframe" aria-label="Wireframe" onclick={() => toggle('wireframe')}><Icon name="wireframe" /></button>
          <button class="icon-btn" class:on={ws.bbox} title="Bounding box" aria-label="Bounding box" onclick={() => toggle('bbox')}><Icon name="bbox" /></button>
          <button class="icon-btn" class:on={ws.grid} title="Build plate grid" aria-label="Grid" onclick={() => toggle('grid')}><Icon name="grid" /></button>
          <button class="icon-btn" class:on={ws.snap} title="Snap (1 mm, 15°, 5%)" aria-label="Snapping" onclick={() => toggle('snap')}><Icon name="snap" /></button>
          <button class="icon-btn" title="Fit to view (F)" aria-label="Fit to view" onclick={fit}><Icon name="fit" /></button>
        </div>
      </div>

      <PreviewControls />

      <div class="toolrail" role="toolbar" aria-label="Transform tools">
        {#each tools as t}
          <button class="icon-btn" class:on={ws.tool === t.id} title={`${t.label} (${t.key})`} aria-label={t.label} onclick={() => setTool(t.id)}>
            <Icon name={t.icon} size={17} />
          </button>
        {/each}
      </div>

      {#if ws.stats}
        <div class="hud bottom-left mono">
          <span class="hud-tag">DIM</span>
          <span><i class="ax-x">X</i>{fmtNum(ws.stats.size.x)}</span>
          <span><i class="ax-y">Y</i>{fmtNum(ws.stats.size.y)}</span>
          <span><i class="ax-z">Z</i>{fmtNum(ws.stats.size.z)}</span>
          <span class="unit">MM</span>
        </div>
        <div class="hud bottom-right mono">
          <span>TRIS {fmtInt(ws.stats.triangles)}</span>
          <span>OBJ {ws.stats.meshes}</span>
          <span class="tool">{ws.tool.toUpperCase()}</span>
        </div>
      {/if}

      {#if !ws.models.length && !ws.loading}
        <div class="empty">
          <div class="empty-icon"><Icon name="cube" size={34} stroke={1.4} /></div>
          <h2>Drop a model here</h2>
          <p>STL · 3MF · OBJ · GLB · PLY. Models you download from any site open here automatically.</p>
          <div class="actions">
            <button class="primary" onclick={openFromDialog}><Icon name="open" size={15} />Open model</button>
            <button class="ghost" onclick={openSample}>Load sample</button>
          </div>
        </div>
      {/if}

      {#if ws.loading}
        <div class="overlay">
          <span class="spinner big"></span>
          <span class="mono">{ws.loading.toUpperCase()}</span>
        </div>
      {/if}

      {#if ws.error}
        <div class="toast error" role="alert">
          <Icon name="alert" size={16} />
          <span>{ws.error}</span>
          <button class="icon-btn" aria-label="Dismiss" onclick={() => (ws.error = null)}><Icon name="close" size={14} /></button>
        </div>
      {:else if ws.notice}
        <div class="toast ok" role="status">
          <Icon name="check" size={16} />
          <span>{ws.notice.text}</span>
          {#if ws.notice.path}
            <button class="ghost" onclick={() => reopenSaved(ws.notice!.path!)}>Reopen</button>
          {/if}
          <button class="icon-btn" aria-label="Dismiss" onclick={() => (ws.notice = null)}><Icon name="close" size={14} /></button>
        </div>
      {/if}
    </div>

    {#if ws.sidebarOpen}
      <Sidebar />
    {/if}
  </div>
</div>

<style>
  .panel {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px;
  }
  .mtabs {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 4px;
    overflow: hidden;
  }
  .mtab {
    display: flex;
    align-items: center;
    gap: 7px;
    height: 30px;
    flex: 0 1 190px;
    min-width: 80px;
    padding: 0 6px 0 10px;
    border-radius: var(--r-md);
    color: var(--muted);
    border: 1px solid transparent;
    cursor: default;
  }
  .mtab:hover {
    background: var(--surface);
    color: var(--text);
  }
  .mtab.active {
    color: var(--text);
    background: rgba(var(--accent-rgb), 0.07);
    border-color: var(--neon-line);
    box-shadow: var(--glow-sm);
  }
  .mtab.active :global(svg:first-child) {
    color: var(--accent);
    filter: drop-shadow(0 0 3px rgba(var(--accent-rgb), 0.8));
  }
  .label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: var(--glow-sm);
    flex: none;
  }
  .x {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border-radius: 5px;
    color: var(--muted);
    flex: none;
  }
  .x:hover {
    background: var(--elevated);
    color: var(--text);
  }

  .body {
    flex: 1;
    min-height: 0;
    display: flex;
    margin: 0 6px 6px;
    border-radius: 10px;
    overflow: hidden;
    border: 1px solid var(--border);
    background: #0d0f13;
  }
  .stage {
    position: relative;
    flex: 1;
    min-width: 0;
    overflow: hidden;
  }
  .canvas {
    position: absolute;
    inset: 0;
    outline: none;
  }
  .canvas:focus-visible {
    box-shadow: none;
  }

  /* HUD frame corners */
  .corner {
    position: absolute;
    width: 18px;
    height: 18px;
    border: 0 solid var(--accent);
    filter: drop-shadow(0 0 4px rgba(var(--accent-rgb), 0.9));
    opacity: 0.85;
    pointer-events: none;
  }
  .tl {
    top: 10px;
    left: 10px;
    border-top-width: 2px;
    border-left-width: 2px;
  }
  .tr {
    top: 10px;
    right: 10px;
    border-top-width: 2px;
    border-right-width: 2px;
  }
  .bl {
    bottom: 10px;
    left: 10px;
    border-bottom-width: 2px;
    border-left-width: 2px;
  }
  .br {
    bottom: 10px;
    right: 10px;
    border-bottom-width: 2px;
    border-right-width: 2px;
  }

  .hud {
    position: absolute;
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 10.5px;
    letter-spacing: 0.08em;
    color: var(--muted);
    pointer-events: none;
    white-space: nowrap;
  }
  .top-left {
    top: 54px;
    left: 18px;
  }
  .bottom-left {
    bottom: 18px;
    left: 34px;
  }
  .bottom-right {
    bottom: 18px;
    right: 34px;
  }
  .hud-tag {
    color: var(--accent);
    text-shadow: var(--glow-text);
    font-weight: 700;
    letter-spacing: 0.18em;
  }
  .hud-name {
    color: var(--text);
    max-width: 260px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .hud i {
    font-style: normal;
    font-weight: 700;
    margin-right: 5px;
  }
  .ax-x {
    color: #ff5a64;
  }
  .ax-y {
    color: #4be38a;
  }
  .ax-z {
    color: #4aa3ff;
  }
  .bottom-left span:not(.hud-tag) {
    color: var(--text);
  }
  .bottom-left .unit {
    color: var(--faint) !important;
  }
  .tool {
    color: var(--accent);
    text-shadow: var(--glow-text);
  }

  .verdict-hud {
    position: absolute;
    top: 82px;
    left: 18px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 24px;
    padding: 0 9px;
    border-radius: 12px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.12em;
    background: rgba(11, 12, 15, 0.8);
    color: var(--muted);
    border: 1px solid var(--border-strong);
  }
  .verdict-hud .spinner {
    width: 10px;
    height: 10px;
    border-width: 1.5px;
  }
  .verdict-hud.ready {
    color: var(--ok);
    border-color: rgba(62, 224, 143, 0.6);
    box-shadow: 0 0 10px rgba(62, 224, 143, 0.35);
    text-shadow: 0 0 8px rgba(62, 224, 143, 0.6);
  }
  .verdict-hud.attention {
    color: var(--accent);
    border-color: var(--neon-line);
    box-shadow: var(--glow-sm);
    text-shadow: var(--glow-text);
  }
  .verdict-hud.fail {
    color: var(--danger);
    border-color: rgba(255, 77, 94, 0.6);
    box-shadow: 0 0 10px rgba(255, 77, 94, 0.35);
    text-shadow: 0 0 8px rgba(255, 77, 94, 0.6);
  }
  .viewbar {
    position: absolute;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    gap: 6px;
  }
  .group {
    display: flex;
    align-items: center;
    gap: 1px;
    padding: 3px;
    border-radius: var(--r-md);
    background: rgba(18, 20, 25, 0.85);
    backdrop-filter: blur(8px);
    border: 1px solid var(--neon-soft);
    box-shadow: 0 0 14px rgba(var(--accent-rgb), 0.08);
  }
  .group .icon-btn {
    width: 28px;
    height: 28px;
  }
  .txt {
    height: 28px;
    min-width: 28px;
    padding: 0 6px;
    border-radius: 6px;
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.06em;
    color: var(--muted);
  }
  .txt:hover {
    color: var(--accent);
    background: var(--surface);
    text-shadow: var(--glow-text);
  }

  .toolrail {
    position: absolute;
    right: 12px;
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 4px;
    border-radius: var(--r-lg);
    background: rgba(18, 20, 25, 0.85);
    backdrop-filter: blur(8px);
    border: 1px solid var(--neon-soft);
    box-shadow: 0 0 14px rgba(var(--accent-rgb), 0.08);
  }
  .toolrail .icon-btn {
    width: 32px;
    height: 32px;
  }

  .empty {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 24px;
    pointer-events: none;
  }
  .empty > * {
    pointer-events: auto;
  }
  .empty-icon {
    display: grid;
    place-items: center;
    width: 72px;
    height: 72px;
    border-radius: 18px;
    color: var(--accent);
    border: 1px solid var(--neon-line);
    box-shadow: var(--glow-md), inset 0 0 18px rgba(var(--accent-rgb), 0.15);
    background: rgba(13, 15, 19, 0.8);
    margin-bottom: 16px;
  }
  .empty-icon :global(svg) {
    filter: drop-shadow(0 0 4px rgba(var(--accent-rgb), 0.9));
  }
  .empty h2 {
    margin: 0 0 6px;
    font-size: 18px;
    font-weight: 600;
  }
  .empty p {
    margin: 0 0 18px;
    max-width: 340px;
    color: var(--muted);
  }
  .actions {
    display: flex;
    gap: 8px;
  }

  .overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    background: rgba(11, 12, 15, 0.72);
    font-size: 11px;
    letter-spacing: 0.18em;
    color: var(--accent);
    text-shadow: var(--glow-text);
  }
  .spinner.big {
    width: 32px;
    height: 32px;
    border-width: 3px;
  }

  .toast {
    position: absolute;
    left: 50%;
    bottom: 44px;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: calc(100% - 120px);
    padding: 6px 6px 6px 12px;
    border-radius: var(--r-md);
    background: rgba(18, 20, 25, 0.95);
    border: 1px solid var(--border-strong);
  }
  .toast span {
    flex: 1;
    min-width: 0;
    user-select: text;
  }
  .toast.error {
    border-color: rgba(255, 77, 94, 0.6);
    box-shadow: 0 0 14px rgba(255, 77, 94, 0.25);
    color: #ffb3ba;
  }
  .toast.ok {
    border-color: rgba(62, 224, 143, 0.55);
    box-shadow: 0 0 14px rgba(62, 224, 143, 0.2);
  }
  .toast.ok > :global(svg) {
    color: var(--ok);
  }
</style>
