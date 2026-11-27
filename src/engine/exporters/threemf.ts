// 3MF writer: one object per part on the plate (so slicers keep them as separate parts), welded
// vertices, millimetres, and a colour per part when it has one.

import * as THREE from 'three'
import { zipSync, strToU8 } from 'three/examples/jsm/libs/fflate.module.js'

export interface ThreeMFPart {
  name: string
  /** World-space, non-indexed triangles. */
  positions: Float32Array
  /** sRGB hex such as '#ff8800'; omitted for no colour. */
  color?: string
}

const esc = (s: string) => s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!)
/** Shortest text that reads back as the same 32-bit float. */
const num = (v: number) => {
  if (Object.is(v, -0) || v === 0) return '0'
  const f = Math.fround(v)
  for (let d = 4; d < 10; d++) {
    const s = f.toFixed(d)
    if (Math.fround(Number(s)) === f) return s.replace(/\.?0+$/, '')
  }
  return String(f)
}

function meshXml(p: Float32Array) {
  const index = new Map<string, number>()
  const verts: string[] = []
  const tris: string[] = []
  const id = (o: number) => {
    const k = `${p[o]},${p[o + 1]},${p[o + 2]}`
    let i = index.get(k)
    if (i === undefined) {
      i = verts.length
      index.set(k, i)
      verts.push(`<vertex x="${num(p[o]!)}" y="${num(p[o + 1]!)}" z="${num(p[o + 2]!)}"/>`)
    }
    return i
  }
  for (let o = 0; o + 8 < p.length; o += 9) {
    const a = id(o), b = id(o + 3), c = id(o + 6)
    if (a === b || b === c || a === c) continue
    tris.push(`<triangle v1="${a}" v2="${b}" v3="${c}"/>`)
  }
  return { verts, tris }
}

export function write3mf(parts: ThreeMFPart[], title = 'Boaty model'): Uint8Array {
  const colored = parts.filter((p) => p.color)
  const colours = [...new Set(colored.map((p) => p.color!.toUpperCase()))]
  const res: string[] = []
  if (colours.length) {
    res.push(`<basematerials id="1">${colours.map((c, i) => `<base name="Colour ${i + 1}" displaycolor="${esc(c)}"/>`).join('')}</basematerials>`)
  }
  const items: string[] = []
  let next = 2
  for (const part of parts) {
    const { verts, tris } = meshXml(part.positions)
    if (!tris.length) continue
    const id = next++
    const mat = part.color ? ` pid="1" pindex="${colours.indexOf(part.color.toUpperCase())}"` : ''
    res.push(`<object id="${id}" type="model" name="${esc(part.name)}"${mat}><mesh><vertices>${verts.join('')}</vertices><triangles>${tris.join('')}</triangles></mesh></object>`)
    items.push(`<item objectid="${id}"/>`)
  }
  if (!items.length) throw new Error('There is nothing to save.')
  const model =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">` +
    `<metadata name="Title">${esc(title)}</metadata><metadata name="Application">Boaty</metadata>` +
    `<resources>${res.join('')}</resources><build>${items.join('')}</build></model>`
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>',
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>',
    ),
    '3D/3dmodel.model': strToU8(model),
  }, { level: 6 })
}

/** World-space triangles of every mesh under `root`, with mirrored transforms turned the right way out. */
export function worldPositions(root: THREE.Object3D): Float32Array {
  root.updateMatrixWorld(true)
  const chunks: Float32Array[] = []
  const v = new THREE.Vector3()
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh || !mesh.visible) return
    const g = mesh.geometry
    const pos = g.getAttribute('position')
    if (!pos) return
    const idx = g.index
    const n = idx ? idx.count : pos.count
    const out = new Float32Array(Math.floor(n / 3) * 9)
    const flip = mesh.matrixWorld.determinant() < 0
    for (let t = 0; t < Math.floor(n / 3); t++) {
      for (let k = 0; k < 3; k++) {
        const kk = flip && k > 0 ? 3 - k : k
        const i = idx ? idx.getX(t * 3 + kk) : t * 3 + kk
        v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld)
        out[t * 9 + k * 3] = v.x
        out[t * 9 + k * 3 + 1] = v.y
        out[t * 9 + k * 3 + 2] = v.z
      }
    }
    chunks.push(out)
  })
  const all = new Float32Array(chunks.reduce((s, c) => s + c.length, 0))
  let o = 0
  for (const c of chunks) {
    all.set(c, o)
    o += c.length
  }
  return all
}
