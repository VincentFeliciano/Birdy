// Neon accent themes. The chosen accent drives every glowing line in the UI and viewport.
export const ACCENTS = [
  { id: 'volt', name: 'Volt yellow', hex: '#F5C400' },
  { id: 'cyan', name: 'Cyber cyan', hex: '#22E4FF' },
  { id: 'magenta', name: 'Hot magenta', hex: '#FF2E88' },
  { id: 'red', name: 'Laser red', hex: '#FF3B3B' },
  { id: 'lime', name: 'Acid lime', hex: '#7CFF4F' },
  { id: 'violet', name: 'Ultra violet', hex: '#9B5CFF' },
] as const

export type Accent = (typeof ACCENTS)[number]

const saved = localStorage.getItem('birdy.accent')
export const theme = $state({ accent: (ACCENTS.find((a) => a.id === saved) ?? ACCENTS[0]) as Accent })

const listeners = new Set<(hex: string) => void>()
export function onAccent(fn: (hex: string) => void) {
  listeners.add(fn)
  fn(theme.accent.hex)
  return () => listeners.delete(fn)
}

function rgb(hex: string) {
  const n = parseInt(hex.slice(1), 16)
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`
}

export function applyAccent(a: Accent) {
  theme.accent = a
  localStorage.setItem('birdy.accent', a.id)
  const root = document.documentElement.style
  root.setProperty('--accent', a.hex)
  root.setProperty('--accent-rgb', rgb(a.hex))
  for (const fn of listeners) fn(a.hex)
}

export function cycleAccent() {
  const i = ACCENTS.findIndex((a) => a.id === theme.accent.id)
  applyAccent(ACCENTS[(i + 1) % ACCENTS.length])
}
