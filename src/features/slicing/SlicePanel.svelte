<script lang="ts">
  import { onMount } from 'svelte'
  import FdmPanel from './FdmPanel.svelte'
  import ResinPanel from './ResinPanel.svelte'
  import { initResin, resin, setMode } from './resin.svelte'
  import PrinterManager from './PrinterManager.svelte'
  import { sl } from './store.svelte'

  onMount(initResin)
</script>

<div class="mode" role="radiogroup" aria-label="Printer type">
  <button role="radio" aria-checked={resin.mode === 'fdm'} class:on={resin.mode === 'fdm'} title="Filament printers (FDM)" onclick={() => setMode('fdm')}>Filament</button>
  <button role="radio" aria-checked={resin.mode === 'resin'} class:on={resin.mode === 'resin'} title="Resin printers (MSLA)" onclick={() => setMode('resin')}>Resin</button>
</div>

{#if resin.mode === 'resin'}
  {#if sl.managePrinters}<PrinterManager />{:else}<ResinPanel />{/if}
{:else}
  <FdmPanel />
{/if}

<style>
  .mode {
    flex: none;
    display: flex;
    gap: 2px;
    margin: 10px 12px 0;
    padding: 2px;
    border-radius: var(--r-md);
    background: var(--bg);
    border: 1px solid var(--border);
  }
  .mode button {
    flex: 1;
    height: 26px;
    border: 0;
    border-radius: 6px;
    background: none;
    color: var(--muted);
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  .mode button:hover {
    color: var(--text);
  }
  .mode button.on {
    color: var(--accent);
    background: rgba(var(--accent-rgb), 0.1);
    box-shadow: inset 0 0 0 1px var(--neon-line);
  }
</style>
