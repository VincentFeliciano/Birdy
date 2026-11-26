import * as THREE from 'three'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js'
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { ModelFile } from '../../types/ipc'
import { countTriangles } from '../geometry/stats'

export function defaultMaterial() {
  return new THREE.MeshStandardMaterial({
    color: '#B9BFC7',
    roughness: 0.55,
    metalness: 0.05,
    side: THREE.DoubleSide,
  })
}

function hasUsableNormals(geo: THREE.BufferGeometry) {
  const n = geo.getAttribute('normal')
  if (!n) return false
  for (let i = 0; i < Math.min(n.count, 64); i++) if (n.getX(i) || n.getY(i) || n.getZ(i)) return true
  return false
}

function meshFromGeometry(geo: THREE.BufferGeometry) {
  if (!hasUsableNormals(geo)) geo.computeVertexNormals()
  const mat = defaultMaterial()
  if (geo.getAttribute('color')) mat.vertexColors = true
  return new THREE.Mesh(geo, mat)
}

/** Spots STL files whose size doesn't match their declared triangle count (truncated/corrupt). */
function stlWarnings(buf: ArrayBuffer): string[] {
  if (buf.byteLength < 84) return ['The STL file is shorter than a valid header.']
  const head = new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(buf.byteLength, 512))).trimStart()
  const declared = new DataView(buf).getUint32(80, true)
  const expected = 84 + declared * 50
  if (expected === buf.byteLength) return []
  if (head.startsWith('solid')) {
    const text = new TextDecoder().decode(buf)
    if (!/endsolid/.test(text.slice(-2048))) return ['The ASCII STL ends without "endsolid"; the file is probably truncated.']
    return []
  }
  if (buf.byteLength < expected) {
    return [`The STL declares ${declared.toLocaleString()} triangles but only ${Math.floor((buf.byteLength - 84) / 50).toLocaleString()} are present. The download is truncated or corrupt.`]
  }
  return [`The STL has ${(buf.byteLength - expected).toLocaleString()} unexpected trailing bytes.`]
}

export interface ParsedModel {
  root: THREE.Object3D
  warnings: string[]
}

/**
 * Parses an untrusted model file into a scene object. Throws a readable error for
 * empty or corrupt files. A file that loads is not necessarily printable.
 */
export async function parseModel(file: ModelFile): Promise<ParsedModel> {
  const bytes = file.data
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  if (buf.byteLength === 0) throw new Error('The file is empty.')

  let root: THREE.Object3D
  const warnings: string[] = []
  switch (file.format) {
    case 'stl':
      warnings.push(...stlWarnings(buf))
      root = meshFromGeometry(new STLLoader().parse(buf))
      break
    case 'ply': {
      const geo = new PLYLoader().parse(buf)
      // PLY files with faces come back indexed; without faces they are point clouds.
      if (geo.index) root = meshFromGeometry(geo)
      else root = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.6, color: '#B9BFC7' }))
      break
    }
    case 'obj': {
      root = new OBJLoader().parse(new TextDecoder().decode(buf))
      // OBJ without a material library gets flat white; use the workspace material instead.
      root.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (mesh.isMesh) {
          if (!hasUsableNormals(mesh.geometry)) mesh.geometry.computeVertexNormals()
          mesh.material = defaultMaterial()
        }
      })
      break
    }
    case '3mf':
      root = new ThreeMFLoader().parse(buf)
      break
    case 'glb':
    case 'gltf': {
      const gltf = await new GLTFLoader().parseAsync(file.format === 'gltf' ? new TextDecoder().decode(buf) : buf, '')
      root = gltf.scene
      // glTF is Y-up; stand it upright on the Z-up build plate.
      root.rotation.x = Math.PI / 2
      break
    }
    default:
      throw new Error(`Unsupported format: ${file.format}`)
  }

  if (countTriangles(root) === 0 && !(root as THREE.Points).isPoints) {
    throw new Error('The file contains no triangles.')
  }
  const box = new THREE.Box3().setFromObject(root)
  if (box.isEmpty() || !Number.isFinite(box.min.x) || !Number.isFinite(box.max.x)) {
    throw new Error('The file has no valid geometry.')
  }
  return { root, warnings }
}
