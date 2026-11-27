// Run with: node tests/cost.test.mts
import assert from 'node:assert/strict'
import { costOf, type Prices } from '../src/app/cost.ts'

const p: Prices = { currency: '$', filamentKg: 25, resinL: 40, kwh: 0, fdmWatts: 120, resinWatts: 60 }
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`)

near(costOf(p, 'fdm', 200, 3600)!.total, 5)
near(costOf(p, 'resin', 50, 3600)!.total, 2)
assert.equal(costOf(p, 'fdm', null, 3600), null)
// Electricity: 120 W for 10 h at 0.30/kWh = 0.36 on top of the filament.
const c = costOf({ ...p, kwh: 0.3 }, 'fdm', 100, 36000)!
near(c.material, 2.5)
near(c.power, 0.36)
near(c.total, 2.86)
console.log('cost tests passed')
