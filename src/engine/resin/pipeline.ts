// Slicing with Boaty's own supports: add them, slice, and when a drain hole lands on pins, move
// those pins to a ring around the hole and slice again with the hole where it was.

import { sliceResin, type ResinJob, type ResinOutput } from './slice.ts'
import { generateSupports, type SupportResult, type SupportSettings } from './supports.ts'

export interface SupportedOutput extends ResinOutput {
  support?: SupportResult
}

export function sliceSupported(
  job: Omit<ResinJob, 'positions'>,
  model: Float32Array,
  supports: SupportSettings | undefined,
  progress?: (done: number) => boolean | void,
): SupportedOutput {
  if (!supports?.enabled) return sliceResin({ ...job, positions: model }, progress)
  let gen = generateSupports(model, supports)
  const twoPass = !!job.hollow?.drain
  const part = (from: number, span: number) => (progress ? (d: number) => progress(from + d * span) : undefined)
  let out = sliceResin({ ...job, positions: gen.positions }, part(0, twoPass ? 0.5 : 1))
  if (job.hollow && out.hollow?.centres.length) {
    const r = job.hollow.diameter / 2
    const holes = out.hollow.centres.map(([x, y]) => ({ x, y, r }))
    const tip = Math.max(0.1, Math.min(1.5, supports.tip)) / 2
    const c = gen.contacts
    let hit = false
    for (let i = 0; i < c.length && !hit; i += 2) hit = holes.some((d) => Math.hypot(c[i]! - d.x, c[i + 1]! - d.y) <= d.r + tip + 0.3)
    if (hit) {
      gen = generateSupports(model, supports, holes)
      out = sliceResin({ ...job, positions: gen.positions, hollow: { ...job.hollow, at: out.hollow.centres } }, part(0.5, 0.5))
    }
  }
  progress?.(1)
  return { ...out, support: gen }
}
