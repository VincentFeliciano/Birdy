// The user's own prices for cost estimates.
import { costOf, type Prices } from './cost'

export type { Prices } from './cost'

const DEFAULTS: Prices = { currency: '$', filamentKg: 20, resinL: 35, kwh: 0, fdmWatts: 120, resinWatts: 60 }

function load(): Prices {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('birdy.prices') ?? '{}') }
  } catch {
    return { ...DEFAULTS }
  }
}

export const prices = $state<Prices>(load())

export function setPrice<K extends keyof Prices>(key: K, value: Prices[K]) {
  prices[key] = value
  localStorage.setItem('birdy.prices', JSON.stringify(prices))
}

export const printCost = (kind: 'fdm' | 'resin', amount: number | null, seconds: number | null) => costOf(prices, kind, amount, seconds)

export function fmtMoney(v: number | null | undefined) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  return `${prices.currency}${v < 10 ? v.toFixed(2) : v.toFixed(1)}`
}
