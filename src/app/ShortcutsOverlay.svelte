<script lang="ts">
  import Icon from '../components/Icon.svelte'
  import { SHORTCUTS, ui } from './commands.svelte'

  const close = () => (ui.shortcuts = false)
  let panel: HTMLDivElement
  $effect(() => panel.focus())
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && close()} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="scrim" onclick={close}>
  <div class="sheet neon-panel" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" tabindex="-1" bind:this={panel} onclick={(e) => e.stopPropagation()}>
    <header>
      <h2 class="hud-label">Keyboard shortcuts</h2>
      <button class="icon-btn" aria-label="Close" onclick={close}><Icon name="close" size={14} /></button>
    </header>
    <div class="cols">
      {#each SHORTCUTS as g (g.group)}
        <section>
          <h3>{g.group}</h3>
          <dl>
            {#each g.items as [keys, what] (keys)}
              <dt>
                {#each keys.split(/\s{2}or\s{2}/) as k, i (k)}
                  {#if i}<span class="or">or</span>{/if}<kbd>{k}</kbd>
                {/each}
              </dt>
              <dd>{what}</dd>
            {/each}
          </dl>
        </section>
      {/each}
    </div>
    <p class="foot">Press <kbd>Ctrl+K</kbd> to search every command by name.</p>
  </div>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: grid;
    place-items: center;
    background: rgba(0, 0, 0, 0.45);
  }
  .sheet {
    width: min(860px, calc(100vw - 40px));
    max-height: calc(100vh - 60px);
    overflow: auto;
    padding: 16px 20px;
    outline: none;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }
  h2 {
    margin: 0;
  }
  .cols {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 18px 28px;
  }
  h3 {
    margin: 0 0 8px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--accent);
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 6px 14px;
    margin: 0;
    align-items: center;
  }
  dt {
    display: flex;
    align-items: center;
    gap: 4px;
    white-space: nowrap;
  }
  dd {
    margin: 0;
    font-size: 12px;
    color: var(--muted);
  }
  kbd {
    padding: 1px 6px;
    border-radius: 4px;
    border: 1px solid var(--border-strong);
    background: var(--bg);
    font: 11px var(--font-mono, monospace);
    color: var(--text);
  }
  .or {
    font-size: 10px;
    color: var(--faint);
  }
  .foot {
    margin: 16px 0 0;
    font-size: 12px;
    color: var(--muted);
  }
</style>
