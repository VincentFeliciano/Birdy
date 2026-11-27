<script lang="ts">
  import { onMount } from 'svelte'
  import Icon from '../components/Icon.svelte'
  import Logo from '../components/Logo.svelte'
  import PricesEditor from '../components/PricesEditor.svelte'
  import ybLogo from '../assets/yellow-brick.png'
  import type { AppFolderKey, AppFolders } from '../types/ipc'
  import { ACCENTS, applyAccent, applyCustomAccent, theme } from './theme.svelte'
  import { checkNow, updates } from './updates.svelte'
  import { startTour, ui } from './commands.svelte'
  import { chooseGcodeFolder, loadGcodeFolder, sl } from '../features/slicing/store.svelte'
  import { ws } from '../features/workspace/store.svelte'

  const YB_URL = 'https://vincentfeliciano.github.io/yellowbrick'
  type Section = 'appearance' | 'slicing' | 'folders' | 'updates' | 'about'
  const SECTIONS: { id: Section; label: string }[] = [
    { id: 'appearance', label: 'Appearance' },
    { id: 'slicing', label: 'Slicing & printers' },
    { id: 'folders', label: 'Folders' },
    { id: 'updates', label: 'Updates' },
    { id: 'about', label: 'About' },
  ]
  let section = $state<Section>('appearance')
  let folders = $state<AppFolders | null>(null)
  const isCustom = $derived(theme.accent.id === 'custom')
  const engine = $derived(sl.engine)
  const version = $derived(updates.state?.current ?? '')

  const updateLine = $derived.by(() => {
    const u = updates.state
    if (!u) return ''
    if (u.status === 'checking') return 'Checking…'
    if (u.status === 'none') return 'Up to date'
    if (u.status === 'available') return `${u.version} available`
    if (u.status === 'downloading') return `Downloading ${u.version}…`
    if (u.status === 'ready') return `${u.version} ready to install`
    if (u.status === 'unsupported') return 'Updates work in the installed app'
    if (u.status === 'error') return 'Could not check for updates'
    return ''
  })

  const FOLDER_ROWS: { key: AppFolderKey; label: string; hint: string }[] = [
    { key: 'models', label: 'Models', hint: 'Downloaded models, with ZIPs unpacked' },
    { key: 'library', label: 'Library', hint: 'Models you saved to the library' },
    { key: 'exports', label: 'Exports', hint: 'Models you saved or sent to a slicer' },
    { key: 'downloads', label: 'Downloads', hint: 'Files downloaded from websites' },
  ]

  async function refreshFolders() {
    folders = await window.api.app.folders().catch(() => null)
  }
  onMount(() => {
    void refreshFolders()
    void loadGcodeFolder()
  })

  async function pickGcode() {
    await chooseGcodeFolder()
    await refreshFolders()
  }

  function close() {
    ui.settings = false
  }
  function managePrinters() {
    close()
    ws.layout = 'workspace'
    ws.sidebarTab = 'slice'
    sl.managePrinters = true
  }
  function goAbout() {
    close()
    ui.libraryTab = 'about'
    ws.layout = 'library'
  }
  /** Opens a site in a new tab of Boaty's browser. */
  function openSite(url: string) {
    close()
    window.api.tabs.create(url)
    ws.layout = 'browse'
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && close()} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="scrim" onclick={(e) => e.target === e.currentTarget && close()}>
  <div class="dlg neon-panel" role="dialog" aria-modal="true" aria-label="Settings">
    <header>
      <div class="title"><Icon name="settings" size={16} /><span>Settings</span></div>
      <button class="icon-btn" title="Close (Esc)" aria-label="Close settings" onclick={close}><Icon name="close" size={15} /></button>
    </header>

    <div class="body">
      <nav class="tabs" aria-label="Settings sections">
        {#each SECTIONS as s}
          <button class:on={section === s.id} aria-current={section === s.id} onclick={() => (section = s.id)}>{s.label}</button>
        {/each}
      </nav>

      <div class="pane">
        {#if section === 'appearance'}
          <h3 class="hud-label">Neon colour</h3>
          <div class="accent">
            <Logo size={34} glow={1.4} />
            <div class="name">{theme.accent.name}<span class="mono hex">{theme.accent.hex}</span></div>
          </div>
          <div class="swatches" role="radiogroup" aria-label="Neon colour">
            {#each ACCENTS as a}
              <button
                class="sw"
                class:on={theme.accent.id === a.id}
                role="radio"
                aria-checked={theme.accent.id === a.id}
                title={a.name}
                aria-label={a.name}
                style="--c: {a.hex}"
                onclick={() => applyAccent(a)}><span></span></button>
            {/each}
            <label class="sw custom" class:on={isCustom} title="Pick any colour" style="--c: {isCustom ? theme.accent.hex : '#888'}">
              <span></span>
              <input type="color" value={theme.accent.hex.toLowerCase()} aria-label="Custom neon colour" oninput={(e) => applyCustomAccent(e.currentTarget.value)} />
            </label>
          </div>
          <h3 class="hud-label">Help</h3>
          <div class="btns">
            <button class="ghost" onclick={() => (close(), startTour())}><Icon name="play" size={13} />Take the tour</button>
            <button class="ghost" onclick={() => (close(), (ui.shortcuts = true))}>Keyboard shortcuts</button>
          </div>
        {:else if section === 'slicing'}
          <h3 class="hud-label">Where G-code is saved</h3>
          <div class="row">
            <span class="path mono" title={sl.gcodeFolder ?? ''}>{sl.gcodeFolder ?? 'Asks each time (starts in Documents\\Boaty\\Exports)'}</span>
          </div>
          <div class="btns">
            <button class="ghost" onclick={pickGcode}><Icon name="usb" size={13} />{sl.gcodeFolder ? 'Change folder' : 'Choose a folder (e.g. USB stick)'}</button>
            {#if sl.gcodeFolder}<button class="ghost" onclick={() => window.api.app.openFolder('gcode')}><Icon name="folder" size={13} />Open</button>{/if}
          </div>
          <p class="hint">With a folder chosen, Save in the Slice panel writes straight there and never overwrites a file.</p>

          <h3 class="hud-label">Printers</h3>
          <div class="row">
            <span>{sl.printers.length ? `${sl.printers.length} printer${sl.printers.length === 1 ? '' : 's'} set up for sending` : 'No printers set up for sending yet'}</span>
            <button class="ghost" onclick={managePrinters}><Icon name="printer" size={13} />Manage printers</button>
          </div>

          <h3 class="hud-label">Prices for cost estimates</h3>
          <div class="sub">Filament printers</div>
          <PricesEditor kind="fdm" />
          <div class="sub">Resin printers</div>
          <PricesEditor kind="resin" />

          <h3 class="hud-label">Slicing engine</h3>
          <p class="hint">
            {#if engine?.source}
              OrcaSlicer {engine.version ?? ''} ({engine.source === 'birdy' ? 'installed by Boaty' : engine.source === 'installed' ? 'your OrcaSlicer install' : 'development copy'}), AGPL-3.0.
            {:else}
              Not installed yet. Open the Slice tab to download it (about 200 MB).
            {/if}
          </p>
        {:else if section === 'folders'}
          {#each FOLDER_ROWS as f}
            <div class="folder">
              <div>
                <div class="fl">{f.label}</div>
                <div class="hint">{f.hint}</div>
                <div class="path mono" title={folders?.[f.key] ?? ''}>{folders?.[f.key] ?? '…'}</div>
              </div>
              <button class="ghost" disabled={!folders?.[f.key]} onclick={() => window.api.app.openFolder(f.key)}><Icon name="folder" size={13} />Open</button>
            </div>
          {/each}
        {:else if section === 'updates'}
          <h3 class="hud-label">Version</h3>
          <div class="row">
            <span class="mono">Boaty {version}</span>
            <span class="hint">{updateLine}</span>
          </div>
          <div class="btns">
            <button
              class="ghost"
              disabled={updates.state?.status === 'checking' || updates.state?.status === 'downloading' || updates.state?.status === 'unsupported'}
              onclick={checkNow}><Icon name="reload" size={13} />Check for updates</button>
          </div>
          <p class="hint">Boaty checks for updates by itself shortly after it starts and every few hours, and asks before installing.</p>
        {:else}
          <div class="aboutapp">
            <Logo size={48} glow={1.6} />
            <div>
              <div class="appname">Boaty <span class="mono">{version}</span></div>
              <div class="hint">A browser that turns into a 3D-printing workspace. Free software under the GNU AGPL v3.0.</div>
            </div>
          </div>
          <div class="btns">
            <button class="ghost" onclick={goAbout}>Credits and licences</button>
            <button class="ghost" onclick={() => openSite('https://github.com/VincentFeliciano/Birdy')}><Icon name="external" size={13} />Source code</button>
          </div>
        {/if}
      </div>
    </div>

    <footer class="made">
      <button class="ybl" title="Yellow Brick" aria-label="Yellow Brick website" onclick={() => openSite(YB_URL)}><img src={ybLogo} alt="Yellow Brick" /></button>
      <p>
        <b>Boaty{version ? ` ${version}` : ''}</b><br />
        Made by <button class="link" onclick={() => openSite(YB_URL)}>Yellow Brick</button> · Vincent Feliciano. AI-assisted code.
      </p>
    </footer>
  </div>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    justify-content: center;
    align-items: center;
    background: rgba(0, 0, 0, 0.5);
  }
  .dlg {
    width: min(760px, calc(100vw - 40px));
    height: min(600px, calc(100vh - 60px));
    display: flex;
    flex-direction: column;
    padding: 14px 18px;
    gap: 10px;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    color: var(--accent);
    text-shadow: var(--glow-text);
  }
  .body {
    flex: 1;
    min-height: 0;
    display: flex;
    gap: 16px;
  }
  .tabs {
    flex: 0 0 160px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .tabs button {
    text-align: left;
    height: 32px;
    padding: 0 10px;
    border-radius: var(--r-md);
    border: 1px solid transparent;
    background: none;
    color: var(--muted);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  .tabs button:hover {
    color: var(--text);
    background: var(--surface);
  }
  .tabs button.on {
    color: var(--accent);
    border-color: var(--neon-line);
    background: rgba(var(--accent-rgb), 0.06);
  }
  .pane {
    flex: 1;
    min-width: 0;
    overflow: auto;
    padding-right: 4px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 13px;
  }
  .pane .hud-label {
    margin: 8px 0 0;
  }
  .pane .hud-label:first-child {
    margin-top: 0;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .btns {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .hint {
    margin: 0;
    font-size: 12px;
    color: var(--faint);
    line-height: 1.5;
  }
  .path {
    font-size: 11px;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .accent {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .name {
    font-weight: 600;
    color: var(--accent);
    text-shadow: 0 0 8px rgba(var(--accent-rgb), 0.5);
  }
  .hex {
    margin-left: 8px;
    font-weight: 400;
    font-size: 11px;
    color: var(--faint);
    text-shadow: none;
  }
  .swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .sw {
    position: relative;
    width: 28px;
    height: 28px;
    padding: 0;
    border-radius: 50%;
    border: 1px solid var(--border-strong);
    background: none;
    cursor: pointer;
    display: grid;
    place-items: center;
  }
  .sw span {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--c);
    box-shadow: 0 0 6px var(--c);
  }
  .sw.on {
    border-color: var(--c);
    box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.08), 0 0 10px var(--c);
  }
  .sw.custom span {
    background: conic-gradient(#f44, #fd0, #4f4, #4df, #44f, #f4f, #f44);
  }
  .sw.custom.on span {
    background: var(--c);
  }
  .sw input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
  }
  .sub {
    font-size: 12px;
    color: var(--muted);
    margin-bottom: -4px;
  }
  .folder {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 0;
    border-bottom: 1px solid var(--border);
  }
  .folder > div {
    min-width: 0;
  }
  .fl {
    color: var(--text);
    font-weight: 600;
  }
  .aboutapp {
    display: flex;
    align-items: center;
    gap: 16px;
  }
  .appname {
    font-size: 16px;
    font-weight: 600;
    color: var(--text);
  }
  .appname .mono {
    font-size: 12px;
    color: var(--faint);
  }
  .made {
    display: flex;
    align-items: center;
    gap: 12px;
    padding-top: 10px;
    border-top: 1px solid var(--border);
  }
  .made p {
    margin: 0;
    font-size: 12px;
    color: var(--muted);
    line-height: 1.55;
  }
  .made b {
    color: var(--text);
    font-weight: 600;
  }
  .link {
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    cursor: pointer;
  }
  .made .link {
    color: var(--text);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .ybl {
    flex: none;
    padding: 0;
    border: 0;
    background: none;
    line-height: 0;
    border-radius: 6px;
    cursor: pointer;
  }
  .ybl img {
    display: block;
    width: 34px;
    height: auto;
  }
</style>
