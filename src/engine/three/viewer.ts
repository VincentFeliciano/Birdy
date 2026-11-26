import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

// 3D printing convention: Z is up, the build plate is the XY plane, units are millimetres.
THREE.Object3D.DEFAULT_UP.set(0, 0, 1)

export type Tool = 'select' | 'move' | 'rotate' | 'scale'
export type ViewPreset = 'iso' | 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom'
export type Projection = 'perspective' | 'orthographic'

const BED = 256

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

  /** Fired while dragging the gizmo (`live`) and once when a drag ends. */
  onTransform: ((live: boolean) => void) | null = null

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
      if (!e.value) this.onTransform?.(false)
    })
    this.gizmo.addEventListener('objectChange', () => {
      this.updateBBox()
      this.onTransform?.(true)
    })
    this.scene.add(this.gizmo.getHelper())

    // Neon glow: only colours pushed above 1.0 (the HDR neon lines) bloom; the model does not.
    this.composer = new EffectComposer(this.renderer)
    this.renderPass = new RenderPass(this.scene, this.camera)
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.65, 0.6, 1.0)
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
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(BED, BED),
      new THREE.MeshStandardMaterial({ color: '#14171C', roughness: 0.95, metalness: 0 }),
    )
    plate.position.z = -0.05
    const minor = new THREE.GridHelper(BED, BED / 10, '#1F232A', '#1F232A')
    minor.rotation.x = Math.PI / 2
    minor.position.z = 0.01
    // Axis lines from the plate's front-left corner: X red, Y green, Z blue.
    const axes = new THREE.AxesHelper(36)
    axes.position.set(-BED / 2, -BED / 2, 0.02)
    const colors = axes.geometry.getAttribute('color') as THREE.BufferAttribute
    const palette = ['#E5484D', '#E5484D', '#46A758', '#46A758', '#3E8EF7', '#3E8EF7'].map((c) => new THREE.Color(c))
    palette.forEach((c, i) => colors.setXYZ(i, c.r, c.g, c.b))
    this.bed.add(plate, minor, axes, this.neon)
    this.scene.add(this.bed)
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
    const major = new THREE.GridHelper(BED, BED / 50, this.accent, this.accent)
    major.rotation.x = Math.PI / 2
    major.position.z = 0.02
    const majorMat = major.material as THREE.LineBasicMaterial
    majorMat.transparent = true
    majorMat.opacity = 0.28
    // Plate edge drawn in HDR so the bloom pass makes it glow like a neon tube.
    const h = BED / 2
    const edge = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-h, -h, 0.03),
        new THREE.Vector3(h, -h, 0.03),
        new THREE.Vector3(h, h, 0.03),
        new THREE.Vector3(-h, h, 0.03),
      ]),
      new THREE.LineBasicMaterial({ color: this.accent.clone().multiplyScalar(3), toneMapped: false }),
    )
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
    this.composer.render()
  }

  setModel(model: THREE.Object3D | null) {
    if (this.model) this.scene.remove(this.model)
    this.gizmo.detach()
    this.model = model
    if (model) {
      this.scene.add(model)
      this.attachGizmo()
    }
    this.updateBBox()
  }

  setTool(tool: Tool) {
    this.tool = tool
    this.attachGizmo()
  }

  private attachGizmo() {
    if (!this.model || this.tool === 'select') {
      this.gizmo.detach()
      return
    }
    this.gizmo.setMode(this.tool === 'move' ? 'translate' : this.tool)
    this.gizmo.setSpace(this.tool === 'scale' ? 'local' : 'world')
    this.gizmo.attach(this.model)
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

  private updateBBox() {
    if (!this.model || !this.showBBox) {
      this.bboxHelper.visible = false
      return
    }
    this.bboxHelper.box.setFromObject(this.model)
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
    if (this.model) {
      const box = new THREE.Box3().setFromObject(this.model)
      if (!box.isEmpty()) return box.getBoundingSphere(sphere)
    }
    sphere.set(new THREE.Vector3(0, 0, 0), BED * 0.6)
    return sphere
  }

  fit() {
    const dir = this.camera.position.clone().sub(this.controls.target).normalize()
    this.frame(dir)
  }

  view(preset: ViewPreset) {
    this.frame(VIEW_DIRS[preset].clone().normalize())
  }

  private frame(dir: THREE.Vector3) {
    // The panel may have just been shown or resized; measure before framing.
    this.resize()
    const { center, radius } = this.focusSphere()
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
    cancelAnimationFrame(this.raf)
    this.ro.disconnect()
    this.gizmo.dispose()
    this.controls.dispose()
    this.composer.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
