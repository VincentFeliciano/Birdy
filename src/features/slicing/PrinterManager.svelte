<script lang="ts">
  import Icon from '../../components/Icon.svelte'
  import type { PrinterInfo, PrinterKind, PrinterTestResult } from '../../types/slicing'
  import { sl } from './store.svelte'
  import { resin } from './resin.svelte'
  import { bar, refreshPrinters, setBarHidden } from '../printers/status.svelte'

  const kinds: { id: PrinterKind; label: string; hint: string }[] = [
    { id: 'octoprint', label: 'OctoPrint', hint: 'Address of your OctoPrint (e.g. octopi.local) and an API key from its Settings → Application Keys.' },
    { id: 'moonraker', label: 'Klipper (Moonraker)', hint: 'Address of Mainsail or Fluidd (e.g. 192.168.1.50). An API key is only needed if you turned one on.' },
    { id: 'prusalink', label: 'PrusaLink', hint: 'Printer address. Use the username and password shown on the printer, or an API key on older firmware.' },
    { id: 'elegoo', label: 'Elegoo resin (Wi-Fi)', hint: 'Address shown on the printer’s screen (Settings → Network), e.g. 192.168.1.60. For Saturn 4 / Mars 5 series and other printers with Elegoo’s SDCP V3 network protocol; no key needed.' },
    { id: 'serial', label: 'USB cable', hint: 'Marlin-compatible printers connected to this PC. Boaty streams the G-code; keep it open while printing.' },
  ]
  const bauds = [115200, 250000, 57600, 230400, 500000, 38400, 19200, 9600]

  let editing = $state<{ id?: string; name: string; kind: PrinterKind; url: string; secret: string; username: string; baudRate: number; hasSecret: boolean } | null>(null)
  let busy = $state(false)
  let error = $state<string | null>(null)
  let tests = $state<Record<string, PrinterTestResult | 'running'>>({})

  const kindInfo = $derived(kinds.find((k) => k.id === editing?.kind))

  function startAdd() {
    error = null
    editing = { name: '', kind: resin.mode === 'resin' ? 'elegoo' : 'octoprint', url: '', secret: '', username: '', baudRate: 115200, hasSecret: false }
  }

  function startEdit(p: PrinterInfo) {
    error = null
    editing = { id: p.id, name: p.name, kind: p.kind, url: p.url ?? '', secret: '', username: p.username ?? '', baudRate: p.baudRate ?? 115200, hasSecret: p.hasSecret }
  }

  async function save() {
    if (!editing) return
    busy = true
    error = null
    try {
      sl.printers = await window.api.printers.save({
        id: editing.id,
        name: editing.name || kindInfo?.label || 'Printer',
        kind: editing.kind,
        url: editing.kind === 'serial' ? undefined : editing.url,
        // Leave the stored key alone unless something new was typed.
        secret: editing.secret ? editing.secret : undefined,
        username: editing.kind === 'prusalink' ? editing.username : undefined,
        baudRate: editing.kind === 'serial' ? editing.baudRate : undefined,
      })
      if (!sl.printerId || !sl.printers.some((p) => p.id === sl.printerId)) {
        const last = sl.printers[sl.printers.length - 1]
        if (last) {
          sl.printerId = last.id
          localStorage.setItem('birdy.printer', last.id)
        }
      }
      editing = null
    } catch (err) {
      error = String((err as Error).message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
    } finally {
      busy = false
    }
  }

  async function forgetKey() {
    if (!editing?.id) return
    sl.printers = await window.api.printers.save({ id: editing.id, name: editing.name, kind: editing.kind, url: editing.url, secret: '', username: editing.username })
    editing.hasSecret = false
  }

  async function remove(p: PrinterInfo) {
    sl.printers = await window.api.printers.remove(p.id)
    if (editing?.id === p.id) editing = null
  }

  async function test(p: PrinterInfo) {
    tests[p.id] = 'running'
    tests[p.id] = await window.api.printers.test(p.id)
  }
</script>

<div class="scroll">
  <section>
    <h3 class="hud-label row-head">
      <button class="icon-btn mini" aria-label="Back to slicing" title="Back" onclick={() => (sl.managePrinters = false)}><Icon name="back" size={14} /></button>
      Printers
    </h3>
    {#if sl.printers.some((p) => p.kind !== 'serial')}
      <label class="barToggle">
        <input
          type="checkbox"
          checked={!bar.hidden}
          onchange={(e) => {
            setBarHidden(!e.currentTarget.checked)
            refreshPrinters()
          }} />
        Show live status of network printers at the bottom of the window
      </label>
    {/if}

    {#if !editing}
      {#if sl.printers.length}
        <ul class="list">
          {#each sl.printers as p (p.id)}
            {@const t = tests[p.id]}
            <li>
              <div class="top">
                <Icon name={p.kind === 'serial' ? 'usb' : 'printer'} size={16} />
                <div class="meta">
                  <div class="name">{p.name}</div>
                  <div class="sub mono">{kinds.find((k) => k.id === p.kind)?.label}{p.url ? ` · ${p.url.replace(/^https?:\/\//, '')}` : ''}{p.baudRate ? ` · ${p.baudRate} baud` : ''}</div>
                </div>
              </div>
              <div class="actions">
                {#if p.kind !== 'serial'}
                  <button class="ghost" disabled={t === 'running'} onclick={() => test(p)}>
                    {#if t === 'running'}<span class="spinner"></span>{/if}Test
                  </button>
                {/if}
                <button class="ghost" onclick={() => startEdit(p)}><Icon name="pencil" size={13} />Edit</button>
                <button class="ghost danger" onclick={() => remove(p)}><Icon name="trash" size={13} />Remove</button>
              </div>
              {#if t && t !== 'running'}<p class={t.ok ? 'ok' : 'err'}>{t.detail}</p>{/if}
            </li>
          {/each}
        </ul>
      {:else}
        <p class="hint">No printers yet.</p>
      {/if}
      <button class="primary wide" onclick={startAdd}><Icon name="plus" size={15} />Add printer</button>
      <p class="hint small">Keys and passwords are encrypted with your Windows account and only sent to the printer’s own address.</p>
    {:else}
      <label class="field">
        <span>Connection</span>
        <select bind:value={editing.kind}>
          {#each kinds as k}<option value={k.id}>{k.label}</option>{/each}
        </select>
      </label>
      {#if kindInfo}<p class="hint small top0">{kindInfo.hint}</p>{/if}
      <label class="field">
        <span>Name</span>
        <input type="text" maxlength="80" placeholder={kindInfo?.label} bind:value={editing.name} />
      </label>
      {#if editing.kind === 'serial'}
        <label class="field">
          <span>Baud rate</span>
          <select bind:value={editing.baudRate}>
            {#each bauds as b}<option value={b}>{b}{b === 115200 ? ' (most printers)' : b === 250000 ? ' (many Marlin boards)' : ''}</option>{/each}
          </select>
        </label>
      {:else}
        <label class="field">
          <span>Address</span>
          <input type="text" spellcheck="false" placeholder="192.168.1.50 or printer.local" bind:value={editing.url} />
        </label>
        {#if editing.kind === 'prusalink'}
          <label class="field">
            <span>Username <i>(blank to use an API key)</i></span>
            <input type="text" spellcheck="false" autocomplete="off" bind:value={editing.username} />
          </label>
        {/if}
        {#if editing.kind !== 'elegoo'}
        <label class="field">
          <span>
            {editing.kind === 'prusalink' && editing.username ? 'Password' : 'API key'}
            {#if editing.hasSecret}<i>(saved; type to replace)</i>{/if}
          </span>
          <input type="password" autocomplete="off" spellcheck="false" bind:value={editing.secret} placeholder={editing.hasSecret ? '••••••••' : ''} />
        </label>
        {/if}
        {#if editing.hasSecret}<button class="link" onclick={forgetKey}>Forget saved key</button>{/if}
      {/if}
      {#if error}<p class="err">{error}</p>{/if}
      <div class="row">
        <button class="ghost" onclick={() => (editing = null)}>Cancel</button>
        <button class="primary" disabled={busy || (editing.kind !== 'serial' && !editing.url.trim())} onclick={save}>
          {#if busy}<span class="spinner"></span>{/if}Save
        </button>
      </div>
    {/if}
  </section>
</div>

<style>
  .barToggle {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0 0 10px;
    font-size: 12px;
    color: var(--muted);
    cursor: pointer;
  }
  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0 12px;
  }
  section {
    padding: 12px 0;
  }
  h3 {
    margin: 0 0 10px;
  }
  .row-head {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .mini {
    width: 24px;
    height: 24px;
  }
  .list {
    list-style: none;
    margin: 0 0 10px;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .list li {
    padding: 10px;
    border-radius: var(--r-md);
    background: var(--bg);
    border: 1px solid var(--border);
  }
  .top {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    color: var(--accent);
  }
  .meta {
    min-width: 0;
  }
  .name {
    color: var(--text);
    font-weight: 600;
  }
  .sub {
    font-size: 11px;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .actions {
    display: flex;
    gap: 4px;
    margin-top: 8px;
  }
  .actions .ghost {
    flex: 1;
    justify-content: center;
    font-size: 11px;
    height: 26px;
    padding: 0 6px;
  }
  .ghost.danger:hover {
    color: var(--danger);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 10px;
  }
  .field > span {
    font-size: 11px;
    color: var(--muted);
  }
  .field i {
    font-style: normal;
    color: var(--faint);
  }
  select,
  input {
    width: 100%;
    height: 30px;
    padding: 0 8px;
    border-radius: 6px;
    background: var(--bg);
    border: 1px solid var(--border-strong);
    color: var(--text);
    outline: none;
    font: inherit;
    font-size: 12px;
  }
  select:focus,
  input:focus {
    border-color: var(--neon-line);
    box-shadow: var(--glow-sm);
  }
  select option {
    background: var(--panel);
  }
  .hint {
    margin: 6px 0 10px;
    font-size: 12px;
    color: var(--muted);
  }
  .hint.small {
    font-size: 11px;
    color: var(--faint);
    line-height: 1.45;
  }
  .top0 {
    margin-top: -4px;
  }
  .err {
    margin: 6px 0 0;
    font-size: 12px;
    color: var(--danger);
  }
  .ok {
    margin: 6px 0 0;
    font-size: 12px;
    color: var(--ok);
  }
  .row {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
    margin-top: 6px;
  }
  .wide {
    width: 100%;
    justify-content: center;
    height: 34px;
  }
  .link {
    color: var(--accent);
    font-size: 11px;
    margin: -4px 0 8px;
  }
</style>
