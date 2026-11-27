import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import type { GcodePreview } from '../gcode/parseGcode'
import type { MarkKey, PrintMarks } from '../geometry/printCheck'

// 3D printing convention: Z is up, the build plate is the XY plane, units are millimetres.
THREE.Object3D.DEFAULT_UP.set(0, 0, 1)

export type Tool = 'select' | 'move' | 'rotate' | 'scale'
export type ViewPreset = 'iso' | 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom'
export type Projection = 'perspective' | 'orthographic'

/** Straight grid lines over a w x d plate centred on the origin, every `step` mm. */
function gridLines(w: number, d: number, step: number, z: number): THREE.BufferGeometry {
  const pts: number[] = []
  const hw = w / 2
  const hd = d / 2
  for (let x = 0; x <= w + 1e-6; x += step) pts.push(x - hw, -hd, z, x - hw, hd, z)
  for (let y = 0; y <= d + 1e-6; y += step) pts.push(-hw, y - hd, z, hw, y - hd, z)
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  return g
}

const VIEW_DIRS: Record<ViewPreset, THREE.Vector3> = {
  iso: new THREE.Vector3(1, -1.25, 0.95),
  front: new THREE.Vector3(0, -1, 0),
  back: new THREE.Vector3(0, 1, 0),
  left: new THREE.Vector3(-1, 0, 0),
  right: new THREE.Vector3(1, 0, 0),
  // A hair off-axis so orbit controls keep a stable "up" when looking straight down/up.
  top: new THREE.Vector3(0, -0.0001, 1),
  bottom: new THREE.Vector3(0, -0.0001, -1),
}

/** Highlight colours for problem areas (HDR where they should glow). */
export const MARK_STYLE: Record<MarkKey, { color: string; kind: 'edges' | 'faces' | 'points' }> = {
  openEdges: { color: '#FF3344', kind: 'edges' },
  holeCenters: { color: '#FF3344', kind: 'points' },
  nonManifoldEdges: { color: '#FF8A1F', kind: 'edges' },
  flippedFaces: { color: '#FF2BD6', kind: 'faces' },
  degenerate: { color: '#FFE14D', kind: 'points' },
  overhangFaces: { color: '#3E8EF7', kind: 'faces' },
  belowFaces: { color: '#FF3344', kind: 'faces' },
  floatingFaces: { color: '#A86BFF', kind: 'faces' },
  intersectFaces: { color: '#C04DFF', kind: 'faces' },
  thinFaces: { color: '#FFC21A', kind: 'faces' },
}
/** Shown without being asked for: problems with the mesh itself. */
const DEFAULT_MARKS: MarkKey[] = ['openEdges', 'holeCenters', 'nonManifoldEdges', 'flippedFaces', 'degenerate']
/** Hole rings drawn when nothing is focused; the biggest holes come first. */
const DEFAULT_RINGS = 60

/** Problems small enough to need a ring around them to be found. */
const BEACON_MARKS = new Set<MarkKey>(['nonManifoldEdges', 'flippedFaces', 'degenerate'])

/** Centres of groups of nearby points (vertices within one `cell` of each other), most points first. */
function clusterCenters(data: Float32Array, cell: number, max: number) {
  const c = Math.max(cell, 1e-3)
  const cells = new Map<string, { x: number; y: number; z: number; n: number }>()
  for (let i = 0; i + 2 < data.length; i += 3) {
    const k = `${Math.floor(data[i]! / c)},${Math.floor(data[i + 1]! / c)},${Math.floor(data[i + 2]! / c)}`
    const g = cells.get(k)
    if (g) {
      g.x += data[i]!
      g.y += data[i + 1]!
      g.z += data[i + 2]!
      g.n++
    } else cells.set(k, { x: data[i]!, y: data[i + 1]!, z: data[i + 2]!, n: 1 })
  }
  // Neighbouring cells split one spot in two; fold anything within a cell of a kept centre into it.
  const out: { p: THREE.Vector3; n: number }[] = []
  for (const g of [...cells.values()].sort((a, b) => b.n - a.n)) {
    const p = new THREE.Vector3(g.x / g.n, g.y / g.n, g.z / g.n)
    const near = out.find((o) => o.p.distanceTo(p) < c * 1.5)
    if (near) {
      near.p.multiplyScalar(near.n).addScaledVector(p, g.n).divideScalar(near.n + g.n)
      near.n += g.n
    } else if (out.length < max) out.push({ p, n: g.n })
  }
  return out.map((o) => o.p)
}

