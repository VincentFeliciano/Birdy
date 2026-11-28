<script lang="ts">
  import Icon from '../../components/Icon.svelte'
  import { fmtBytes } from '../../app/format'
  import { addModelToPlate, browseFolder, deleteEntry, isElsewhere, openArchive, sliceModel, crumbs, importDownloads, isFav, models, openFolder, openModel, refresh, setFavsOnly, setModelsOpen, setQuery, showInFolder, shown, toggleFav, up } from './store.svelte'

  const api = window.api
  const path = $derived(crumbs())
  const list = $derived(shown())
  const filtering = $derived(!!models.query.trim() || models.favsOnly)
  const folderOf = (rel: string) => rel.split('/').slice(0, -1).join('/') || 'Models'
  type Place = { name: string; rel: string; kind: 'models' | 'folder' | 'drive' }
  let places = $state<Place[]>([{ name: 'Models', rel: '', kind: 'models' }])
  $effect(() => {
    void api.models.places().then((p) => (places = p)).catch(() => {})
  })
  // The place the current folder is in (the longest matching start), for the menu.
  const place = $derived.by(() => {
    const cwd = models.cwd.toLowerCase()
    let best = places[0]!
    for (const p of places)
      if (p.rel && (cwd === p.rel.toLowerCase() || cwd.startsWith(p.rel.toLowerCase() + '/')) && p.rel.length >= best.rel.length) best = p
    return isElsewhere() ? (best.rel ? best : null) : places[0]!
  })
  const elsewhere = $derived(isElsewhere())
  function choosePlace(v: string) {
    if (v === '__pick') void browseFolder()
    else openFolder(v)
  }
  function onDragStart(e: DragEvent, rel: string) {
    e.dataTransfer?.setData('application/x-birdy-model', rel)
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy'
  }
</script>

