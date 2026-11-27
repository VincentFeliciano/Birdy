// What a print costs: material plus (optionally) electricity.

export interface Prices {
  currency: string
  /** Per kilogram of filament. */
  filamentKg: number
  /** Per litre of resin. */
  resinL: number
  /** Per kWh; 0 leaves electricity out. */
  kwh: number
  fdmWatts: number
  resinWatts: number
}

export interface Cost {
  material: number
  power: number
  total: number
}

/** Pure cost maths, with the prices passed in (for tests). */
export function costOf(p: Prices, kind: 'fdm' | 'resin', amount: number | null, seconds: number | null): Cost | null {
  if (amount === null || !Number.isFinite(amount)) return null
  // Filament is weighed in grams, resin measured in millilitres.
  const material = kind === 'fdm' ? (amount / 1000) * p.filamentKg : (amount / 1000) * p.resinL
  const watts = kind === 'fdm' ? p.fdmWatts : p.resinWatts
  const power = seconds && p.kwh > 0 ? (watts / 1000) * (seconds / 3600) * p.kwh : 0
  return { material, power, total: material + power }
}