let ringTexture: THREE.Texture | null = null
function getRingTexture() {
  if (ringTexture) return ringTexture
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  g.strokeStyle = '#fff'
  g.lineWidth = 6
  g.beginPath()
  g.arc(32, 32, 26, 0, Math.PI * 2)
  g.stroke()
  ringTexture = new THREE.CanvasTexture(c)
  return ringTexture
}

/** Owns the WebGL canvas, cameras, controls, the build plate and the active model. */
export class Viewer {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  private persp = new THREE.PerspectiveCamera(40, 1, 0.1, 50000)
  private ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -50000, 50000)
  private camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = this.persp
  private controls: OrbitControls
  private gizmo: TransformControls
  private bed = new THREE.Group()
  private neon = new THREE.Group()
  private accent = new THREE.Color('#F5C400')
  private bboxHelper = new THREE.Box3Helper(new THREE.Box3(), new THREE.Color('#F5C400'))
  private composer: EffectComposer
  private renderPass: RenderPass
  private bloom: UnrealBloomPass
  private model: THREE.Object3D | null = null
  private tool: Tool = 'move'
  private orthoHalf = 150
  private raf = 0
  private ro: ResizeObserver
  private showBBox = true
  private bedW = 256
  private bedD = 256
  private preview: THREE.Group | null = null
  private pvLayers: THREE.LineSegments | null = null
  private pvTop: THREE.LineSegments | null = null
  private pvTravel: THREE.LineSegments | null = null
  private pvData: GcodePreview | null = null
  private pvLayer = 0
  /** Problem highlights, drawn in the space the check measured and moved along with the model. */
  private marks = new THREE.Group()
  /** Hole rings live in world space so they keep their screen size. */
  private rings = new THREE.Group()
  private ringCenters: THREE.Vector3[] = []
  private markAtInv = new THREE.Matrix4()
  private markPulse: { mat: THREE.Material & { opacity: number }; base: number }[] = []
  private markFocused = false
  /** Resin islands: rings in slice space, carried along with the model like the problem marks. */
  private islands = new THREE.Group()
  /** Support preview: the supports plus raised stand-ins of the model's meshes. */
  private supportView: THREE.Group | null = null
  private islandCenters: THREE.Vector3[] = []
  private islandAtInv = new THREE.Matrix4()
  private islandFocus = -1

  /** Fired while dragging the gizmo (`live`) and once when a drag ends. */
  onTransform: ((live: boolean) => void) | null = null
  /** Fired when a click lands on one of the model's parts (a direct child of the model). */
  onPick: ((part: THREE.Object3D) => void) | null = null
  /** The part the gizmo and bounding box follow: the model itself, or one part on a shared plate. */
  private target: THREE.Object3D | null = null
  private downAt: { x: number; y: number } | null = null

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    container.appendChild(this.renderer.domElement)

    this.scene.background = new THREE.Color('#0D0F13')
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x2a2e34, 1.4))
    const key = new THREE.DirectionalLight(0xffffff, 2.2)
    key.position.set(180, -240, 320)
    const fill = new THREE.DirectionalLight(0xdfe6ff, 0.7)
    fill.position.set(-260, 200, 120)
    const rim = new THREE.DirectionalLight(0xffffff, 0.5)
    rim.position.set(0, 300, -120)
    this.scene.add(key, fill, rim)

    this.buildBed()
    ;(this.bboxHelper.material as THREE.LineBasicMaterial).toneMapped = false
    this.bboxHelper.visible = false
    this.scene.add(this.bboxHelper)

    for (const cam of [this.persp, this.ortho]) cam.up.set(0, 0, 1)
    this.persp.position.set(260, -330, 250)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.12
    this.controls.screenSpacePanning = true
    this.controls.target.set(0, 0, 20)

    this.gizmo = new TransformControls(this.camera, this.renderer.domElement)
    this.gizmo.setSize(0.85)
    this.gizmo.addEventListener('dragging-changed', (e) => {
      this.controls.enabled = !e.value
      if (!e.value) {
        this.updateBBox()
        this.onTransform?.(false)
      }
    })
    this.gizmo.addEventListener('objectChange', () => {
      this.updateBBox(false)
      this.onTransform?.(true)
    })
    this.scene.add(this.gizmo.getHelper())
    // A click (not a drag) on a part selects it.
    const canvas = this.renderer.domElement
    canvas.addEventListener('pointerdown', (e) => {
      this.downAt = e.button === 0 && !this.gizmo.axis ? { x: e.clientX, y: e.clientY } : null
    })
    canvas.addEventListener('pointerup', (e) => {
      const at = this.downAt
      this.downAt = null
      if (!at || Math.hypot(e.clientX - at.x, e.clientY - at.y) > 4 || !this.model || !this.onPick) return
      const part = this.pick(e.clientX, e.clientY)
      if (part) this.onPick(part)
    })
    this.marks.matrixAutoUpdate = false
    this.scene.add(this.marks, this.rings, this.islands)

    // Neon glow: only colours pushed above 1.0 (the HDR neon lines) bloom; the model does not.
    // Its own multisampled target: the renderer's antialias does not reach post-processing, and
    // without it thin lines crawl and flicker as the view moves.
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 })
    this.composer = new EffectComposer(this.renderer, target)
    this.renderPass = new RenderPass(this.scene, this.camera)
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.42, 0.5, 1.0)
    this.composer.addPass(this.renderPass)
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())
    this.setAccent('#F5C400')

    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(container)
    this.resize()
    this.loop()
  }

  private buildBed() {
    for (const child of [...this.bed.children]) {
      if (child === this.neon) continue
      this.bed.remove(child)
      disposeObject(child)
    }
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(this.bedW, this.bedD),
      new THREE.MeshStandardMaterial({ color: '#14171C', roughness: 0.95, metalness: 0, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 4 }),
    )
    plate.position.z = -0.05
    plate.renderOrder = -1
    const minor = new THREE.LineSegments(gridLines(this.bedW, this.bedD, 10, 0.01), new THREE.LineBasicMaterial({ color: '#1F232A', depthWrite: false }))
    // Axis lines from the plate's front-left corner: X red, Y green, Z blue.
    const axes = new THREE.AxesHelper(36)
    axes.position.set(-this.bedW / 2, -this.bedD / 2, 0.02)
    ;(axes.material as THREE.LineBasicMaterial).depthWrite = false
    axes.renderOrder = 2
    const colors = axes.geometry.getAttribute('color') as THREE.BufferAttribute
    const palette = ['#E5484D', '#E5484D', '#46A758', '#46A758', '#3E8EF7', '#3E8EF7'].map((c) => new THREE.Color(c))
    palette.forEach((c, i) => colors.setXYZ(i, c.r, c.g, c.b))
    this.bed.add(plate, minor, axes)
    if (!this.neon.parent) this.bed.add(this.neon)
    if (!this.bed.parent) this.scene.add(this.bed)
  }

  /** Resizes the build plate to a printer's bed (mm). */
  setBedSize(w: number, d: number) {
    if (!(w > 10 && d > 10) || (w === this.bedW && d === this.bedD)) return
    this.bedW = w
    this.bedD = d
    this.buildBed()
    this.setAccent(`#${this.accent.getHexString()}`)
  }

  /** Rebuilds the glowing plate outline and major grid in the current accent colour. */
  setAccent(hex: string) {
    this.accent.set(hex)
    for (const child of [...this.neon.children]) {
      this.neon.remove(child)
      const line = child as THREE.LineSegments
      line.geometry.dispose()
      ;(line.material as THREE.Material).dispose()
    }
    const major = new THREE.LineSegments(
      gridLines(this.bedW, this.bedD, 50, 0.02),
      new THREE.LineBasicMaterial({ color: this.accent, transparent: true, opacity: 0.28, depthWrite: false }),
    )
    // Plate edge drawn in HDR so the bloom pass makes it glow like a neon tube.
    const hw = this.bedW / 2
    const hd = this.bedD / 2
    const edge = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-hw, -hd, 0.03),
        new THREE.Vector3(hw, -hd, 0.03),
        new THREE.Vector3(hw, hd, 0.03),
        new THREE.Vector3(-hw, hd, 0.03),
      ]),
      new THREE.LineBasicMaterial({ color: this.accent.clone().multiplyScalar(2.2), toneMapped: false, depthWrite: false }),
    )
    major.renderOrder = 1
    edge.renderOrder = 3
    this.neon.add(major, edge)
    ;(this.bboxHelper.material as THREE.LineBasicMaterial).color.copy(this.accent).multiplyScalar(1.5)
  }

  private resize() {
    const w = Math.max(1, this.container.clientWidth)
    const h = Math.max(1, this.container.clientHeight)
    this.renderer.setSize(w, h, false)
    this.renderer.domElement.style.width = '100%'
    this.renderer.domElement.style.height = '100%'
    this.composer?.setSize(w, h)
    this.composer?.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.persp.aspect = w / h
    this.persp.updateProjectionMatrix()
    this.applyOrthoFrustum()
  }

  private applyOrthoFrustum() {
    const aspect = this.persp.aspect
    this.ortho.left = -this.orthoHalf * aspect
    this.ortho.right = this.orthoHalf * aspect
    this.ortho.top = this.orthoHalf
    this.ortho.bottom = -this.orthoHalf
    this.ortho.updateProjectionMatrix()
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop)
    this.controls.update()
    this.fitDepthRange()
    this.updateMarks()
    this.updateIslands()
    this.composer.render()
  }

  /**
   * Keeps the depth range proportional to how far the camera is, so depth stays precise near the
   * plate at any zoom (a fixed huge range makes surfaces close together flicker).
   */
  private fitDepthRange() {
    if (this.camera !== this.persp) return
    const d = this.persp.position.distanceTo(this.controls.target)
    const near = Math.max(0.05, d / 300)
    const far = Math.max(near * 10, d * 30, this.bedW * 6)
    if (Math.abs(near - this.persp.near) > near * 0.05 || Math.abs(far - this.persp.far) > far * 0.05) {
      this.persp.near = near
      this.persp.far = far
      this.persp.updateProjectionMatrix()
    }
  }

  /** Keeps highlights on the model as it moves, and pulses them. */
  private updateMarks() {
    const show = !!this.model?.visible && (this.marks.children.length > 0 || this.rings.children.length > 0)
    this.marks.visible = this.rings.visible = show
    if (!show || !this.model) return
    this.marks.matrix.multiplyMatrices(this.model.matrixWorld, this.markAtInv)
    this.marks.matrixWorldNeedsUpdate = true
    const t = performance.now() / 1000
    const wave = 0.5 + 0.5 * Math.sin(t * (this.markFocused ? 5 : 2.5))
    for (const { mat, base } of this.markPulse) mat.opacity = base * (0.55 + 0.45 * wave)
    const scale = 0.045 * (this.markFocused ? 1 + 0.35 * wave : 1 + 0.15 * wave)
    this.rings.children.forEach((sprite, i) => {
      sprite.position.copy(this.ringCenters[i]!).applyMatrix4(this.marks.matrix)
      sprite.scale.setScalar(scale)
    })
  }

  /**
   * Highlights where the print check found problems. `at` is the model's transform when it was
   * checked. With `focus`, only that problem is drawn (pulsing), and `zoom` frames the camera on it.
   */
  setMarks(marks: PrintMarks | null, at: THREE.Matrix4 | null, focus: MarkKey | null, zoom = false) {
    this.clearMarks()
    if (!marks || !at) return
    this.markAtInv.copy(at).invert()
    this.markFocused = !!focus
    const keys = focus ? (focus === 'openEdges' ? ['openEdges', 'holeCenters'] : [focus]) : DEFAULT_MARKS
    const box = new THREE.Box3()
    for (const key of keys as MarkKey[]) {
      const data = marks[key]
      if (!data?.length) continue
      const style = MARK_STYLE[key]
      const color = new THREE.Color(style.color)
      if (key === 'holeCenters') {
        const count = Math.min(data.length / 4, focus ? Infinity : DEFAULT_RINGS)
        for (let i = 0; i < count; i++) {
          const c = new THREE.Vector3(data[i * 4], data[i * 4 + 1], data[i * 4 + 2])
          this.addRing(c, color)
          const r = data[i * 4 + 3]!
          box.expandByPoint(c.clone().addScalar(r)).expandByPoint(c.clone().addScalar(-r))
        }
        continue
      }
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(data, 3))
      geo.computeBoundingBox()
      box.union(geo.boundingBox!)
      // Small problems (a few faces or edges) are easy to miss: ring each cluster of them too.
      if (BEACON_MARKS.has(key) && this.model) {
        const size = new THREE.Box3().setFromObject(this.model).getSize(new THREE.Vector3()).length()
        for (const c of clusterCenters(data, size / 20, focus ? 300 : DEFAULT_RINGS)) this.addRing(c, color)
      }
      if (style.kind === 'faces') {
        const mat = new THREE.MeshBasicMaterial({
          color: color.clone().multiplyScalar(1.15),
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.7,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
          toneMapped: false,
        })
        const mesh = new THREE.Mesh(geo, mat)
        mesh.renderOrder = 10
        this.marks.add(mesh)
        this.markPulse.push({ mat, base: 0.7 })
        // Faint copy through the model so hidden areas still show.
        const ghostMat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.2, depthTest: false, depthWrite: false, toneMapped: false })
        const ghost = new THREE.Mesh(geo, ghostMat)
        ghost.renderOrder = 9
        this.marks.add(ghost)
      } else if (style.kind === 'edges') {
        // Bright where visible, dim where the model hides it.
        const front = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: color.clone().multiplyScalar(3), toneMapped: false }))
        const backMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.4, depthTest: false, toneMapped: false })
        const back = new THREE.LineSegments(geo, backMat)
        front.renderOrder = 11
        back.renderOrder = 11
        this.marks.add(back, front)
        this.markPulse.push({ mat: backMat, base: 0.4 })
      } else {
        const mat = new THREE.PointsMaterial({
          color: color.clone().multiplyScalar(2.5),
          size: 7,
          sizeAttenuation: false,
          depthTest: false,
          transparent: true,
          toneMapped: false,
        })
        const pts = new THREE.Points(geo, mat)
        pts.renderOrder = 12
        this.marks.add(pts)
        this.markPulse.push({ mat, base: 1 })
      }
    }
    this.updateMarks()
    if (zoom && this.model && !box.isEmpty()) {
      // Bring the box into world space as the model sits now, then frame it from the current angle.
      const m = new THREE.Matrix4().multiplyMatrices(this.model.matrixWorld, this.markAtInv)
      const sphere = box.applyMatrix4(m).getBoundingSphere(new THREE.Sphere())
      sphere.radius = Math.max(sphere.radius * 1.4, 3)
      // Overhangs and parts below the plate face down: look up at them from underneath.
      const fromBelow = focus === 'overhangFaces' || focus === 'belowFaces'
      const dir = fromBelow ? new THREE.Vector3(1, -1.25, -0.8).normalize() : this.camera.position.clone().sub(this.controls.target).normalize()
      this.frame(dir, sphere)
    }
  }

  private updateIslands() {
    const show = !!this.model?.visible && this.islandCenters.length > 0
    this.islands.visible = show
    if (!show || !this.model) return
    const m = new THREE.Matrix4().multiplyMatrices(this.model.matrixWorld, this.islandAtInv)
    const wave = 0.5 + 0.5 * Math.sin((performance.now() / 1000) * 4)
    this.islands.children.forEach((o, i) => {
      const sprite = o as THREE.Sprite
      sprite.position.copy(this.islandCenters[i]!).applyMatrix4(m)
      const focused = i === this.islandFocus
      sprite.scale.setScalar(focused ? 0.06 * (1 + 0.35 * wave) : 0.035)
      sprite.material.opacity = this.islandFocus < 0 || focused ? 0.6 + 0.4 * wave : 0.35
    })
  }

  /**
   * Rings where a resin slice found islands (spots that start in mid-air). `at` is the model's
   * transform when it was sliced. With `focus`, that island pulses and the camera frames it.
   */
  setIslands(points: { x: number; y: number; z: number; r: number }[] | null, at: THREE.Matrix4 | null, focus = -1) {
    for (const child of [...this.islands.children]) {
      this.islands.remove(child)
      ;((child as THREE.Sprite).material as THREE.Material).dispose()
    }
    this.islandCenters = []
    this.islandFocus = focus
    if (!points?.length || !at) return
    this.islandAtInv.copy(at).invert()
    const color = new THREE.Color('#ff3df2').multiplyScalar(2.5)
    for (const p of points) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: getRingTexture(), color, sizeAttenuation: false, depthTest: false, transparent: true, toneMapped: false }),
      )
      sprite.renderOrder = 13
      this.islands.add(sprite)
      this.islandCenters.push(new THREE.Vector3(p.x, p.y, p.z))
    }
    this.updateIslands()
    const f = points[focus]
    if (f && this.model) {
      const m = new THREE.Matrix4().multiplyMatrices(this.model.matrixWorld, this.islandAtInv)
      const c = new THREE.Vector3(f.x, f.y, f.z).applyMatrix4(m)
      // Islands hang from nothing: look at them from below, where the problem shows.
      this.frame(new THREE.Vector3(1, -1.25, -0.6).normalize(), new THREE.Sphere(c, Math.max(f.r * 4, 14)))
    }
  }

  private addRing(center: THREE.Vector3, color: THREE.Color) {
    const mat = new THREE.SpriteMaterial({
      map: getRingTexture(),
      color: color.clone().multiplyScalar(2.5),
      sizeAttenuation: false,
      depthTest: false,
      transparent: true,
      toneMapped: false,
    })
    const sprite = new THREE.Sprite(mat)
    sprite.renderOrder = 12
    this.rings.add(sprite)
    this.ringCenters.push(center)
    this.markPulse.push({ mat, base: 1 })
  }

  private clearMarks() {
    for (const group of [this.marks, this.rings]) {
      for (const child of [...group.children]) {
        group.remove(child)
        const o = child as THREE.Mesh
        // Front and back passes share one geometry; disposing twice is harmless.
        o.geometry?.dispose()
        ;(o.material as THREE.Material).dispose()
      }
    }
    this.ringCenters = []
    this.markPulse = []
    this.markFocused = false
  }

  /**
   * Shows supports under the model as it will print: raised by `lift` above the plate. The real
   * model is hidden meanwhile and stand-ins (sharing its geometry) are drawn raised.
   */
  setSupports(triangles: Float32Array | null, lift = 0) {
    if (this.supportView) {
      this.scene.remove(this.supportView)
      for (const o of this.supportView.children) if (o.userData.own) (o as THREE.Mesh).geometry.dispose()
      this.supportView = null
      if (this.model) this.model.visible = true
      this.gizmo.getHelper().visible = true
    }
    if (!triangles?.length || !this.model) return
    this.model.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(this.model, true)
    const dz = lift - box.min.z
    const g = new THREE.Group()
    const shift = new THREE.Matrix4().makeTranslation(0, 0, dz)
    this.model.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh || !m.visible) return
      const copy = new THREE.Mesh(m.geometry, m.material)
      copy.matrixAutoUpdate = false
      copy.matrix.multiplyMatrices(shift, m.matrixWorld)
      g.add(copy)
    })
    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.BufferAttribute(triangles, 3))
    geom.computeVertexNormals()
    const sup = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ color: 0x9fb3c8, roughness: 0.55, metalness: 0.05 }))
    sup.userData.own = true
    g.add(sup)
    this.model.visible = false
    this.gizmo.getHelper().visible = false
    this.supportView = g
    this.scene.add(g)
  }

  /** The shown model's current world transform. */
  modelMatrix() {
    this.model?.updateMatrixWorld(true)
    return this.model ? this.model.matrixWorld.clone() : null
  }

  /** Shows `model`; the gizmo and bounding box follow `target` (default: the whole model). */
  setModel(model: THREE.Object3D | null, target: THREE.Object3D | null = model) {
    if (this.model && this.model !== model) {
      this.scene.remove(this.model)
      this.model.visible = true
    }
    this.gizmo.detach()
    this.model = model
    this.target = model ? target : null
    if (model) {
      this.scene.add(model)
      this.attachGizmo()
    }
    this.updateBBox()
  }

  /** Points the gizmo and bounding box at one part of the model. */
  /**
   * Shows only `part` of the model (null shows them all). The others move to a layer the camera
   * does not draw, so they stay in the scene for saving and checking, and can't be clicked.
   */
  setIsolated(part: THREE.Object3D | null) {
    if (!this.model) return
    for (const child of this.model.children) {
      const hide = !!part && child !== part
      child.traverse((o) => (hide ? o.layers.set(2) : o.layers.set(0)))
    }
    this.changed()
  }

  setTarget(target: THREE.Object3D | null) {
    this.target = target
    this.attachGizmo()
    this.updateBBox()
  }

  /** The direct child of the model under the given screen point, if any. */
  private pick(clientX: number, clientY: number): THREE.Object3D | null {
    if (!this.model) return null
    const rect = this.renderer.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
    const ray = new THREE.Raycaster()
    ray.setFromCamera(ndc, this.camera)
    const hit = ray.intersectObject(this.model, true)[0]
    let o: THREE.Object3D | null = hit?.object ?? null
    while (o && o.parent !== this.model) o = o.parent
    return o
  }

  setTool(tool: Tool) {
    this.tool = tool
    this.attachGizmo()
  }

  private attachGizmo() {
    if (!this.model || !this.target || this.tool === 'select' || this.preview?.visible) {
      this.gizmo.detach()
      return
    }
    this.gizmo.setMode(this.tool === 'move' ? 'translate' : this.tool)
    this.gizmo.setSpace(this.tool === 'scale' ? 'local' : 'world')
    this.gizmo.attach(this.target)
  }

  setSnapping(on: boolean) {
    this.gizmo.setTranslationSnap(on ? 1 : null)
    this.gizmo.setRotationSnap(on ? THREE.MathUtils.degToRad(15) : null)
    this.gizmo.setScaleSnap(on ? 0.05 : null)
  }

  /** Call after changing the model's transform from outside the gizmo. */
  changed() {
    this.updateBBox()
  }

  setShowBBox(on: boolean) {
    this.showBBox = on
    this.updateBBox()
  }

  setShowGrid(on: boolean) {
    this.bed.visible = on
  }

  setWireframe(on: boolean) {
    this.model?.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        ;(m as THREE.MeshStandardMaterial).wireframe = on
      }
    })
  }

  /** Exact (every vertex) unless dragging, where the quick estimate keeps the gizmo smooth. */
  private updateBBox(precise = true) {
    if (!this.model || !this.target || !this.showBBox || !this.model.visible) {
      this.bboxHelper.visible = false
      return
    }
    this.bboxHelper.box.setFromObject(this.target, precise)
    this.bboxHelper.visible = !this.bboxHelper.box.isEmpty()
  }

  setProjection(p: Projection) {
    const next = p === 'perspective' ? this.persp : this.ortho
    if (next === this.camera) return
    const dist = this.camera.position.distanceTo(this.controls.target)
    next.position.copy(this.camera.position)
    next.quaternion.copy(this.camera.quaternion)
    if (next === this.ortho) {
      // Match the visible area of the perspective view at the target distance.
      this.orthoHalf = dist * Math.tan(THREE.MathUtils.degToRad(this.persp.fov / 2))
      this.ortho.zoom = 1
      this.applyOrthoFrustum()
    }
    this.camera = next
    this.renderPass.camera = next
    this.controls.object = next
    this.gizmo.camera = next
    this.controls.update()
  }

  /** Bounding sphere of the model, or of the plate when empty. */
  private focusSphere() {
    const sphere = new THREE.Sphere()
    if (this.preview?.visible && this.pvData && this.pvData.positions.length) {
      const o = this.preview.position
      const box = new THREE.Box3(new THREE.Vector3(...this.pvData.min).add(o), new THREE.Vector3(...this.pvData.max).add(o))
      return box.getBoundingSphere(sphere)
    }
    if (this.model?.visible) {
      const box = new THREE.Box3().setFromObject(this.model)
      if (!box.isEmpty()) return box.getBoundingSphere(sphere)
    }
    sphere.set(new THREE.Vector3(0, 0, 0), Math.max(this.bedW, this.bedD) * 0.6)
    return sphere
  }

  fit() {
    const dir = this.camera.position.clone().sub(this.controls.target).normalize()
    this.frame(dir)
  }

  view(preset: ViewPreset) {
    this.frame(VIEW_DIRS[preset].clone().normalize())
  }

  private frame(dir: THREE.Vector3, sphere?: THREE.Sphere) {
    // The panel may have just been shown or resized; measure before framing.
    this.resize()
    const { center, radius } = sphere ?? this.focusSphere()
    const r = Math.max(radius, 1)
    // Fit whichever of the vertical or horizontal field of view is tighter.
    const vHalf = THREE.MathUtils.degToRad(this.persp.fov / 2)
    const hHalf = Math.atan(Math.tan(vHalf) * this.persp.aspect)
    const dist = (r / Math.sin(Math.min(vHalf, hHalf))) * 1.08
    this.controls.target.copy(center)
    this.camera.position.copy(center).addScaledVector(dir, dist)
    this.persp.near = Math.max(0.01, dist / 1000)
    this.persp.far = dist * 50
    this.persp.updateProjectionMatrix()
    this.orthoHalf = (r * 1.15) / Math.min(1, this.persp.aspect)
    this.ortho.zoom = 1
    this.ortho.position.copy(this.camera.position)
    this.applyOrthoFrustum()
    this.camera.lookAt(center)
    this.controls.update()
  }

  // ---- Slice preview ---------------------------------------------------------

  /**
   * Shows sliced G-code as coloured toolpaths. `center` is the bed centre in G-code
   * coordinates, so the toolpaths sit on the plate the way the printer will place them.
   */
  setPreview(p: GcodePreview | null, colorOf: (feature: string) => string, center: [number, number] = [this.bedW / 2, this.bedD / 2]) {
    if (this.preview) {
      this.scene.remove(this.preview)
      disposeObject(this.preview)
    }
    this.preview = null
    this.pvLayers = this.pvTop = this.pvTravel = null
    this.pvData = p
    if (!p) {
      if (this.model) this.model.visible = true
      this.attachGizmo()
      this.updateBBox()
      return
    }
    const count = p.positions.length / 3
    const colors = new Float32Array(count * 3)
    const palette = p.features.map((f) => new THREE.Color(colorOf(f)))
    for (let s = 0; s < p.featureOf.length; s++) {
      const c = palette[p.featureOf[s]!] ?? palette[0]!
      for (let k = 0; k < 2; k++) {
        const o = (s * 2 + k) * 3
        colors[o] = c.r
        colors[o + 1] = c.g
        colors[o + 2] = c.b
      }
    }
    const pos = new THREE.BufferAttribute(p.positions, 3)
    const col = new THREE.BufferAttribute(colors, 3)
    const geo = () => {
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', pos)
      g.setAttribute('color', col)
      return g
    }
    this.pvLayers = new THREE.LineSegments(geo(), new THREE.LineBasicMaterial({ vertexColors: true, toneMapped: false }))
    // The current layer is drawn again in HDR so it glows.
    this.pvTop = new THREE.LineSegments(geo(), new THREE.LineBasicMaterial({ vertexColors: true, toneMapped: false, color: new THREE.Color(2.4, 2.4, 2.4) }))
    this.pvTop.renderOrder = 1
    const tg = new THREE.BufferGeometry()
    tg.setAttribute('position', new THREE.BufferAttribute(p.travels, 3))
    this.pvTravel = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ color: '#3a7bd5', transparent: true, opacity: 0.35 }))
    this.pvTravel.visible = false
    for (const l of [this.pvLayers, this.pvTop, this.pvTravel]) l.frustumCulled = false
    this.preview = new THREE.Group()
    this.preview.add(this.pvLayers, this.pvTop, this.pvTravel)
    this.preview.position.set(-center[0], -center[1], 0)
    this.scene.add(this.preview)
    this.setPreviewLayer(p.layerEnds.length)
    this.setPreviewVisible(true)
  }

  /** Shows layers 1..n (n counts from 1). */
  setPreviewLayer(n: number) {
    const p = this.pvData
    if (!p || !this.pvLayers || !this.pvTop || !this.pvTravel) return
    const layers = p.layerEnds.length
    this.pvLayer = Math.max(1, Math.min(layers, Math.round(n)))
    const end = p.layerEnds[this.pvLayer - 1] ?? 0
    const start = this.pvLayer > 1 ? p.layerEnds[this.pvLayer - 2]! : 0
    this.pvLayers.geometry.setDrawRange(0, end * 2)
    this.pvTop.geometry.setDrawRange(start * 2, (end - start) * 2)
    this.pvTravel.geometry.setDrawRange(0, (p.travelEnds[this.pvLayer - 1] ?? 0) * 2)
  }

  setPreviewTravel(on: boolean) {
    if (this.pvTravel) this.pvTravel.visible = on
  }

  /** Switches between the toolpaths and the model. */
  setPreviewVisible(on: boolean) {
    if (this.preview) this.preview.visible = on
    if (this.model) this.model.visible = !(on && this.preview)
    this.attachGizmo()
    this.updateBBox()
  }

  /** A small thumbnail of the current view (used for library cards). */
  snapshot(max = 360): string | null {
    const src = this.renderer.domElement
    if (!src.width || !src.height) return null
    this.gizmo.getHelper().visible = false
    this.composer.render()
    const scale = Math.min(1, max / Math.max(src.width, src.height))
    const c = document.createElement('canvas')
    c.width = Math.round(src.width * scale)
    c.height = Math.round(src.height * scale)
    c.getContext('2d')?.drawImage(src, 0, 0, c.width, c.height)
    this.gizmo.getHelper().visible = true
    return c.toDataURL('image/webp', 0.82)
  }

  dispose() {
    this.setPreview(null, () => '#fff')
    this.clearMarks()
    this.setIslands(null, null)
    cancelAnimationFrame(this.raf)
    this.ro.disconnect()
    this.gizmo.dispose()
    this.controls.dispose()
    this.composer.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}

function disposeObject(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh
    m.geometry?.dispose()
    const mat = m.material as THREE.Material | THREE.Material[] | undefined
    for (const x of Array.isArray(mat) ? mat : mat ? [mat] : []) x.dispose()
  })
}
