import * as THREE from 'three'
import type { ModelsEntry } from '../../types/ipc'
import { parseModel } from '../../engine/loaders/loadModel'
import { models } from './store.svelte'

// Thumbnails for the Models panel, rendered one at a time with a small offscreen renderer and
// cached by the main process, so each file is only rendered once per version.

const SIZE = 192
/** Bigger files get an icon instead; parsing them just for a thumbnail would stall the UI. */
const MAX_BYTES = 40 * 1024 * 1024

const queue: ModelsEntry[] = []
const failed = new Set<string>()
let running = false
let renderer: THREE.WebGLRenderer | null = null

export function queueThumbs(entries: ModelsEntry[]) {
  for (const e of entries) {
    const key = `${e.rel}|${e.mtime}`
    if (models.thumbs[e.rel] || failed.has(key) || queue.some((q) => q.rel === e.rel)) continue
    queue.push(e)
  }
  if (!running) void run()
}

async function run() {
  running = true
  try {
    while (queue.length) {
      const e = queue.shift()!
      const key = `${e.rel}|${e.mtime}`
      try {
        const cached = await window.api.models.getThumb(e.rel)
        if (cached) {
          models.thumbs[e.rel] = cached
          continue
        }
        if (e.size > MAX_BYTES) {
          failed.add(key)
          continue
        }
        const url = await render(e.rel)
        if (url) {
          models.thumbs[e.rel] = url
          window.api.models.saveThumb(e.rel, url)
        } else failed.add(key)
      } catch {
        failed.add(key)
      }
      // Let the UI breathe between files.
      await new Promise((r) => setTimeout(r, 16))
    }
  } finally {
    running = false
  }
}

async function render(rel: string): Promise<string | null> {
  const file = await window.api.models.read(rel)
  const { root } = await parseModel(file)
  try {
    renderer ??= new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
    renderer.setSize(SIZE, SIZE, false)
    renderer.setClearColor(0x000000, 0)
    renderer.toneMapping = THREE.ACESFilmicToneMapping

    const scene = new THREE.Scene()
    scene.add(root)
    scene.add(new THREE.HemisphereLight(0xffffff, 0x30343c, 1.6))
    const key = new THREE.DirectionalLight(0xffffff, 2.2)
    key.position.set(1, -1.5, 2)
    scene.add(key)

    const box = new THREE.Box3().setFromObject(root, true)
    if (box.isEmpty()) return null
    const sphere = box.getBoundingSphere(new THREE.Sphere())
    const camera = new THREE.PerspectiveCamera(30, 1, 0.01, sphere.radius * 20)
    camera.up.set(0, 0, 1)
    const dir = new THREE.Vector3(1, -1.25, 0.85).normalize()
    const dist = sphere.radius / Math.sin(THREE.MathUtils.degToRad(15)) * 1.05
    camera.position.copy(sphere.center).addScaledVector(dir, dist)
    camera.lookAt(sphere.center)
    key.position.copy(camera.position).add(new THREE.Vector3(0, 0, sphere.radius * 2))

    renderer.render(scene, camera)
    return renderer.domElement.toDataURL('image/webp', 0.85)
  } finally {
    root.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh && !(o as THREE.Points).isPoints) return
      mesh.geometry?.dispose()
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) m?.dispose()
    })
  }
}
