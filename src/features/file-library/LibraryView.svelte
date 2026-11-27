<script lang="ts">
  import Icon from '../../components/Icon.svelte'
  import Logo from '../../components/Logo.svelte'
  import { library } from '../../stores/library.svelte'
  import { openFromLibrary, ws } from '../workspace/store.svelte'
  import { fmtBytes } from '../../app/format'
  import type { CheckVerdict } from '../../types/ipc'

  const api = window.api
  type Tab = 'models' | 'bookmarks' | 'about'
  let tab = $state<Tab>('models')
  let group = $state<string | null>(null) // null = all groups
  let query = $state('')
  let newGroup = $state('')
  let renaming = $state<string | null>(null)
  let renameText = $state('')

  const q = $derived(query.trim().toLowerCase())
  const models = $derived(
    library.models.filter((m) => (group === null || m.group === group) && (!q || m.name.toLowerCase().includes(q))),
  )
  const bookmarks = $derived(
    library.bookmarks.filter(
      (b) => (group === null || b.group === group) && (!q || b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q)),
    ),
  )
  const count = (g: string) => library.models.filter((m) => m.group === g).length + library.bookmarks.filter((b) => b.group === g).length

  const verdictLabel: Record<CheckVerdict, string> = { ready: 'Ready', attention: 'Check', fail: "Won't print" }

  function addGroup(e: SubmitEvent) {
    e.preventDefault()
    if (newGroup.trim()) api.library.createGroup(newGroup.trim())
    newGroup = ''
  }

  function commitRename() {
    if (renaming && renameText.trim() && renameText.trim() !== renaming) {
      api.library.renameGroup(renaming, renameText.trim())
      if (group === renaming) group = renameText.trim()
    }
    renaming = null
  }

  function host(url: string) {
    try {
      return new URL(url).hostname.replace(/^www\./, '')
    } catch {
      return url
    }
  }

  function openBookmark(url: string) {
    api.tabs.create(url)
    ws.layout = 'browse'
  }

  const credits = [
    {
      name: 'OrcaSlicer',
      license: 'AGPL-3.0',
      url: 'https://github.com/OrcaSlicer/OrcaSlicer',
      note: 'Its engine (version 2.5.2, unmodified) does the slicing in the Slice tab. Birdy also hands models to an installed OrcaSlicer with one click.',
    },
    {
      name: 'PrusaSlicer',
      license: 'AGPL-3.0',
      url: 'https://github.com/prusa3d/PrusaSlicer',
      note: 'The slicing engine (libslic3r) that OrcaSlicer and Bambu Studio build on.',
    },
    {
      name: 'UltiMaker Cura',
      license: 'LGPL-3.0 (CuraEngine: AGPL-3.0)',
      url: 'https://github.com/Ultimaker/Cura',
      note: 'Open-source slicer, supported for one-click handoff.',
    },
    { name: 'Three.js', license: 'MIT', url: 'https://github.com/mrdoob/three.js', note: '3D viewport, loaders and exporters.' },
    { name: 'Electron', license: 'MIT', url: 'https://github.com/electron/electron', note: 'Desktop shell and Chromium browser engine.' },
    { name: 'Svelte', license: 'MIT', url: 'https://github.com/sveltejs/svelte', note: 'User interface framework.' },
  ]
</script>

