// Run with: node tests/printCheck.test.mts  (Node 22.6+ strips the types)
import assert from 'node:assert/strict'
import { checkPrintability } from '../src/engine/geometry/printCheck.ts'

const BED = { x: 256, y: 256, z: 256 }

/** Closed, outward-facing cube from (x0,y0,z0) with side s, as non-indexed triangles. */
function cube(s = 20, x0 = 0, y0 = 0, z0 = 0, dropFace = -1, flip = false): number[] {
  const v = (x: number, y: number, z: number) => [x0 + x * s, y0 + y * s, z0 + z * s]
  const quads = [
    [v(0, 0, 0), v(0, 1, 0), v(1, 1, 0), v(1, 0, 0)], // bottom (normal -z)
    [v(0, 0, 1), v(1, 0, 1), v(1, 1, 1), v(0, 1, 1)], // top
    [v(0, 0, 0), v(1, 0, 0), v(1, 0, 1), v(0, 0, 1)], // front (-y)
    [v(0, 1, 0), v(0, 1, 1), v(1, 1, 1), v(1, 1, 0)], // back
    [v(0, 0, 0), v(0, 0, 1), v(0, 1, 1), v(0, 1, 0)], // left (-x)
    [v(1, 0, 0), v(1, 1, 0), v(1, 1, 1), v(1, 0, 1)], // right
  ]
  const out: number[] = []
  quads.forEach((q, i) => {
    if (i === dropFace) return
    const tris = [
      [q[0], q[1], q[2]],
      [q[0], q[2], q[3]],
    ]
    for (const t of tris) for (const p of flip ? [t[0], t[2], t[1]] : t) out.push(...p)
  })
  return out
}

const run = (pos: number[], warnings: string[] = []) =>
  checkPrintability({ positions: new Float32Array(pos), bed: BED, fileWarnings: warnings, isPointCloud: false })

const codes = (r: ReturnType<typeof run>) => r.issues.map((i) => i.code).sort()

// 1. Clean closed cube on the plate.
let r = run(cube())
assert.equal(r.verdict, 'ready', JSON.stringify(r.issues))
assert.equal(r.stats.watertight, true)
assert.equal(r.stats.components, 1)
assert.ok(Math.abs((r.stats.volumeCm3 ?? 0) - 8) < 1e-6, `volume ${r.stats.volumeCm3}`)
console.log('ok  clean cube is ready, 8 cm³')

// 2. Missing top face => holes.
r = run(cube(20, 0, 0, 0, 1))
assert.equal(r.verdict, 'fail')
assert.ok(codes(r).includes('holes'))
assert.equal(r.stats.openEdges, 4)
console.log('ok  missing face => holes, 4 open edges')

// 3. Too big for the bed.
r = run(cube(300))
assert.ok(codes(r).includes('bed'))
assert.equal(r.verdict, 'fail')
console.log("ok  300 mm cube doesn't fit 256 mm bed")

// 4. Floating above plate.
r = run(cube(20, 0, 0, 5))
assert.ok(codes(r).includes('above'))
assert.equal(r.verdict, 'attention')
console.log('ok  floating cube => needs attention')

// 5. Corrupt numbers.
const bad = cube()
bad[4] = NaN
r = run(bad)
assert.ok(codes(r).includes('nan'))
assert.equal(r.verdict, 'fail')
console.log('ok  NaN vertex => corrupt')

// 6. Inside-out cube.
r = run(cube(20, 0, 0, 0, -1, true))
assert.ok(codes(r).includes('inverted'), JSON.stringify(codes(r)))
console.log('ok  inside-out cube detected')

// 7. Two parts, one in mid-air (an overhanging floating block).
r = run([...cube(20), ...cube(10, 40, 0, 30)])
assert.equal(r.stats.components, 2)
assert.ok(codes(r).includes('floating'))
console.log('ok  floating second part detected')

// 8. Truncated file warning passes through.
r = run(cube(), ['truncated'])
assert.equal(r.verdict, 'attention')
console.log('ok  file warnings surface')

// 9. Tiny model (probably metres).
r = run(cube(0.5))
assert.ok(codes(r).includes('tiny'))
console.log('ok  tiny model flagged for units')

// 10. Problem locations: the hole sits where the missing top face was.
r = run(cube(20, 0, 0, 0, 1))
const holes = r.marks?.holeCenters
assert.ok(holes && holes.length === 4, `holes ${holes?.length}`)
assert.ok(Math.abs(holes[0] - 10) < 1e-4 && Math.abs(holes[1] - 10) < 1e-4 && Math.abs(holes[2] - 20) < 1e-4, `center ${[...holes]}`)
assert.ok(Math.abs(holes[3] - Math.hypot(10, 10)) < 1e-3, `radius ${holes[3]}`)
assert.equal(r.marks?.openEdges?.length, 4 * 6)
assert.equal(r.issues.find((i) => i.code === 'holes')?.mark, 'openEdges')
console.log('ok  hole located at the open top')

// 11. One face wound the wrong way gets marked, the rest do not.
const oneFlipped = cube()
// Swap two vertices of the first triangle (part of the bottom).
for (let k = 0; k < 3; k++) [oneFlipped[3 + k], oneFlipped[6 + k]] = [oneFlipped[6 + k], oneFlipped[3 + k]]
r = run(oneFlipped)
assert.ok(codes(r).includes('flipped'))
assert.equal(r.marks?.flippedFaces?.length, 9, `flipped ${r.marks?.flippedFaces?.length}`)
assert.ok(r.marks!.flippedFaces!.every((v, i) => i % 3 !== 2 || v === 0), 'flipped face is on the bottom')
assert.equal(r.issues.find((i) => i.code === 'flipped')?.mark, 'flippedFaces')
console.log('ok  flipped face marked')

// 12. A clean cube carries no marks.
r = run(cube())
assert.ok(Object.values(r.marks ?? {}).every((m) => !m), JSON.stringify(Object.keys(r.marks ?? {})))
console.log('ok  clean cube has no marks')

console.log('\nall print-check tests passed')
