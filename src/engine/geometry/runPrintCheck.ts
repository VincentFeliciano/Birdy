import * as THREE from 'three'
import type { BedSize, PrintReport } from './printCheck'

let worker: Worker | null = null
let seq = 0
const pending = new Map<number, { resolve: (r: PrintReport) => void; reject: (e: Error) => void }>()

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./printCheck.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<{ id: number; report?: PrintReport; error?: string }>) => {
      const job = pending.get(e.data.id)
      if (!job) return
      pending.delete(e.data.id)
      if (e.data.report) job.resolve(e.data.report)
      else job.reject(new Error(e.data.error ?? 'Print check failed'))
    }
  }
  return worker
}

/** Flattens every mesh into world-space triangle positions, as the printer would see it. */
export function worldTriangles(root: THREE.Object3D) {
  root.updateMatrixWorld(true)
  const chunks: Float32Array[] = []
  let total = 0
  let points = false
  const v = new THREE.Vector3()
  root.traverse((o) => {
    if ((o as THREE.Points).isPoints) points = true
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined
    if (!pos) return
    const index = mesh.geometry.index
    const count = index ? index.count : pos.count
    const out = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      v.fromBufferAttribute(pos, index ? index.getX(i) : i).applyMatrix4(mesh.matrixWorld)
      out[i * 3] = v.x
      out[i * 3 + 1] = v.y
      out[i * 3 + 2] = v.z
    }
    chunks.push(out)
    total += out.length
  })
  const all = new Float32Array(total)
  let off = 0
  for (const c of chunks) {
    all.set(c, off)
    off += c.length
  }
  return { positions: all, isPointCloud: points && total === 0 }
}

export function runPrintCheck(root: THREE.Object3D, bed: BedSize, fileWarnings: string[], minWall?: number): Promise<PrintReport> {
  const { positions, isPointCloud } = worldTriangles(root)
  const id = ++seq
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    getWorker().postMessage({ id, input: { positions, bed, fileWarnings, isPointCloud, minWall } }, [positions.buffer])
  })
}
