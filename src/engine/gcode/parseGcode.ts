// Turns G-code into line segments grouped by layer, for the slice preview. Pure: no DOM, no Three.js.
// Understands OrcaSlicer / Bambu Studio (`; CHANGE_LAYER`, `; FEATURE: x`), PrusaSlicer / generic
// (`;LAYER_CHANGE`, `;TYPE:x`) and Cura (`;LAYER:n`, `;TYPE:X`) comments, G0-G3 moves,
// G90/G91, M82/M83 and G92.

export interface GcodePreview {
  /** Extrusion segments: x0 y0 z0 x1 y1 z1 per segment, in bed coordinates (mm). */
  positions: Float32Array
  /** Feature index per segment, into `features`. */
  featureOf: Uint8Array
  /** Segment count at the end of each layer (cumulative). */
  layerEnds: Uint32Array
  layerZ: Float32Array
  features: string[]
  /** Travel moves: x0 y0 z0 x1 y1 z1, all layers (cumulative count per layer in travelEnds). */
  travels: Float32Array
  travelEnds: Uint32Array
  min: [number, number, number]
  max: [number, number, number]
}

class Floats {
  buf = new Float32Array(1 << 16)
  n = 0
  push6(a: number, b: number, c: number, d: number, e: number, f: number) {
    if (this.n + 6 > this.buf.length) {
      const next = new Float32Array(this.buf.length * 2)
      next.set(this.buf)
      this.buf = next
    }
    const o = this.n
    this.buf[o] = a
    this.buf[o + 1] = b
    this.buf[o + 2] = c
    this.buf[o + 3] = d
    this.buf[o + 4] = e
    this.buf[o + 5] = f
    this.n += 6
  }
  done() {
    return this.buf.slice(0, this.n)
  }
}

class Bytes {
  buf = new Uint8Array(1 << 14)
  n = 0
  push(v: number) {
    if (this.n >= this.buf.length) {
      const next = new Uint8Array(this.buf.length * 2)
      next.set(this.buf)
      this.buf = next
    }
    this.buf[this.n++] = v
  }
  done() {
    return this.buf.slice(0, this.n)
  }
}

/** Display names for feature comments from different slicers. */
export function normalizeFeature(raw: string): string {
  const t = raw.trim()
  const u = t.toUpperCase().replace(/[\s_-]+/g, ' ')
  const map: [RegExp, string][] = [
    [/^(OUTER WALL|EXTERNAL PERIMETER|WALL OUTER|OVERHANG WALL)$/, 'Outer wall'],
    [/^(INNER WALL|PERIMETER|WALL INNER)$/, 'Inner wall'],
    [/^(SPARSE INFILL|INTERNAL INFILL|FILL|INFILL)$/, 'Sparse infill'],
    [/^(INTERNAL SOLID INFILL|SOLID INFILL)$/, 'Solid infill'],
    [/^(TOP SURFACE|TOP SOLID INFILL|SKIN)$/, 'Top surface'],
    [/^(BOTTOM SURFACE)$/, 'Bottom surface'],
    [/^(BRIDGE|BRIDGE INFILL|INTERNAL BRIDGE)$/, 'Bridge'],
    [/^(SUPPORT|SUPPORT MATERIAL|SUPPORT INTERFACE|SUPPORT MATERIAL INTERFACE|SUPPORT TRANSITION)$/, 'Support'],
    [/^(SKIRT|BRIM|SKIRT\/BRIM|SKIRT BRIM)$/, 'Skirt / brim'],
    [/^(GAP INFILL)$/, 'Gap infill'],
    [/^(IRONING)$/, 'Ironing'],
    [/^(PRIME TOWER|WIPE TOWER)$/, 'Prime tower'],
  ]
  for (const [re, name] of map) if (re.test(u)) return name
  return t ? t[0]!.toUpperCase() + t.slice(1).toLowerCase() : 'Other'
}

