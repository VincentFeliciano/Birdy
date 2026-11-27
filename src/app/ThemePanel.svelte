<script lang="ts">
  import Icon from '../components/Icon.svelte'
  import Logo from '../components/Logo.svelte'
  import { ACCENTS, applyAccent, applyCustomAccent, theme } from './theme.svelte'

  let { onclose }: { onclose: () => void } = $props()
  const isCustom = $derived(theme.accent.id === 'custom')
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div class="theme neon-panel" role="region" aria-label="Neon colour">
  <div class="preview">
    <Logo size={34} glow={1.4} />
    <div>
      <div class="hud-label">Neon colour</div>
      <div class="name">{theme.accent.name}<span class="mono hex">{theme.accent.hex}</span></div>
    </div>
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
  <div class="spacer"></div>
  <button class="icon-btn" title="Close" aria-label="Close neon colour" onclick={onclose}><Icon name="close" size={15} /></button>
</div>

<style>
  .theme {
    flex: none;
    display: flex;
    align-items: center;
    gap: 22px;
    padding: 10px 10px 10px 16px;
  }
  .preview {
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
    font-size: 11px;
    font-weight: 400;
    color: var(--muted);
    text-shadow: none;
  }
  .swatches {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .sw {
    position: relative;
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    padding: 0;
    border-radius: 50%;
    border: 1px solid var(--border-strong);
    background: var(--bg);
    cursor: pointer;
    transition: border-color 0.12s, transform 0.12s;
  }
  .sw:hover {
    transform: scale(1.08);
  }
  .sw span {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--c);
    box-shadow: 0 0 6px var(--c), 0 0 12px var(--c);
  }
  .sw.on {
    border-color: var(--c);
    box-shadow: 0 0 8px var(--c), inset 0 0 6px var(--c);
  }
  .custom span {
    background: conic-gradient(#ff3b3b, #f5c400, #7cff4f, #22e4ff, #9b5cff, #ff2e88, #ff3b3b);
    box-shadow: none;
  }
  .custom.on span {
    background: var(--c);
    box-shadow: 0 0 6px var(--c), 0 0 12px var(--c);
  }
  .custom input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
  }
  .spacer {
    flex: 1;
  }
</style>
