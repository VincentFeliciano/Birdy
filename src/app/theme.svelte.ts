// Neon accent themes. The chosen accent drives every glowing line in the UI, the logo and the viewport.
export const ACCENTS = [
  { id: 'volt', name: 'Mustard yellow', hex: '#F5C400' },
  { id: 'amber', name: 'Sunset amber', hex: '#FF9F1A' },
  { id: 'red', name: 'Laser red', hex: '#FF3B3B' },
  { id: 'magenta', name: 'Hot magenta', hex: '#FF2E88' },
  { id: 'violet', name: 'Ultra violet', hex: '#9B5CFF' },
  { id: 'cyan', name: 'Cyber cyan', hex: '#22E4FF' },
  { id: 'lime', name: 'Acid lime', hex: '#7CFF4F' },
  { id: 'white', name: 'Ice white', hex: '#E8F1FF' },
] as const

export interface Accent {
  id: string
  name: string
  hex: string
}

const HEX = /^#[0-9a-f]{6}$/i
const savedId = localStorage.getItem('birdy.accent')
const savedCustom = localStorage.getItem('birdy.accentCustom')

function initial(): Accent {
  if (savedId === 'custom' && savedCustom && HEX.test(savedCustom)) return { id: 'custom', name: 'Custom', hex: savedCustom }
  return ACCENTS.find((a) => a.id === savedId) ?? ACCENTS[0]
}

export const theme = $state({ accent: initial() as Accent, panelOpen: false })

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
  if (!HEX.test(a.hex)) return
  theme.accent = a
  localStorage.setItem('birdy.accent', a.id)
  if (a.id === 'custom') localStorage.setItem('birdy.accentCustom', a.hex)
  const root = document.documentElement.style
  root.setProperty('--accent', a.hex)
  root.setProperty('--accent-rgb', rgb(a.hex))
  // The new-tab page is a separate document; the main process restyles it.
  void window.api?.theme?.setAccent(a.hex)
  for (const fn of listeners) fn(a.hex)
}

/** Any colour from the picker. */
export function applyCustomAccent(hex: string) {
  applyAccent({ id: 'custom', name: 'Custom', hex: hex.toUpperCase() })
}

export function cycleAccent() {
  const i = ACCENTS.findIndex((a) => a.id === theme.accent.id)
  applyAccent(ACCENTS[(i + 1) % ACCENTS.length]!)
}
