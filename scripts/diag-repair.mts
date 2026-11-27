// Diagnostic: node scripts/diag-repair.mts <file.stl>...  Checks, repairs, checks again.
import { readFileSync } from 'node:fs'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { checkPrintability } from '../src/engine/geometry/printCheck.ts'
import { describeRepair, repairMesh } from '../src/engine/geometry/repair.ts'

const bed = { x: 400, y: 400, z: 450 }
const check = (positions: Float32Array) => checkPrintability({ positions, bed, fileWarnings: [], isPointCloud: false })
const brief = (r: ReturnType<typeof check>) =>
  `${r.verdict} [${r.issues.map((i) => i.code).join(',')}] open=${r.stats.openEdges} nonmanifold=${r.stats.nonManifoldEdges} watertight=${r.stats.watertight}`

for (const file of process.argv.slice(2)) {
  const buf = readFileSync(file)
  const geo = new STLLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
  const pos = geo.getAttribute('position').array as Float32Array
  console.log(`\n== ${file} (${pos.length / 9} tris)`)
  console.log('before:', brief(check(pos)))
  let cur = pos
  for (let pass = 1; pass <= 2; pass++) {
    const t = Date.now()
    const { positions, summary } = repairMesh(cur)
    console.log(`repair ${pass} (${Date.now() - t} ms):`, JSON.stringify(summary))
    console.log('  ', describeRepair(summary))
    console.log('after:', brief(check(positions)))
    cur = positions
  }
}

if (process.env.DUMP) {
  const buf = readFileSync(process.argv[2]!)
  const geo = new STLLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
  const { positions: q } = repairMesh(geo.getAttribute('position').array as Float32Array)
  const ids = new Map<string, number>(), pts: string[] = []
  const id = (i: number) => { const k = `${q[i]!.toFixed(4)},${q[i + 1]!.toFixed(4)},${q[i + 2]!.toFixed(4)}`; let v = ids.get(k); if (v === undefined) { v = pts.length; ids.set(k, v); pts.push(k) } return v }
  const cnt = new Map<string, number>(), dir: [number, number][] = []
  for (let t = 0; t < q.length / 9; t++) {
    const a = [id(t * 9), id(t * 9 + 3), id(t * 9 + 6)]
    for (let e = 0; e < 3; e++) { const u = a[e]!, v = a[(e + 1) % 3]!; const k = u < v ? `${u}-${v}` : `${v}-${u}`; cnt.set(k, (cnt.get(k) ?? 0) + 1); dir.push([u, v]) }
  }
  for (const [u, v] of dir) { const k = u < v ? `${u}-${v}` : `${v}-${u}`; if (cnt.get(k) !== 2) console.log(`edge x${cnt.get(k)} ${u}->${v}  ${pts[u]}  ->  ${pts[v]}`) }
}
