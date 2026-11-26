<script lang="ts">
  let {
    axis,
    value,
    unit = '',
    digits = 2,
    step = 1,
    label = '',
    onCommit,
  }: {
    axis: 'x' | 'y' | 'z'
    value: number
    unit?: string
    digits?: number
    step?: number
    label?: string
    onCommit: (v: number) => void
  } = $props()

  let editing = $state(false)
  let text = $state('')
  let el: HTMLInputElement

  const fmt = (n: number) => (Number.isFinite(n) ? Number(n.toFixed(digits)).toString() : '')

  function commit() {
    if (!editing) return
    editing = false
    const n = parseFloat(text)
    if (Number.isFinite(n) && Math.abs(n - value) > 1e-9) onCommit(n)
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter') el.blur()
    else if (e.key === 'Escape') {
      editing = false
      el.blur()
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      const base = editing ? parseFloat(text) : value
      const n = (Number.isFinite(base) ? base : 0) + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1)
      text = fmt(n)
      onCommit(n)
    }
  }
</script>

<label class="field" data-axis={axis} title={label ? `${label} ${axis.toUpperCase()}` : undefined}>
  <span class="axis mono">{axis.toUpperCase()}</span>
  <input
    bind:this={el}
    class="mono"
    inputmode="decimal"
    spellcheck="false"
    value={editing ? text : fmt(value)}
    aria-label={`${label} ${axis.toUpperCase()}`}
    oninput={(e) => (text = e.currentTarget.value)}
    onfocus={() => {
      editing = true
      text = fmt(value)
      queueMicrotask(() => el.select())
    }}
    onblur={commit}
    onkeydown={onKey} />
  {#if unit}<span class="unit mono">{unit}</span>{/if}
</label>

<style>
  .field {
    display: flex;
    align-items: center;
    height: 28px;
    min-width: 0;
    border-radius: var(--r-sm);
    background: var(--surface);
    border: 1px solid var(--border);
    overflow: hidden;
    transition: border-color 0.12s, box-shadow 0.12s;
  }
  .field:focus-within {
    border-color: var(--neon-line);
    box-shadow: var(--glow-sm);
  }
  .axis {
    width: 18px;
    flex: none;
    text-align: center;
    font-size: 10px;
    font-weight: 700;
    align-self: stretch;
    display: grid;
    place-items: center;
  }
  [data-axis='x'] .axis {
    color: #ff5a64;
    text-shadow: 0 0 6px rgba(255, 90, 100, 0.7);
  }
  [data-axis='y'] .axis {
    color: #4be38a;
    text-shadow: 0 0 6px rgba(75, 227, 138, 0.7);
  }
  [data-axis='z'] .axis {
    color: #4aa3ff;
    text-shadow: 0 0 6px rgba(74, 163, 255, 0.7);
  }
  input {
    flex: 1;
    min-width: 0;
    width: 100%;
    height: 100%;
    padding: 0 4px;
    background: none;
    border: 0;
    outline: none;
    font-size: 12px;
    user-select: text;
  }
  .unit {
    padding-right: 6px;
    font-size: 10px;
    color: var(--faint);
  }
</style>
