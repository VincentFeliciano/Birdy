<script lang="ts">
  import { onMount } from 'svelte'
  import Icon from '../../components/Icon.svelte'
  import { library } from '../../stores/library.svelte'
  import type { SlicersState } from '../../types/ipc'
  import NumField from '../../components/NumField.svelte'
  import { fmtBytes, fmtInt, fmtNum, mmToIn } from '../../app/format'
  import {
    activeModel,
    BED,
    centerOnBed,
    checkNow,
    saveToLibrary,
    sendToSlicer,
    dropToBed,
    mirror,
    reopenSaved,
    resetTransform,
    saveAs,
    setDimension,
    setXForm,
    ws,
  } from '../workspace/store.svelte'

  let uniform = $state(true)
  const model = $derived(activeModel())
  const s = $derived(ws.stats)
  const xf = $derived(ws.xf)
  const axes = ['x', 'y', 'z'] as const
  const report = $derived(ws.report)
  let libGroup = $state('Unsorted')
  let slicers = $state<SlicersState>({ slicers: [], defaultId: null })
  let slicerId = $state<string | null>(null)

  onMount(async () => {
    slicers = await window.api.slicer.list()
    slicerId = slicers.defaultId
  })

  async function chooseSlicer() {
    slicers = await window.api.slicer.choose()
    slicerId = slicers.defaultId
  }

  const verdictText = { ready: 'Ready to print', attention: 'Needs attention', fail: "Won't print as-is" } as const
</script>