<div class="lib neon-panel">
  <aside class="groups">
    <h2 class="hud-label">Library</h2>
    <button class="g" class:on={group === null} onclick={() => (group = null)}>
      <Icon name="library" size={15} /><span>All</span><span class="n mono">{library.models.length + library.bookmarks.length}</span>
    </button>
    {#each library.groups as g (g)}
      {#if renaming === g}
        <form
          class="g editing"
          onsubmit={(e) => {
            e.preventDefault()
            commitRename()
          }}>
          <!-- svelte-ignore a11y_autofocus -->
          <input bind:value={renameText} autofocus onblur={commitRename} aria-label="Group name" />
        </form>
      {:else}
        <div class="g-row">
          <button class="g" class:on={group === g} onclick={() => (group = g)}>
            <Icon name="folder" size={15} /><span>{g}</span><span class="n mono">{count(g)}</span>
          </button>
          {#if g !== 'Unsorted'}
            <div class="g-acts">
              <button
                class="mini"
                title="Rename group"
                aria-label="Rename group {g}"
                onclick={() => {
                  renaming = g
                  renameText = g
                }}><Icon name="pencil" size={12} /></button>
              <button
                class="mini"
                title="Delete group (items move to Unsorted)"
                aria-label="Delete group {g}"
                onclick={() => {
                  api.library.deleteGroup(g)
                  if (group === g) group = null
                }}><Icon name="trash" size={12} /></button>
            </div>
          {/if}
        </div>
      {/if}
    {/each}
    <form class="new" onsubmit={addGroup}>
      <Icon name="folderplus" size={15} />
      <input bind:value={newGroup} placeholder="New group" aria-label="New group name" maxlength="60" />
    </form>
  </aside>

  <section class="content">
    <header>
      <div class="seg" role="tablist">
        <button role="tab" aria-selected={tab === 'models'} class:on={tab === 'models'} onclick={() => (tab = 'models')}>
          Models <span class="mono">{library.models.length}</span>
        </button>
        <button role="tab" aria-selected={tab === 'bookmarks'} class:on={tab === 'bookmarks'} onclick={() => (tab = 'bookmarks')}>
          Bookmarks <span class="mono">{library.bookmarks.length}</span>
        </button>
        <button role="tab" aria-selected={tab === 'about'} class:on={tab === 'about'} onclick={() => (tab = 'about')}>About &amp; credits</button>
      </div>
      {#if tab !== 'about'}
        <input class="search" bind:value={query} placeholder="Filter by name" aria-label="Filter library" />
      {/if}
    </header>

    <div class="scroll">
      {#if tab === 'models'}
        {#if models.length === 0}
          <div class="empty">
            <Icon name="cube" size={28} stroke={1.4} />
            <p>No saved models{group ? ` in ${group}` : ''} yet. Open a model, then use <b>Save to library</b> in the workspace sidebar.</p>
          </div>
        {:else}
          <div class="grid">
            {#each models as m (m.id)}
              <article class="card">
                <button class="thumb" onclick={() => openFromLibrary(m.id)} title="Open in workspace">
                  {#if m.thumbnail}<img src={m.thumbnail} alt="" />{:else}<Icon name="cube" size={34} stroke={1.3} />{/if}
                  {#if m.check}<span class="verdict {m.check.verdict} mono">{verdictLabel[m.check.verdict]}</span>{/if}
                </button>
                <div class="meta">
                  <div class="name" title={m.name}>{m.name}</div>
                  <div class="sub mono">{m.format.toUpperCase()} · {fmtBytes(m.size)}</div>
                </div>
                <div class="row">
                  <select value={m.group} onchange={(e) => api.library.move('model', m.id, e.currentTarget.value)} aria-label="Group">
                    {#each library.groups as g}<option value={g}>{g}</option>{/each}
                  </select>
                  <button class="icon-btn" title="Show in folder" aria-label="Show in folder" onclick={() => api.library.showModel(m.id)}><Icon name="folder" size={14} /></button>
                  <button class="icon-btn" title="Remove from library (file stays on disk)" aria-label="Remove from library" onclick={() => api.library.removeModel(m.id)}><Icon name="trash" size={14} /></button>
                </div>
              </article>
            {/each}
          </div>
        {/if}
      {:else if tab === 'bookmarks'}
        {#if bookmarks.length === 0}
          <div class="empty">
            <Icon name="star" size={28} stroke={1.4} />
            <p>No bookmarks{group ? ` in ${group}` : ''} yet. Click the star in the address bar to save a page.</p>
          </div>
        {:else}
          <div class="list">
            {#each bookmarks as b (b.id)}
              <div class="bm">
                <button class="bm-main" onclick={() => openBookmark(b.url)} title={b.url}>
                  {#if b.favicon}<img src={b.favicon} alt="" width="16" height="16" />{:else}<Icon name="globe" size={16} />{/if}
                  <span class="name">{b.title}</span>
                  <span class="host mono">{host(b.url)}</span>
                </button>
                <select value={b.group} onchange={(e) => api.library.move('bookmark', b.id, e.currentTarget.value)} aria-label="Group">
                  {#each library.groups as g}<option value={g}>{g}</option>{/each}
                </select>
                <button class="icon-btn" title="Delete bookmark" aria-label="Delete bookmark" onclick={() => api.library.removeBookmark(b.id)}><Icon name="trash" size={14} /></button>
              </div>
            {/each}
          </div>
        {/if}
      {:else}
        <div class="about">
          <div class="about-logo"><Logo size={72} glow={2} /></div>
          <h3>Birdy</h3>
          <p>A browser that turns into a 3D-printing workspace. Find a model, check it, fix it, slice it, and send it to your printer without switching apps.</p>
          <p class="dim">
            Free software under the GNU AGPL v3.0.
            <button class="link" onclick={() => openBookmark('https://github.com/VincentFeliciano/Birdy')}>Source code</button>
          </p>
          <h3 class="hud-label">Credits</h3>
          <p class="dim">Slicing is powered by the OrcaSlicer engine, run as a separate, unmodified program. Birdy is not affiliated with the OrcaSlicer project. It also works alongside these open-source projects.</p>
          <ul>
            {#each credits as c}
              <li>
                <button class="credit" onclick={() => openBookmark(c.url)}>
                  <span class="cname">{c.name}</span>
                  <span class="lic mono">{c.license}</span>
                  <Icon name="external" size={12} />
                </button>
                <span class="note">{c.note}</span>
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    </div>
  </section>
</div>

<style>
  .lib {
    flex: 1;
    min-width: 0;
    display: flex;
    overflow: hidden;
  }
  .groups {
    width: 220px;
    flex: none;
    padding: 14px 10px;
    border-right: 1px solid var(--neon-soft);
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow-y: auto;
  }
  .groups h2 {
    margin: 0 6px 10px;
  }
  .g-row {
    position: relative;
  }
  .g {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 32px;
    padding: 0 8px;
    border-radius: var(--r-md);
    color: var(--muted);
    border: 1px solid transparent;
    text-align: left;
  }
  .g span:not(.n) {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .g:hover {
    background: var(--surface);
    color: var(--text);
  }
  .g.on {
    color: var(--accent);
    background: rgba(var(--accent-rgb), 0.08);
    border-color: var(--neon-line);
    box-shadow: var(--glow-sm);
  }
  .n {
    font-size: 11px;
    color: var(--faint);
  }
  .g-acts {
    position: absolute;
    right: 4px;
    top: 4px;
    display: none;
    gap: 2px;
    background: var(--panel);
  }
  .g-row:hover .g-acts {
    display: flex;
  }
  .g-row:hover .n {
    visibility: hidden;
  }
  .mini {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 6px;
    color: var(--muted);
  }
  .mini:hover {
    background: var(--elevated);
    color: var(--text);
  }
  .editing input,
  .new input {
    flex: 1;
    min-width: 0;
    height: 28px;
    background: var(--surface);
    border: 1px solid var(--neon-line);
    border-radius: 6px;
    padding: 0 8px;
    outline: none;
    user-select: text;
  }
  .new {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 8px 0;
    color: var(--faint);
  }
  .new input {
    border-color: var(--border);
  }
  .new input:focus {
    border-color: var(--neon-line);
    box-shadow: var(--glow-sm);
  }
  .content {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
  }
  .seg {
    display: flex;
    gap: 2px;
    padding: 3px;
    border-radius: var(--r-md);
    background: var(--bg);
    border: 1px solid var(--border);
  }
  .seg button {
    height: 28px;
    padding: 0 12px;
    border-radius: 6px;
    color: var(--muted);
    font-weight: 600;
    border: 1px solid transparent;
  }
  .seg button span {
    font-size: 11px;
    color: var(--faint);
    margin-left: 4px;
  }
  .seg button.on {
    color: var(--accent);
    background: rgba(var(--accent-rgb), 0.1);
    border-color: var(--neon-line);
    box-shadow: var(--glow-sm);
  }
  .search {
    margin-left: auto;
    width: 240px;
    height: 30px;
    padding: 0 10px;
    border-radius: var(--r-md);
    background: var(--surface);
    border: 1px solid var(--border);
    outline: none;
    user-select: text;
  }
  .search:focus {
    border-color: var(--neon-line);
    box-shadow: var(--glow-sm);
  }
  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 4px 12px 16px;
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 80px 20px;
    color: var(--faint);
    text-align: center;
  }
  .empty p {
    max-width: 360px;
    margin: 0;
    color: var(--muted);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 10px;
  }
  .card {
    display: flex;
    flex-direction: column;
    border-radius: var(--r-lg);
    background: var(--surface);
    border: 1px solid var(--border);
    overflow: hidden;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .card:hover {
    border-color: var(--neon-line);
    box-shadow: var(--glow-sm);
  }
  .thumb {
    position: relative;
    aspect-ratio: 4 / 3;
    display: grid;
    place-items: center;
    background: #0d0f13;
    color: var(--faint);
  }
  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .verdict {
    position: absolute;
    top: 8px;
    left: 8px;
    padding: 2px 7px;
    border-radius: 10px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    background: rgba(11, 12, 15, 0.85);
  }
  .verdict.ready {
    color: var(--ok);
    box-shadow: 0 0 0 1px rgba(62, 224, 143, 0.6), 0 0 10px rgba(62, 224, 143, 0.35);
  }
  .verdict.attention {
    color: var(--accent);
    box-shadow: 0 0 0 1px var(--neon-line), var(--glow-sm);
  }
  .verdict.fail {
    color: var(--danger);
    box-shadow: 0 0 0 1px rgba(255, 77, 94, 0.6), 0 0 10px rgba(255, 77, 94, 0.35);
  }
  .meta {
    padding: 8px 10px 0;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sub {
    font-size: 11px;
    color: var(--faint);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 6px 6px 8px 10px;
  }
  select {
    flex: 1;
    min-width: 0;
    height: 26px;
    padding: 0 6px;
    border-radius: 6px;
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--muted);
    outline: none;
    font-size: 12px;
  }
  select option {
    background: var(--panel);
    color: var(--text);
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .bm {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px 4px 4px;
    border-radius: var(--r-md);
    border: 1px solid transparent;
  }
  .bm:hover {
    background: var(--surface);
    border-color: var(--border);
  }
  .bm-main {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    height: 32px;
    padding: 0 8px;
    text-align: left;
    color: var(--muted);
  }
  .bm-main .name {
    color: var(--text);
    flex: 0 1 auto;
  }
  .bm-main:hover .name {
    color: var(--accent);
  }
  .host {
    font-size: 11px;
    color: var(--faint);
    white-space: nowrap;
  }
  .bm select {
    flex: 0 0 150px;
  }
  .about {
    max-width: 640px;
    padding: 8px 4px;
  }
  .about-logo {
    padding: 8px 0 4px 6px;
  }
  .about h3 {
    margin: 18px 0 6px;
  }
  .about h3:first-child,
  .about-logo + h3 {
    margin-top: 4px;
    font-size: 18px;
    color: var(--accent);
    text-shadow: var(--glow-text);
  }
  .about p {
    margin: 0 0 10px;
    color: var(--muted);
  }
  .dim {
    font-size: 12px;
  }
  .about .link {
    padding: 0;
    margin-left: 4px;
    border: 0;
    background: none;
    color: var(--accent);
    font: inherit;
    cursor: pointer;
  }
  .about .link:hover {
    text-decoration: underline;
  }
  .about ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .about li {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px 12px;
    border-radius: var(--r-md);
    background: var(--surface);
    border: 1px solid var(--border);
  }
  .credit {
    display: flex;
    align-items: center;
    gap: 8px;
    text-align: left;
  }
  .cname {
    font-weight: 600;
  }
  .credit:hover .cname {
    color: var(--accent);
  }
  .lic {
    font-size: 10.5px;
    color: var(--accent);
    padding: 1px 6px;
    border-radius: 8px;
    border: 1px solid var(--neon-soft);
  }
  .note {
    font-size: 12px;
    color: var(--muted);
  }
</style>