<div class="mp neon-panel" role="region" aria-label="Models folder">
  <div class="head">
    <Icon name="cube" size={15} />
    <select class="places" aria-label="Browse" title="Browse the Models folder or anywhere on this PC" value={place?.rel ?? '__here'} onchange={(e) => choosePlace(e.currentTarget.value)}>
      {#if !place}<option value="__here">{models.cwd.split('/').pop()}</option>{/if}
      {#each places as p (p.rel)}
        <option value={p.rel}>{p.name}</option>
      {/each}
      <option value="__pick">Choose a folder…</option>
    </select>
    <nav class="crumbs" aria-label="Folder">
      {#if !elsewhere}<button class="crumb" class:here={!models.cwd} onclick={() => openFolder('')}>Models</button>{/if}
      {#each path as c, i}
        {#if i > 0 || !elsewhere}<span class="sep">›</span>{/if}
        <button class="crumb" class:here={c.rel === models.cwd} onclick={() => openFolder(c.rel)}>{c.name}</button>
      {/each}
    </nav>
    {#if models.notice && !filtering}
      <span class="notice" title={models.notice}>{models.notice}</span>
    {/if}
    <div class="spacer"></div>
    <label class="search" class:on={!!models.query}>
      <Icon name="target" size={12} />
      <input
        type="search"
        placeholder="Search all models"
        aria-label="Search all models"
        value={models.query}
        oninput={(e) => setQuery(e.currentTarget.value)}
        onkeydown={(e) => e.key === 'Escape' && setQuery('')} />
    </label>
    <button
      class="icon-btn fav-filter"
      class:on={models.favsOnly}
      title={models.favsOnly ? 'Show all models' : `Show favourites (${models.favs.length})`}
      aria-label="Show favourites"
      aria-pressed={models.favsOnly}
      onclick={() => setFavsOnly(!models.favsOnly)}><Icon name="star" size={15} /></button>
    {#if models.cwd && !filtering}
      <button class="icon-btn" title="Up one folder" aria-label="Up one folder" onclick={up}><Icon name="back" size={15} /></button>
    {/if}
    <button class="ghost sm" title="Browse any folder on this PC" onclick={browseFolder}><Icon name="folder" size={13} />Folder…</button>
    <button class="ghost sm" title="Copy models and unpack ZIPs that are already in your Downloads folder" onclick={importDownloads}><Icon name="import" size={13} />Add from Downloads</button>
    <button class="icon-btn" title="Refresh" aria-label="Refresh" onclick={refresh}><Icon name="reload" size={15} /></button>
    <button class="icon-btn" title="Open this folder in File Explorer" aria-label="Open in File Explorer" onclick={() => api.models.reveal(models.cwd)}><Icon name="external" size={15} /></button>
    <button class="icon-btn" title="Hide" aria-label="Hide models" onclick={() => setModelsOpen(false)}><Icon name="close" size={15} /></button>
  </div>

  <div class="grid">
    {#if models.error}
      <p class="empty">{models.error}</p>
    {:else if filtering && !list.length && !models.loading}
      <p class="empty">
        {models.query.trim()
          ? `No model or folder named like “${models.query.trim()}”${models.favsOnly ? ' among your favourites' : ''}.`
          : 'No favourites yet. Hover a model or folder and press its star to keep it here.'}
      </p>
    {:else if !filtering && !models.entries.length && !models.loading}
      <div class="empty">
        <p>
          {elsewhere ? 'No folders, 3D models or ZIP files here.' : models.cwd ? 'No models in this folder.' : 'No models yet. STL, 3MF, OBJ, GLB and PLY files you download land here, and ZIP downloads are unpacked into folders of their own. You can also put your own files in this folder.'}
        </p>
        <button class="ghost" onclick={() => api.models.reveal(models.cwd)}><Icon name="folder" size={14} />Open in File Explorer</button>
      </div>
    {/if}
    {#each list as e (e.rel)}
      <div class="tile" class:hl={models.highlight === e.rel} class:busy={models.opening === e.rel}>
        <button
          class="main"
          draggable={e.kind === 'model'}
          ondragstart={(ev) => onDragStart(ev, e.rel)}
          title={e.kind === 'dir' ? `Open folder ${e.name}` : e.kind === 'archive' ? `Unpack ${e.name} into the Models folder` : `Open ${e.name} in the workspace (or drag it onto the 3D view to add it to the plate)`}
          onclick={() => (e.kind === 'dir' ? openFolder(e.rel) : e.kind === 'archive' ? openArchive(e.rel) : openModel(e.rel))}>
          <span class="thumb" class:dir={e.kind === 'dir'}>
            {#if e.kind === 'dir'}
              <Icon name="folder" size={34} />
              <span class="count mono">{e.models ?? 0}</span>
            {:else if e.kind === 'archive'}
              <Icon name="import" size={28} />
            {:else if models.thumbs[e.rel]}
              <img src={models.thumbs[e.rel]} alt="" draggable="false" />
            {:else}
              <Icon name="cube" size={28} />
            {/if}
            {#if models.opening === e.rel}<span class="spin"><span class="spinner"></span></span>{/if}
          </span>
          <span class="name">{e.name}</span>
          <span class="meta mono">{filtering ? folderOf(e.rel) : e.kind === 'dir' ? `${e.models ?? 0} model${e.models === 1 ? '' : 's'}` : fmtBytes(e.size)}</span>
        </button>
        <button
          class="fav icon-btn"
          class:on={isFav(e.rel)}
          title={isFav(e.rel) ? 'Remove from favourites' : 'Add to favourites'}
          aria-label={isFav(e.rel) ? `Remove ${e.name} from favourites` : `Add ${e.name} to favourites`}
          aria-pressed={isFav(e.rel)}
          onclick={() => toggleFav(e.rel)}><Icon name="star" size={12} /></button>
        {#if filtering}
          <button class="where icon-btn" title="Show in its folder" aria-label="Show {e.name} in its folder" onclick={() => showInFolder(e.rel)}>
            <Icon name="folder" size={12} />
          </button>
        {/if}
        {#if e.kind === 'model'}
          <span class="acts">
            <button class="act" title="Open {e.name} and go to the slicer" onclick={() => sliceModel(e.rel)}><Icon name="layers" size={11} />Slice</button>
            <button class="act" title="Add {e.name} to the plate of the open model" onclick={() => addModelToPlate(e.rel)}><Icon name="plus" size={11} />Plate</button>
          </span>
        {/if}
        <button class="reveal icon-btn" title="Show in File Explorer" aria-label="Show {e.name} in File Explorer" onclick={() => api.models.reveal(e.rel)}>
          <Icon name="external" size={12} />
        </button>
        {#if !(e.kind === 'dir' && elsewhere)}
          <button class="del icon-btn" title="Delete (moves it to the Recycle Bin)" aria-label="Delete {e.name}" onclick={() => deleteEntry(e)}>
            <Icon name="trash" size={12} />
          </button>
        {/if}
      </div>
    {/each}
  </div>
</div>

<style>
  .mp {
    flex: none;
    display: flex;
    flex-direction: column;
    height: 232px;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 6px 4px 12px;
    color: var(--accent);
  }
  .crumbs {
    display: flex;
    align-items: center;
    /* Long paths keep their end (the folder you're in) in view. */
    justify-content: flex-end;
    flex-shrink: 1;
    gap: 2px;
    min-width: 0;
    overflow: hidden;
  }
  .head :global(.ghost.sm) {
    white-space: nowrap;
    flex: none;
  }
  .crumb {
    padding: 2px 6px;
    border: 0;
    border-radius: var(--r-sm, 4px);
    background: none;
    color: var(--muted);
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
  }
  .crumb:hover {
    color: var(--accent);
  }
  .crumb.here {
    color: var(--text);
  }
  .sep {
    color: var(--faint);
  }
  .notice {
    margin-left: 10px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    color: var(--ok);
  }
  .spacer {
    flex: 1;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 5px;
    height: 26px;
    padding: 0 8px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--faint);
  }
  .search.on,
  .search:focus-within {
    border-color: var(--neon-line);
    color: var(--accent);
  }
  .search input {
    width: 150px;
    border: 0;
    background: none;
    color: var(--text);
    font: inherit;
    font-size: 12px;
    outline: none;
  }
  .fav-filter.on {
    color: var(--accent);
    box-shadow: var(--glow-sm);
  }
  .fav,
  .where {
    position: absolute;
    top: 4px;
    opacity: 0;
    transition: opacity 0.12s;
  }
  .fav {
    left: 4px;
  }
  .where {
    left: 30px;
  }
  .tile:hover .fav,
  .tile:hover .where,
  .fav.on,
  .fav:focus-visible,
  .where:focus-visible {
    opacity: 1;
  }
  .fav.on {
    color: var(--accent);
  }
  .fav.on :global(svg) {
    fill: currentColor;
  }
  .ghost.sm {
    height: 26px;
    padding: 0 8px;
    font-size: 12px;
    margin-right: 4px;
  }
  .grid {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-wrap: wrap;
    align-content: flex-start;
    gap: 8px;
    padding: 4px 10px 10px;
  }
  .empty {
    display: flex;
    align-items: center;
    gap: 14px;
    margin: 8px 4px;
    color: var(--muted);
    font-size: 13px;
  }
  .empty p {
    margin: 0;
    max-width: 640px;
  }
  .tile {
    position: relative;
    width: 124px;
  }
  .main {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 3px;
    width: 100%;
    padding: 6px;
    border-radius: var(--r-md);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    text-align: left;
    font: inherit;
    cursor: pointer;
    transition: border-color 0.12s, box-shadow 0.12s;
  }
  .main:hover {
    border-color: var(--neon-line);
    box-shadow: var(--glow-sm);
  }
  .tile.hl .main {
    border-color: var(--accent);
    box-shadow: var(--glow-sm), inset 0 0 12px rgba(var(--accent-rgb), 0.12);
  }
  .thumb {
    position: relative;
    display: grid;
    place-items: center;
    height: 86px;
    border-radius: 6px;
    background: radial-gradient(circle at 50% 40%, #1b1e24, var(--bg) 75%);
    color: var(--faint);
    overflow: hidden;
  }
  .thumb.dir {
    color: var(--accent);
    filter: drop-shadow(0 0 4px rgba(var(--accent-rgb), 0.45));
  }
  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  .count {
    position: absolute;
    right: 6px;
    bottom: 4px;
    font-size: 11px;
    color: var(--muted);
    filter: none;
  }
  .spin {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: rgba(0, 0, 0, 0.45);
  }
  .name {
    font-size: 12px;
    font-weight: 600;
    line-height: 1.3;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    word-break: break-word;
  }
  .meta {
    font-size: 10px;
    color: var(--muted);
  }
  .reveal {
    position: absolute;
    top: 9px;
    right: 9px;
    width: 22px;
    height: 22px;
    opacity: 0;
    background: rgba(11, 12, 15, 0.8);
  }
  .places {
    height: 24px;
    max-width: 130px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    padding: 0 4px;
  }
  .acts {
    position: absolute;
    left: 6px;
    right: 6px;
    top: 66px;
    display: flex;
    gap: 4px;
    opacity: 0;
    transition: opacity 0.12s;
  }
  .act {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 3px;
    height: 20px;
    border-radius: 5px;
    border: 1px solid var(--neon-line);
    background: rgba(0, 0, 0, 0.75);
    color: var(--accent);
    font: inherit;
    font-size: 10px;
    cursor: pointer;
  }
  .act:hover {
    background: rgba(var(--accent-rgb), 0.18);
  }
  .tile:hover .acts,
  .acts:focus-within {
    opacity: 1;
  }
  .del {
    position: absolute;
    top: 9px;
    right: 35px;
    width: 22px;
    height: 22px;
    opacity: 0;
    background: rgba(11, 12, 15, 0.8);
  }
  .del:hover {
    color: #ff5a6a;
  }
  .tile:hover .del,
  .del:focus-visible,
  .tile:hover .reveal,
  .reveal:focus-visible {
    opacity: 1;
  }
</style>