{#if model}
  <aside class="sidebar">
    <div class="seg" role="tablist">
      <button role="tab" aria-selected={ws.sidebarTab === 'model'} class:on={ws.sidebarTab === 'model'} onclick={() => (ws.sidebarTab = 'model')}>Model</button>
      <button role="tab" aria-selected={ws.sidebarTab === 'transform'} class:on={ws.sidebarTab === 'transform'} onclick={() => (ws.sidebarTab = 'transform')}>Transform</button>
    </div>

    <div class="scroll">
      {#if ws.sidebarTab === 'model'}
        <section>
          <h3 class="hud-label row-head">
            Print check
            <button class="icon-btn lockbtn" title="Run the check again" aria-label="Run print check again" onclick={checkNow}><Icon name="reload" size={13} /></button>
          </h3>
          {#if ws.checking && !report}
            <div class="verdict checking"><span class="spinner"></span>Checking mesh…</div>
          {:else if report}
            <div class="verdict {report.verdict}">
              <Icon name={report.verdict === 'ready' ? 'shield' : 'alert'} size={16} />
              <span>{verdictText[report.verdict]}</span>
              {#if ws.checking}<span class="spinner"></span>{/if}
            </div>
            {#if report.issues.length === 0}
              <p class="hint">Watertight, fits the {BED.x} × {BED.y} × {BED.z} mm plate, sits flat, no problem overhangs.</p>
            {:else}
              <ul class="issues">
                {#each report.issues as i}
                  <li class={i.level}>
                    <span class="lvl"></span>
                    <div>
                      <div class="it">{i.title}</div>
                      <div class="id">{i.detail}</div>
                    </div>
                  </li>
                {/each}
              </ul>
            {/if}
            <dl class="checkstats">
              <dt>Watertight</dt>
              <dd class="mono" class:bad={!report.stats.watertight}>{report.stats.watertight ? 'Yes' : 'No'}</dd>
              <dt>Volume</dt>
              <dd class="mono">{report.stats.volumeCm3 !== null ? `${fmtNum(report.stats.volumeCm3)} cm³` : '—'}</dd>
              <dt>Parts</dt>
              <dd class="mono">{report.stats.components}</dd>
              <dt>Overhang</dt>
              <dd class="mono">{fmtNum(report.stats.overhangPct, 0)}%</dd>
            </dl>
          {/if}
        </section>

        <section>
          <h3 class="hud-label">File</h3>
          <dl>
            <dt>Name</dt>
            <dd class="name" title={model.name}>{model.name}</dd>
            <dt>Format</dt>
            <dd class="mono">{model.format.toUpperCase()}</dd>
            <dt>Size</dt>
            <dd class="mono">{fmtBytes(model.size)}</dd>
            <dt>Units</dt>
            <dd class="mono">mm <span class="dim">(assumed)</span></dd>
            {#if model.sourceUrl}
              <dt>Source</dt>
              <dd>
                <button class="link" title={model.sourceUrl} onclick={() => window.api.tabs.create(model.sourceUrl)}>
                  {new URL(model.sourceUrl).hostname}
                  <Icon name="external" size={12} />
                </button>
              </dd>
            {/if}
            <dt>Status</dt>
            <dd>
              {#if model.modified}<span class="pill warn">Modified</span>{:else}<span class="pill">Unchanged</span>{/if}
            </dd>
          </dl>
        </section>

        {#if s}
          <section>
            <h3 class="hud-label">Dimensions</h3>
            <div class="dims">
              {#each axes as a}
                <div class="dim-box" data-axis={a}>
                  <span class="mono k">{a.toUpperCase()}</span>
                  <span class="mono v">{fmtNum(s.size[a])}</span>
                  <span class="mono u">{fmtNum(mmToIn(s.size[a]), 3)} in</span>
                </div>
              {/each}
            </div>
            <dl>
              <dt>Triangles</dt>
              <dd class="mono">{fmtInt(s.triangles)}</dd>
              <dt>Objects</dt>
              <dd class="mono">{s.meshes}</dd>
              <dt>Lowest Z</dt>
              <dd class="mono" class:bad={Math.abs(s.min.z) > 0.01}>{fmtNum(s.min.z)} mm</dd>
            </dl>
            {#if s.min.z < -0.01}
              <p class="hint">Part of the model is below the plate. Use <b>Drop to plate</b> under Transform.</p>
            {/if}
          </section>
        {/if}
        <section>
          <h3 class="hud-label">Library</h3>
          {#if model.libraryId}
            <p class="hint ok"><Icon name="check" size={13} /> Saved in your library.</p>
          {/if}
          <div class="librow">
            <select bind:value={libGroup} aria-label="Library group">
              {#each library.groups as g}<option value={g}>{g}</option>{/each}
            </select>
            <button class="ghost" onclick={() => saveToLibrary(libGroup)}><Icon name="star" size={14} />Save to library</button>
          </div>
          <p class="hint small">Saves the original file, a thumbnail and its print check.</p>
        </section>
      {:else if xf && s}
        <section>
          <h3 class="hud-label">Position <span class="dim">mm</span></h3>
          <div class="row3">
            <NumField axis="x" label="Position" value={xf.px} onCommit={(v) => setXForm('px', v)} />
            <NumField axis="y" label="Position" value={xf.py} onCommit={(v) => setXForm('py', v)} />
            <NumField axis="z" label="Position" value={xf.pz} onCommit={(v) => setXForm('pz', v)} />
          </div>
        </section>
        <section>
          <h3 class="hud-label">Rotation <span class="dim">deg</span></h3>
          <div class="row3">
            <NumField axis="x" label="Rotation" digits={1} step={15} value={xf.rx} onCommit={(v) => setXForm('rx', v)} />
            <NumField axis="y" label="Rotation" digits={1} step={15} value={xf.ry} onCommit={(v) => setXForm('ry', v)} />
            <NumField axis="z" label="Rotation" digits={1} step={15} value={xf.rz} onCommit={(v) => setXForm('rz', v)} />
          </div>
        </section>
        <section>
          <h3 class="hud-label row-head">
            Scale <span class="dim">%</span>
            <button
              class="icon-btn lockbtn"
              class:on={uniform}
              title={uniform ? 'Uniform scaling on' : 'Uniform scaling off'}
              aria-label="Toggle uniform scaling"
              onclick={() => (uniform = !uniform)}>
              <Icon name={uniform ? 'lock' : 'unlock'} size={13} />
            </button>
          </h3>
          <div class="row3">
            <NumField axis="x" label="Scale" digits={1} step={5} value={xf.sx} onCommit={(v) => setXForm('sx', v, uniform)} />
            <NumField axis="y" label="Scale" digits={1} step={5} value={xf.sy} onCommit={(v) => setXForm('sy', v, uniform)} />
            <NumField axis="z" label="Scale" digits={1} step={5} value={xf.sz} onCommit={(v) => setXForm('sz', v, uniform)} />
          </div>
          <h3 class="hud-label sub">Size <span class="dim">mm</span></h3>
          <div class="row3">
            {#each axes as a}
              <NumField axis={a} label="Size" value={s.size[a]} onCommit={(v) => setDimension(a, v, uniform)} />
            {/each}
          </div>
        </section>
        <section>
          <h3 class="hud-label">Tools</h3>
          <div class="tools">
            <button class="ghost" onclick={() => mirror('x')}><Icon name="mirror" size={14} />Mirror X</button>
            <button class="ghost" onclick={() => mirror('y')}><Icon name="mirror" size={14} />Mirror Y</button>
            <button class="ghost" onclick={() => mirror('z')}><Icon name="mirror" size={14} />Mirror Z</button>
            <button class="ghost" onclick={dropToBed}><Icon name="floor" size={14} />Drop to plate</button>
            <button class="ghost" onclick={centerOnBed}><Icon name="center" size={14} />Center</button>
            <button class="ghost" onclick={resetTransform}><Icon name="reset" size={14} />Reset</button>
          </div>
        </section>
      {/if}
    </div>

    <footer class="export">
      <div class="fmt" role="radiogroup" aria-label="Export format">
        {#each ['stl', 'obj'] as const as f}
          <button role="radio" aria-checked={ws.exportFormat === f} class="mono" class:on={ws.exportFormat === f} onclick={() => (ws.exportFormat = f)}>
            {f.toUpperCase()}
          </button>
        {/each}
      </div>
      <button class="primary wide" disabled={ws.saving} onclick={saveAs}>
        {#if ws.saving}<span class="spinner"></span>{:else}<Icon name="save" size={15} />{/if}
        Save as…
      </button>
      <p class="note">The original file is never modified.</p>
      <div class="slicer">
        {#if slicers.slicers.length}
          <select bind:value={slicerId} onchange={() => slicerId && window.api.slicer.setDefault(slicerId)} aria-label="Slicer">
            {#each slicers.slicers as sl}<option value={sl.id}>{sl.name}</option>{/each}
          </select>
          <button class="ghost" title="Export the model as shown and open it in this slicer" onclick={() => sendToSlicer(slicerId ?? undefined)}>
            <Icon name="external" size={14} />Open in slicer
          </button>
        {:else}
          <button class="ghost wide" onclick={chooseSlicer} title="OrcaSlicer, Bambu Studio, PrusaSlicer and Cura are found automatically">
            <Icon name="external" size={14} />Choose slicer…
          </button>
        {/if}
      </div>
      {#if model.savedPath}
        <button class="ghost wide" onclick={() => reopenSaved(model.savedPath!)}>
          <Icon name="open" size={14} />Reopen saved copy
        </button>
      {/if}
    </footer>
  </aside>
{/if}

<style>
  .sidebar {
    width: 272px;
    flex: none;
    display: flex;
    flex-direction: column;
    border-left: 1px solid var(--neon-soft);
    background: linear-gradient(180deg, rgba(var(--accent-rgb), 0.03), transparent 200px);
    min-height: 0;
  }
  .seg {
    display: flex;
    gap: 2px;
    margin: 10px 10px 4px;
    padding: 3px;
    border-radius: var(--r-md);
    background: var(--bg);
    border: 1px solid var(--border);
  }
  .seg button {
    flex: 1;
    height: 26px;
    border-radius: 6px;
    color: var(--muted);
    font-weight: 600;
    border: 1px solid transparent;
  }
  .seg button.on {
    background: rgba(var(--accent-rgb), 0.1);
    color: var(--accent);
    border-color: var(--neon-line);
    box-shadow: var(--glow-sm);
    text-shadow: 0 0 8px rgba(var(--accent-rgb), 0.6);
  }
  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0 12px;
  }
  section {
    padding: 12px 0;
    border-bottom: 1px solid var(--border);
  }
  section:last-child {
    border-bottom: 0;
  }
  h3 {
    margin: 0 0 8px;
  }
  h3.sub {
    margin-top: 12px;
  }
  .row-head {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .lockbtn {
    margin-left: auto;
    width: 24px;
    height: 24px;
  }
  .dim {
    color: var(--faint);
    font-weight: 400;
    letter-spacing: 0.05em;
  }
  dl {
    display: grid;
    grid-template-columns: 80px 1fr;
    gap: 7px 8px;
    margin: 0;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
    min-width: 0;
    text-align: right;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    user-select: text;
  }
  .bad {
    color: var(--danger);
  }
  .link {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--accent);
    max-width: 100%;
  }
  .link:hover {
    text-shadow: var(--glow-text);
  }
  .pill {
    display: inline-block;
    padding: 1px 8px;
    border-radius: 10px;
    font-size: 11px;
    background: var(--surface);
    color: var(--muted);
  }
  .pill.warn {
    color: var(--accent);
    background: rgba(var(--accent-rgb), 0.12);
    box-shadow: 0 0 0 1px var(--neon-line), var(--glow-sm);
  }
  .dims {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
    margin-bottom: 12px;
  }
  .dim-box {
    display: flex;
    flex-direction: column;
    padding: 7px 8px;
    border-radius: var(--r-md);
    background: var(--bg);
    border: 1px solid var(--border);
  }
  .dim-box .k {
    font-size: 10px;
    font-weight: 700;
  }
  [data-axis='x'] .k {
    color: #ff5a64;
  }
  [data-axis='y'] .k {
    color: #4be38a;
  }
  [data-axis='z'] .k {
    color: #4aa3ff;
  }
  .dim-box .v {
    font-size: 14px;
    color: var(--text);
  }
  .dim-box .u {
    font-size: 10px;
    color: var(--faint);
  }
  .hint {
    margin: 10px 0 0;
    font-size: 12px;
    color: var(--muted);
  }
  .row3 {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
  }
  .tools {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }
  .tools .ghost {
    justify-content: flex-start;
    font-size: 12px;
  }
  .export {
    padding: 12px;
    border-top: 1px solid var(--neon-soft);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .fmt {
    display: flex;
    gap: 4px;
  }
  .fmt button {
    flex: 1;
    height: 26px;
    border-radius: 6px;
    background: var(--surface);
    color: var(--muted);
    font-size: 11px;
    font-weight: 700;
    border: 1px solid var(--border);
  }
  .fmt button.on {
    color: var(--accent);
    border-color: var(--neon-line);
    box-shadow: var(--glow-sm);
  }
  .wide {
    width: 100%;
    justify-content: center;
  }
  .primary.wide {
    height: 36px;
  }
  .verdict {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border-radius: var(--r-md);
    font-weight: 700;
    background: var(--bg);
    border: 1px solid var(--border-strong);
  }
  .verdict span:not(.spinner) {
    flex: 1;
  }
  .verdict.checking {
    color: var(--muted);
    font-weight: 400;
  }
  .verdict.ready {
    color: var(--ok);
    border-color: rgba(62, 224, 143, 0.55);
    box-shadow: 0 0 12px rgba(62, 224, 143, 0.25), inset 0 0 14px rgba(62, 224, 143, 0.08);
  }
  .verdict.attention {
    color: var(--accent);
    border-color: var(--neon-line);
    box-shadow: var(--glow-sm), inset 0 0 14px rgba(var(--accent-rgb), 0.08);
  }
  .verdict.fail {
    color: var(--danger);
    border-color: rgba(255, 77, 94, 0.55);
    box-shadow: 0 0 12px rgba(255, 77, 94, 0.25), inset 0 0 14px rgba(255, 77, 94, 0.08);
  }
  .issues {
    list-style: none;
    margin: 10px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .issues li {
    display: flex;
    gap: 8px;
  }
  .lvl {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    margin-top: 6px;
    flex: none;
    background: var(--faint);
  }
  .error .lvl {
    background: var(--danger);
    box-shadow: 0 0 6px var(--danger);
  }
  .warn .lvl {
    background: var(--accent);
    box-shadow: var(--glow-sm);
  }
  .it {
    font-weight: 600;
  }
  .id {
    font-size: 12px;
    color: var(--muted);
  }
  .checkstats {
    margin-top: 12px;
  }
  .hint.ok {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--ok);
    margin: 0 0 8px;
  }
  .hint.small {
    font-size: 11px;
    color: var(--faint);
    margin-top: 6px;
  }
  .librow,
  .slicer {
    display: flex;
    gap: 6px;
  }
  .librow select,
  .slicer select {
    flex: 1;
    min-width: 0;
    height: 28px;
    padding: 0 6px;
    border-radius: 6px;
    background: var(--bg);
    border: 1px solid var(--border-strong);
    color: var(--text);
    outline: none;
  }
  select option {
    background: var(--panel);
  }
  .slicer .ghost {
    flex: none;
  }
  .note {
    margin: 0;
    font-size: 11px;
    color: var(--faint);
    text-align: center;
  }
</style>
