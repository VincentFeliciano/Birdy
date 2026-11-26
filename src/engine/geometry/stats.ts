import * as THREE from 'three'

export interface ModelStats {
  size: { x: number; y: number; z: number }
  min: { x: number; y: number; z: number }
  triangles: number
  meshes: number
}

export function countTriangles(root: THREE.Object3D) {
  let tris = 0
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const g = mesh.geometry
    tris += Math.floor((g.index ? g.index.count : (g.getAttribute('position')?.count ?? 0)) / 3)
  })
  return tris
}

export function countMeshes(root: THREE.Object3D) {
  let n = 0
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh || (o as THREE.Points).isPoints) n++
  })
  return n
}

/** World-space bounding dimensions. `precise` walks every vertex (exact under rotation). */
export function measure(root: THREE.Object3D, triangles: number, meshes: number, precise: boolean): ModelStats {
  root.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(root, precise)
  const size = box.getSize(new THREE.Vector3())
  return {
    size: { x: size.x, y: size.y, z: size.z },
    min: { x: box.min.x, y: box.min.y, z: box.min.z },
    triangles,
    meshes,
  }
}
