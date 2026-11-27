<script lang="ts">
  import Icon from '../../components/Icon.svelte'
  import { fmtMoney } from '../../app/costs.svelte'
  import type { HistoryEntry } from '../../types/ipc'
  import { history, totals } from './history.svelte'

  let { query = '' }: { query?: string } = $props()
  const api = window.api

  const q = $derived(query.trim().toLowerCase())
  const entries = $derived(history.entries.filter((e) => !q || e.name.toLowerCase().includes(q) || e.printer.toLowerCase().includes(q)))
  const t = $derived(totals(entries))
  const missing = $state<Record<string, boolean>>({})

  const howText = { saved: 'Saved file', sent: 'Sent to printer', usb: 'Printed over USB' } as const
  const fmtDur = (s: number | null) => {
    if (s === null) return '—'
    const h = Math.floor(s / 3600)
    const m = Math.round((s % 3600) / 60)
    return h ? `${h}h ${m}m` : `${m}m`
  }
  const fmtDate = (at: number) =>
    new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
  const material = (e: HistoryEntry) => (e.kind === 'resin' ? (e.ml !== null ? `${e.ml.toFixed(1)} ml` : '—') : e.grams !== null ? `${e.grams.toFixed(1)} g` : '—')

  function mark(e: HistoryEntry, outcome: 'ok' | 'failed') {
    void api.history.update(e.id, { outcome: e.outcome === outcome ? null : outcome })
  }
  async function reveal(e: HistoryEntry) {
    if (!(await api.history.reveal(e.id))) missing[e.id] = true
  }
</script>

{#if history.entries.length === 0}
  <div class="empty">
    <Icon name="printer" size={28} stroke={1.4} />
    <p>No prints yet. Every time you save sliced G-code or a resin file, send a print to a printer, or print over USB, it shows up here with its time, material and cost.</p>
  </div>
{:else}
  <div class="totals">
    <div><span class="k">Prints</span><span class="v mono">{t.prints}</span></div>
    <div>
      <span class="k">Worked</span>
      <span class="v mono">{t.ok + t.failed ? `${Math.round((t.ok / (t.ok + t.failed)) * 100)}%` : '—'}</span>
    </div>
    <div><span class="k">Print time</span><span class="v mono">{fmtDur(t.seconds)}</span></div>
    <div><span class="k">Filament</span><span class="v mono">{t.grams ? `${(t.grams / 1000).toFixed(2)} kg` : '—'}</span></div>
    <div><span class="k">Resin</span><span class="v mono">{t.ml ? `${(t.ml / 1000).toFixed(2)} L` : '—'}</span></div>
    <div><span class="k">Spent</span><span class="v mono">{fmtMoney(t.cost)}</span></div>
  </div>
  <ul class="list">
    {#each entries as e (e.id)}
      <li class="row" class:ok={e.outcome === 'ok'} class:failed={e.outcome === 'failed'}>
        <div class="thumb">{#if e.thumbnail}<img src={e.thumbnail} alt="" />{:else}<Icon name="cube" size={22} />{/if}</div>
        <div class="main">
          <div class="title">
            <span class="name" title={e.name}>{e.name}</span>
            <span class="pill mono">{e.kind === 'resin' ? 'Resin' : 'FDM'}</span>
          </div>
          <div class="sub">{fmtDate(e.at)} · {howText[e.how]}{e.printer ? ` · ${e.printer}` : ''}</div>
          <div class="sub mono">{fmtDur(e.seconds)} · {material(e)} · {fmtMoney(e.cost)}{e.settings ? ` · ${e.settings}` : ''}</div>
          <input
            class="note"
            placeholder="Add a note (what went right or wrong)"
            value={e.note}
            maxlength="500"
            onchange={(ev) => api.history.update(e.id, { note: ev.currentTarget.value })} />
        </div>
        <div class="acts">
          <button class="out ok" class:on={e.outcome === 'ok'} title="It printed fine" onclick={() => mark(e, 'ok')}><Icon name="check" size={13} />Worked</button>
          <button class="out failed" class:on={e.outcome === 'failed'} title="The print failed" onclick={() => mark(e, 'failed')}><Icon name="close" size={13} />Failed</button>
          <div class="tools">
            {#if e.path}
              <button class="icon-btn" title={missing[e.id] ? 'The file has been moved or deleted' : 'Show the file in its folder'} disabled={missing[e.id]} onclick={() => reveal(e)}>
                <Icon name="folder" size={14} />
              </button>
            {/if}
            <button class="icon-btn" title="Remove from history" aria-label="Remove from history" onclick={() => api.history.remove(e.id)}><Icon name="trash" size={14} /></button>
          </div>
        </div>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 60px 20px;
    color: var(--faint);
    text-align: center;
  }
  .empty p {
    max-width: 440px;
    font-size: 13px;
    color: var(--muted);
  }
  .totals {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 8px;
    margin-bottom: 14px;
  }
  .totals > div {
    display: flex;
    flex-direction: column;
    padding: 8px 10px;
    border-radius: var(--r-md);
    background: var(--bg);
    border: 1px solid var(--border);
  }
  .k {
    font-size: 10px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .v {
    font-size: 15px;
    color: var(--text);
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .row {
    display: flex;
    gap: 12px;
    padding: 10px;
    border-radius: var(--r-md);
    border: 1px solid var(--border);
    background: var(--surface);
  }
  .row.ok {
    border-color: color-mix(in srgb, var(--ok) 45%, transparent);
  }
  .row.failed {
    border-color: color-mix(in srgb, var(--danger) 45%, transparent);
  }
  .thumb {
    flex: none;
    width: 72px;
    height: 72px;
    display: grid;
    place-items: center;
    border-radius: 6px;
    background: var(--bg);
    color: var(--faint);
    overflow: hidden;
  }
  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .title {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .name {
    font-weight: 600;
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pill {
    flex: none;
    padding: 1px 7px;
    border-radius: 9px;
    font-size: 10px;
    color: var(--accent);
    background: rgba(var(--accent-rgb), 0.1);
  }
  .sub {
    font-size: 11px;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .note {
    margin-top: 4px;
    height: 26px;
    padding: 0 8px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-size: 12px;
    outline: none;
  }
  .note:focus {
    border-color: var(--neon-line);
  }
  .acts {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 96px;
  }
  .out {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    height: 26px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: none;
    color: var(--muted);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .out.ok:hover,
  .out.ok.on {
    color: var(--ok);
    border-color: var(--ok);
  }
  .out.failed:hover,
  .out.failed.on {
    color: var(--danger);
    border-color: var(--danger);
  }
  .out.on {
    background: var(--bg);
  }
  .tools {
    display: flex;
    justify-content: flex-end;
    gap: 2px;
    margin-top: auto;
  }
</style>
