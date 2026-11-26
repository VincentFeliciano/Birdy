import * as THREE from 'three'
import { exportModel } from '../engine/exporters/exportModel'
import { openModelFile, ws } from '../features/workspace/store.svelte'

/** Builds a small printable sample (a torus knot, ~70 mm) as a real binary STL and opens it. */
export async function openSample() {
  const mesh = new THREE.Mesh(new THREE.TorusKnotGeometry(22, 7, 220, 28, 2, 3))
  const data = exportModel(mesh, 'stl')
  mesh.geometry.dispose()
  await openModelFile({ name: 'sample-knot.stl', format: 'stl', size: data.byteLength, data })
}

export function installDemo() {
  window.__demo = async () => {
    await openSample()
    ws.layout = 'split'
  }
  window.__setLayout = (l: string) => {
    if (l === 'browse' || l === 'split' || l === 'workspace' || l === 'library') ws.layout = l
  }
}
