<script lang="ts">
  import Icon from '../../components/Icon.svelte'
  import {
    PLAY_SPEEDS,
    restartPlayback,
    seekPlayback,
    setPlaySpeed,
    setPreviewLayer,
    setPreviewOn,
    setPreviewTravel,
    sl,
    togglePlayback,
  } from './store.svelte'

  const p = $derived(sl.preview)
  const z = $derived(p.layerZ[p.layer - 1])

  /** Space plays and pauses while the toolpaths are shown, unless you're typing somewhere. */
  function onWindowKey(e: KeyboardEvent) {
    if (e.code !== 'Space' || !p.ready || !p.on || e.repeat) return
    const t = e.target as HTMLElement | null
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(t.tagName))) return
    e.preventDefault()
    togglePlayback()
  }

  function onKey(e: KeyboardEvent) {
    const step = e.shiftKey ? 10 : 1
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') setPreviewLayer(p.layer + step)
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') setPreviewLayer(p.layer - step)
    else if (e.key === 'Home') setPreviewLayer(1)
    else if (e.key === 'End') setPreviewLayer(p.layers)
    else return
    e.preventDefault()
  }
</script>

<svelte:window onkeydown={onWindowKey} />

{#if p.ready && p.on}
  <div class="layers mono">
    <span class="top">{p.layers}</span>
    <input
      type="range"
      min="1"
      max={p.layers}
      step="1"
      value={p.layer}
      aria-label="Layer"
      oninput={(e) => setPreviewLayer(Number(e.currentTarget.value))}
      onkeydown={onKey} />
    <span class="bottom">1</span>
  </div>
  <div class="readout mono">
    <span class="hud-tag">LAYER</span>
    <span class="val">{p.layer}<i>/{p.layers}</i></span>
    {#if z !== undefined}<span class="val">Z {z.toFixed(2)}<i>MM</i></span>{/if}
  </div>
  <div class="dock">
  <div class="player" role="group" aria-label="Play the print">
    <button class="icon-btn" title="Back to the first layer" aria-label="Back to the start" onclick={restartPlayback}><Icon name="reset" size={13} /></button>
    <button class="play" title={p.playing ? 'Pause (Space)' : 'Play the print move by move (Space)'} aria-label={p.playing ? 'Pause' : 'Play'} onclick={togglePlayback}>
      <Icon name={p.playing ? 'pause' : 'play'} size={14} />
    </button>
    <input
      class="scrub"
      type="range"
      min="0"
      max="1000"
      step="1"
      value={Math.round(p.done * 1000)}
      aria-label="Position in the print"
      title="Drag to move through the print"
      oninput={(e) => seekPlayback(Number(e.currentTarget.value) / 1000)} />
    <span class="pct mono">{Math.floor(p.done * 100)}%</span>
    <select class="speed" title="Playback speed: 1× is about a real printer's pace" aria-label="Playback speed" value={p.speed} onchange={(e) => setPlaySpeed(Number(e.currentTarget.value))}>
      {#each PLAY_SPEEDS as s, i}<option value={i}>{s.label}</option>{/each}
    </select>
  </div>
  <div class="legend">
    {#each p.features as f}
      <span class="item"><i style:background={f.color} style:box-shadow={`0 0 6px ${f.color}`}></i>{f.name}</span>
    {/each}
    <label class="travel">
      <input type="checkbox" checked={p.travel} onchange={(e) => setPreviewTravel(e.currentTarget.checked)} />
      Travel moves
    </label>
    <button class="ghost" onclick={() => setPreviewOn(false)}><Icon name="cube" size={13} />Show model</button>
  </div>
  </div>
{:else if p.ready}
  <div class="legend compact">
    <button class="ghost" onclick={() => setPreviewOn(true)}><Icon name="layers" size={13} />Show toolpaths</button>
  </div>
{/if}

<style>
  .layers {
    position: absolute;
    right: 56px;
    top: 64px;
    bottom: 84px;
    width: 34px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    font-size: 10px;
    color: var(--muted);
    z-index: 3;
  }
  .layers input {
    flex: 1;
    writing-mode: vertical-lr;
    direction: rtl;
    width: 22px;
    accent-color: var(--accent);
    cursor: ns-resize;
    filter: drop-shadow(0 0 4px rgba(var(--accent-rgb), 0.5));
  }
  .readout {
    position: absolute;
    right: 100px;
    top: 64px;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
    padding: 8px 10px;
    border-radius: var(--r-md);
    background: rgba(11, 12, 15, 0.72);
    border: 1px solid var(--neon-soft);
    font-size: 12px;
    z-index: 3;
  }
  .val {
    color: var(--accent);
    text-shadow: var(--glow-text);
    font-size: 14px;
  }
  .val i {
    font-style: normal;
    color: var(--faint);
    font-size: 10px;
    margin-left: 3px;
    text-shadow: none;
  }
  /* The player sits on top of the legend; the two grow upward together and never overlap. */
  .dock {
    position: absolute;
    left: 56px;
    bottom: 52px;
    max-width: calc(100% - 200px);
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    z-index: 3;
  }
  .player {
    width: min(460px, 100%);
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-radius: var(--r-md);
    background: rgba(11, 12, 15, 0.72);
    border: 1px solid var(--neon-soft);
    z-index: 3;
  }
  .player .play {
    flex: none;
    width: 30px;
    height: 30px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    border: 1px solid var(--neon-line);
    background: rgba(var(--accent-rgb), 0.14);
    color: var(--accent);
    cursor: pointer;
    box-shadow: var(--glow-sm);
  }
  .player .play:hover {
    background: rgba(var(--accent-rgb), 0.26);
  }
  .scrub {
    flex: 1;
    min-width: 60px;
    accent-color: var(--accent);
  }
  .pct {
    width: 34px;
    text-align: right;
    font-size: 11px;
    color: var(--accent);
  }
  .speed {
    flex: none;
    height: 24px;
    border-radius: 6px;
    border: 1px solid var(--border-strong);
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-size: 11px;
    padding: 0 4px;
  }
  .dock .legend {
    position: static;
    max-width: none;
  }
  .legend {
    position: absolute;
    left: 56px;
    bottom: 52px;
    max-width: calc(100% - 200px);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 12px;
    padding: 8px 10px;
    border-radius: var(--r-md);
    background: rgba(11, 12, 15, 0.72);
    border: 1px solid var(--border-strong);
    font-size: 11px;
    color: var(--muted);
    z-index: 3;
  }
  .legend.compact {
    padding: 4px;
  }
  .item {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .item i {
    width: 10px;
    height: 3px;
    border-radius: 2px;
  }
  .travel {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .travel input {
    accent-color: var(--accent);
  }
  .legend .ghost {
    height: 24px;
    font-size: 11px;
    padding: 0 8px;
  }
</style>
