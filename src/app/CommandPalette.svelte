<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { commands, search, ui, type Command } from './commands.svelte'

  let query = $state('')
  let index = $state(0)
  let input: HTMLInputElement
  let listEl: HTMLUListElement

  const all = commands()
  const results = $derived(search(all, query))

  onMount(() => input.focus())

  $effect(() => {
    void query
    index = 0
  })

  function close() {
    ui.palette = false
  }

  function run(c: Command | undefined) {
    if (!c) return
    close()
    // Let the palette close (and the website view come back) before the command runs.
    void tick().then(() => c.run())
  }

  async function move(d: number) {
    if (!results.length) return
    index = (index + d + results.length) % results.length
    await tick()
    listEl?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') move(1)
    else if (e.key === 'ArrowUp') move(-1)
    else if (e.key === 'PageDown') move(8)
    else if (e.key === 'PageUp') move(-8)
    else if (e.key === 'Enter') run(results[index])
    else if (e.key === 'Escape') close()
    else return
    e.preventDefault()
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="scrim" onclick={close}>
  <div class="pal neon-panel" role="dialog" aria-modal="true" aria-label="Command palette" tabindex="-1" onclick={(e) => e.stopPropagation()}>
    <input
      bind:this={input}
      bind:value={query}
      onkeydown={onKey}
      placeholder="Type a command… (open, slice, orient, history, theme)"
      aria-label="Search commands"
      role="combobox"
      aria-expanded="true"
      aria-controls="pal-list"
      aria-activedescendant={results[index] ? `pal-${results[index].id}` : undefined}
      spellcheck="false" />
    <ul id="pal-list" role="listbox" bind:this={listEl}>
      {#each results as c, i (c.id)}
        <li
          id="pal-{c.id}"
          role="option"
          aria-selected={i === index}
          class:on={i === index}
          onmousemove={() => (index = i)}
          onclick={() => run(c)}>
          <span class="g">{c.group}</span>
          <span class="t">{c.title}</span>
          {#if c.keys}<kbd>{c.keys}</kbd>{/if}
        </li>
      {:else}
        <li class="none">No command matches “{query}”.</li>
      {/each}
    </ul>
    <div class="foot mono">↑↓ choose · Enter run · Esc close</div>
  </div>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding-top: 12vh;
    background: rgba(0, 0, 0, 0.45);
  }
  .pal {
    width: min(620px, calc(100vw - 40px));
    display: flex;
    flex-direction: column;
    overflow: hidden;
    outline: none;
  }
  input {
    height: 48px;
    padding: 0 18px;
    border: 0;
    border-bottom: 1px solid var(--border);
    background: none;
    color: var(--text);
    font: inherit;
    font-size: 15px;
    outline: none;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 6px;
    max-height: 52vh;
    overflow: auto;
  }
  li {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 10px;
    border-radius: 6px;
    cursor: pointer;
  }
  li.on {
    background: rgba(var(--accent-rgb), 0.12);
    box-shadow: inset 2px 0 0 var(--accent);
  }
  .g {
    flex: none;
    width: 62px;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--faint);
  }
  .t {
    flex: 1;
    min-width: 0;
    font-size: 13px;
  }
  li.on .t {
    color: var(--accent);
  }
  kbd {
    flex: none;
    padding: 1px 6px;
    border-radius: 4px;
    border: 1px solid var(--border-strong);
    font: 11px var(--font-mono, monospace);
    color: var(--muted);
  }
  .none {
    color: var(--muted);
    cursor: default;
    font-size: 13px;
  }
  .foot {
    padding: 6px 14px;
    border-top: 1px solid var(--border);
    font-size: 10px;
    color: var(--faint);
  }
</style>