const word = (line: string, letter: string): number | undefined => {
  const i = line.indexOf(letter)
  if (i < 0) return undefined
  const prev = line.charCodeAt(i - 1)
  if (i > 0 && prev !== 32 && prev !== 9) {
    // A letter inside another word (e.g. the E in "G1 F1800 E0.5" is fine, the one in a comment is not).
    const j = line.indexOf(` ${letter}`)
    if (j < 0) return undefined
    return parseFloat(line.slice(j + 2))
  }
  return parseFloat(line.slice(i + 1))
}

export function parseGcode(text: string, opts: { arcStepDeg?: number } = {}): GcodePreview {
  const arcStep = ((opts.arcStepDeg ?? 12) * Math.PI) / 180
  const seg = new Floats()
  const trav = new Floats()
  const feat = new Bytes()
  const layerEnds: number[] = []
  const travelEnds: number[] = []
  const layerZ: number[] = []
  const features: string[] = []
  const featureIndex = new Map<string, number>()

  let x = 0
  let y = 0
  let z = 0
  let e = 0
  let absXYZ = true
  let absE = true
  let feature = 0
  // With layer comments, layers follow them (start-sequence purge lines stay one block);
  // without any, a new layer starts whenever extrusion happens at a new height.
  let sawMarker = /^;\s*(CHANGE_LAYER|LAYER_CHANGE|LAYER:-?\d+)\s*$/m.test(text)
  let layerPending = true
  let curLayerZ = NaN
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]

  const setFeature = (raw: string) => {
    const name = normalizeFeature(raw)
    let idx = featureIndex.get(name)
    if (idx === undefined) {
      idx = Math.min(features.length, 255)
      if (features.length < 256) {
        features.push(name)
        featureIndex.set(name, idx)
      }
    }
    feature = idx
  }
  setFeature('Other')

  const closeLayer = () => {
    if (layerZ.length && seg.n / 6 > (layerEnds[layerEnds.length - 1] ?? 0)) {
      layerEnds.push(seg.n / 6)
      travelEnds.push(trav.n / 6)
    } else if (layerZ.length) {
      // Empty layer: drop it.
      layerZ.pop()
    }
  }

  const beginLayerIfNeeded = (atZ: number) => {
    if (!sawMarker && Number.isFinite(curLayerZ) && Math.abs(atZ - curLayerZ) > 1e-4) layerPending = true
    if (!layerPending) return
    closeLayer()
    layerZ.push(atZ)
    curLayerZ = atZ
    layerPending = false
  }

  const fallbackMin: [number, number, number] = [Infinity, Infinity, Infinity]
  const fallbackMax: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  const extrude = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => {
    beginLayerIfNeeded(z1)
    seg.push6(x0, y0, z0, x1, y1, z1)
    feat.push(feature)
    // Bounds cover the print itself; start/end sequences (purge lines) only count if nothing else does.
    const name = features[feature]
    if (name === 'Custom' || name === 'Other') {
      for (let k = 0; k < 3; k++) {
        const v = k === 0 ? x1 : k === 1 ? y1 : z1
        if (v < fallbackMin[k]!) fallbackMin[k] = v
        if (v > fallbackMax[k]!) fallbackMax[k] = v
      }
      return
    }
    if (x1 < min[0]) min[0] = x1
    if (y1 < min[1]) min[1] = y1
    if (z1 < min[2]) min[2] = z1
    if (x1 > max[0]) max[0] = x1
    if (y1 > max[1]) max[1] = y1
    if (z1 > max[2]) max[2] = z1
  }

  let start = 0
  const len = text.length
  while (start < len) {
    let end = text.indexOf('\n', start)
    if (end < 0) end = len
    let line = text.slice(start, end)
    start = end + 1
    if (line.endsWith('\r')) line = line.slice(0, -1)
    if (!line) continue

    if (line.charCodeAt(0) === 59 /* ; */) {
      const c = line.slice(1).trimStart()
      if (c === 'CHANGE_LAYER' || c === 'LAYER_CHANGE' || /^LAYER:-?\d+$/.test(c)) {
        sawMarker = true
        layerPending = true
      } else if (c.startsWith('FEATURE:')) setFeature(c.slice(8))
      else if (c.startsWith('TYPE:')) setFeature(c.slice(5))
      continue
    }

    const semi = line.indexOf(';')
    const code = (semi >= 0 ? line.slice(0, semi) : line).trim().toUpperCase()
    if (!code) continue
    const sp = code.indexOf(' ')
    const cmd = sp < 0 ? code : code.slice(0, sp)

    if (cmd === 'G0' || cmd === 'G1' || cmd === 'G2' || cmd === 'G3') {
      const X = word(code, 'X')
      const Y = word(code, 'Y')
      const Z = word(code, 'Z')
      const E = word(code, 'E')
      const nx = X === undefined ? x : absXYZ ? X : x + X
      const ny = Y === undefined ? y : absXYZ ? Y : y + Y
      const nz = Z === undefined ? z : absXYZ ? Z : z + Z
      let extruding = false
      if (E !== undefined) {
        const de = absE ? E - e : E
        e = absE ? E : e + E
        extruding = de > 1e-6
      }
      const moved = nx !== x || ny !== y
      if (cmd === 'G2' || cmd === 'G3') {
        const I = word(code, 'I') ?? 0
        const J = word(code, 'J') ?? 0
        const cx = x + I
        const cy = y + J
        const r = Math.hypot(I, J)
        let a0 = Math.atan2(y - cy, x - cx)
        let a1 = Math.atan2(ny - cy, nx - cx)
        const cw = cmd === 'G2'
        if (cw && a1 >= a0) a1 -= Math.PI * 2
        if (!cw && a1 <= a0) a1 += Math.PI * 2
        if (!moved) a1 = a0 + (cw ? -Math.PI * 2 : Math.PI * 2)
        const steps = Math.max(1, Math.ceil(Math.abs(a1 - a0) / arcStep))
        let px = x
        let py = y
        let pz = z
        for (let i = 1; i <= steps; i++) {
          const t = i / steps
          const a = a0 + (a1 - a0) * t
          const qx = i === steps ? nx : cx + r * Math.cos(a)
          const qy = i === steps ? ny : cy + r * Math.sin(a)
          const qz = z + (nz - z) * t
          if (extruding) extrude(px, py, pz, qx, qy, qz)
          else trav.push6(px, py, pz, qx, qy, qz)
          px = qx
          py = qy
          pz = qz
        }
      } else if (moved || nz !== z) {
        if (extruding && moved) extrude(x, y, z, nx, ny, nz)
        else if (moved) trav.push6(x, y, z, nx, ny, nz)
      }
      x = nx
      y = ny
      z = nz
    } else if (cmd === 'G90') absXYZ = true
    else if (cmd === 'G91') absXYZ = false
    else if (cmd === 'M82') absE = true
    else if (cmd === 'M83') absE = false
    else if (cmd === 'G92') {
      const E = word(code, 'E')
      if (E !== undefined) e = E
      const X = word(code, 'X')
      const Y = word(code, 'Y')
      const Z = word(code, 'Z')
      if (X !== undefined) x = X
      if (Y !== undefined) y = Y
      if (Z !== undefined) z = Z
    } else if (cmd === 'G28') {
      // Homing: position becomes the endstop, which the file does not state. Keep the last one.
    }
  }
  closeLayer()
  if (layerZ.length > layerEnds.length) layerZ.length = layerEnds.length

  return {
    positions: seg.done(),
    featureOf: feat.done(),
    layerEnds: Uint32Array.from(layerEnds),
    layerZ: Float32Array.from(layerZ),
    features,
    travels: trav.done(),
    travelEnds: Uint32Array.from(travelEnds),
    min: min[0] !== Infinity ? min : fallbackMin[0] !== Infinity ? fallbackMin : [0, 0, 0],
    max: max[0] !== -Infinity ? max : fallbackMax[0] !== -Infinity ? fallbackMax : [0, 0, 0],
  }
}
