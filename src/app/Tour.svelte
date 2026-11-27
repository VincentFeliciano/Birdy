<script lang="ts">
  import { tick } from 'svelte'
  import { ws } from '../features/workspace/store.svelte'
  import { finishTour, ui } from './commands.svelte'

  interface Step {
    target: string | null
    title: string
    text: string
    layout?: 'browse' | 'split'
  }

  const steps: Step[] = [
    {
      target: null,
      title: 'Welcome to Birdy',
      text: 'A web browser built for 3D printing: find a model, check it, fix it, slice it and send it to your printer without juggling folders. This takes under a minute; press Skip any time.',
    },
    {
      target: '.address',
      title: 'Search for models',
      text: 'Type here to search Google for 3D models (the menu on the left picks models, ideas or help), or enter any site such as Printables or Thingiverse. On a model page, "Get in Birdy" shows up here.',
      layout: 'split',
    },
    {
      target: '.ws-col',
      title: 'Your workspace',
      text: 'Models you download open here by themselves. You can also drop STL, 3MF, OBJ, GLB, PLY or WRL files anywhere in the window. Birdy checks each one for printing problems straight away.',
      layout: 'split',
    },
    {
      target: '.sidebar .seg',
      title: 'Fix, arrange and slice',
      text: 'Model shows the print check and repairs. Transform scales, rotates and auto-orients, and arranges several parts on one plate. Slice makes G-code for filament printers or .goo files for Elegoo resin printers, and sends prints to OctoPrint, Klipper, PrusaLink or a USB printer.',
      layout: 'split',
    },
    {
      target: '.rail',
      title: 'Switch views',
      text: 'Website, side by side, workspace only and your library (saved models, bookmarks and print history). Further down: open a file, downloads, the neon colour and your Models folder.',
      layout: 'split',
    },
    {
      target: null,
      title: 'Two keys to remember',
      text: 'Ctrl+K finds any command by name. ? (or Ctrl+/) lists every keyboard shortcut. You can take this tour again from Ctrl+K → "Take the tour".',
    },
  ]

  let i = $state(0)
  let rect = $state<DOMRect | null>(null)
  const step = $derived(steps[i]!)

  async function place() {
    if (step.layout && (ws.layout === 'browse' || ws.layout === 'library' || (step.layout === 'split' && ws.layout === 'workspace'))) ws.layout = step.layout
    if (step.target === '.sidebar .seg') ws.sidebarOpen = true
    await tick()
    await new Promise((r) => requestAnimationFrame(r))
    const el = step.target ? document.querySelector(step.target) : null
    rect = el ? el.getBoundingClientRect() : null
  }

  $effect(() => {
    void i
    void place()
    const onResize = () => void place()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  })

  const next = () => (i < steps.length - 1 ? i++ : finishTour())
  const back = () => i > 0 && i--

  // Card placement: beside the highlighted area when there is room, else under or over it.
  const card = $derived.by(() => {
    const W = 360
    const vw = window.innerWidth
    const vh = window.innerHeight
    if (!rect) return `left: ${(vw - W) / 2}px; top: ${vh * 0.28}px;`
    if (rect.right + W + 24 < vw && rect.width < vw * 0.4) return `left: ${rect.right + 16}px; top: ${Math.min(Math.max(12, rect.top), vh - 260)}px;`
    if (rect.left - W - 24 > 0 && rect.width < vw * 0.6) return `left: ${rect.left - W - 16}px; top: ${Math.min(Math.max(12, rect.top + 40), vh - 260)}px;`
    const left = Math.min(Math.max(12, rect.left + rect.width / 2 - W / 2), vw - W - 12)
    if (rect.bottom + 240 < vh) return `left: ${left}px; top: ${rect.bottom + 14}px;`
    return `left: ${left}px; top: ${Math.max(12, rect.top + 60)}px;`
  })

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') finishTour()
    else if (e.key === 'ArrowRight' || e.key === 'Enter') next()
    else if (e.key === 'ArrowLeft') back()
    else return
    e.preventDefault()
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title">
  {#if rect}
    <div class="hole" style="left: {rect.left - 6}px; top: {rect.top - 6}px; width: {rect.width + 12}px; height: {rect.height + 12}px;"></div>
  {:else}
    <div class="dim"></div>
  {/if}
  <div class="card neon-panel" style={card}>
    <div class="count mono">{i + 1} / {steps.length}</div>
    <h2 id="tour-title">{step.title}</h2>
    <p>{step.text}</p>
    <div class="dots" aria-hidden="true">
      {#each steps as _, j (j)}<span class:on={j === i}></span>{/each}
    </div>
    <div class="acts">
      <button class="ghost" onclick={finishTour}>{i === steps.length - 1 ? 'Close' : 'Skip'}</button>
      <span class="sp"></span>
      {#if i > 0}<button class="ghost" onclick={back}>Back</button>{/if}
      <button class="primary" onclick={next}>{i === steps.length - 1 ? 'Start printing' : 'Next'}</button>
    </div>
  </div>
</div>

<style>
  .tour {
    position: fixed;
    inset: 0;
    z-index: 120;
  }
  .dim {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
  }
  .hole {
    position: absolute;
    border-radius: 10px;
    border: 2px solid var(--accent);
    box-shadow:
      0 0 0 9999px rgba(0, 0, 0, 0.6),
      0 0 24px rgba(var(--accent-rgb), 0.55);
    transition: all 0.25s ease;
    pointer-events: none;
  }
  .card {
    position: absolute;
    width: 360px;
    padding: 16px 18px 14px;
    transition:
      left 0.25s ease,
      top 0.25s ease;
  }
  .count {
    font-size: 10px;
    color: var(--faint);
    letter-spacing: 0.1em;
  }
  h2 {
    margin: 4px 0 8px;
    font-size: 17px;
    color: var(--accent);
  }
  p {
    margin: 0;
    font-size: 13px;
    line-height: 1.55;
    color: var(--text);
  }
  .dots {
    display: flex;
    gap: 5px;
    margin: 14px 0 12px;
  }
  .dots span {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--border-strong);
  }
  .dots span.on {
    width: 18px;
    border-radius: 3px;
    background: var(--accent);
    box-shadow: var(--glow-sm);
  }
  .acts {
    display: flex;
    gap: 6px;
  }
  .sp {
    flex: 1;
  }
  .acts button {
    height: 30px;
    padding: 0 12px;
  }
</style>
