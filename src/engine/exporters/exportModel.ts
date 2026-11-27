import * as THREE from 'three'
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js'
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js'
import type { ExportFormat } from '../../types/ipc'
import { worldPositions, write3mf } from './threemf'

/**
 * Bakes the model's current scene transform into copies of its geometry so the exported
 * file matches what is on screen. The loaded original is left untouched.
 */
function bakedCopy(root: THREE.Object3D) {
  root.updateMatrixWorld(true)
  const out = new THREE.Group()
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    let geo = mesh.geometry.clone()
    if (geo.index) geo = geo.toNonIndexed()
    geo.applyMatrix4(mesh.matrixWorld)
    // A mirrored transform flips triangle winding; swap two corners so normals point outward again.
    if (mesh.matrixWorld.determinant() < 0) {
      const pos = geo.getAttribute('position') as THREE.BufferAttribute
      for (let i = 0; i < pos.count; i += 3) {
        const bx = pos.getX(i + 1), by = pos.getY(i + 1), bz = pos.getZ(i + 1)
        pos.setXYZ(i + 1, pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2))
        pos.setXYZ(i + 2, bx, by, bz)
      }
    }
    geo.deleteAttribute('normal')
    geo.computeVertexNormals()
    out.add(new THREE.Mesh(geo))
  })
  return out
}

export function exportModel(root: THREE.Object3D, format: ExportFormat, title?: string): Uint8Array {
  if (format === '3mf') {
    // One object per part on the plate, so slicers keep them apart.
    const parts = root.children.filter((c) => c.visible && c.type !== 'Points')
    const list = (parts.length ? parts : [root]).map((part, i) => ({
      name: part.name || `Part ${i + 1}`,
      positions: worldPositions(part),
      color: (part.userData as { color?: string }).color,
    }))
    return write3mf(list, title)
  }
  const baked = bakedCopy(root)
  try {
    if (format === 'stl') {
      const view = new STLExporter().parse(baked, { binary: true }) as DataView
      return new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
    }
    return new TextEncoder().encode(new OBJExporter().parse(baked))
  } finally {
    baked.traverse((o) => (o as THREE.Mesh).geometry?.dispose())
  }
}
