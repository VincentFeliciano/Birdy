import * as THREE from 'three'
import { sliceModel as sliceModelFromPanel, openArchive as openZipFromPanel, importDownloads as importModelsFromDownloads, models as modelsState, openFolder as openModelsFolder, openModel as openModelsModel, setModelsOpen } from '../features/models/store.svelte'
import { ACCENTS, applyAccent, applyCustomAccent, theme } from './theme.svelte'
import { exportModel } from '../engine/exporters/exportModel'
import { printCost } from './costs.svelte'
import { commands, search, startTour, ui } from './commands.svelte'
import { isFdmKind } from '../types/slicing'
import { setFavsOnly, setQuery, toggleFav } from '../features/models/store.svelte'
import { browser as browserState } from '../stores/browser.svelte'
import { bar, refreshPrinters, setBarHidden, togglePrinter } from '../features/printers/status.svelte'
import { addShape, scaleBy, moveBy, rotateBy, undo, redo, setUniform, setDimension, writeTextOnPart, setPartColor, alignParts, splitToFit, combineParts, cutPart, hollowPart, rebuildPart, simplifyPart, smoothPart, undoEdit, arrangePlate, autoOrient, settleModel, setIsolate, splitIntoParts, checkNow, getViewer, duplicatePart, exportActive, focusMark, openModelFile, repairActive, selectPart, setXForm, ws } from '../features/workspace/store.svelte'
import { choosePrinter as chooseResinPrinter, sendResin, makeExposureTest, pickIsland, resin, setMode as setSliceMode, setHollow, setSupport, sliceResinModel } from '../features/slicing/resin.svelte'
import { chooseMachine, importFrom, installEngine, loadCatalog, openPrinterEditor, saveGcode, setPreset, setPreviewLayer, sl, slice } from '../features/slicing/store.svelte'
import { BED } from '../features/workspace/store.svelte'

/** Builds a small printable sample (a torus knot, ~70 mm) as a real binary STL and opens it. */
export async function openSample() {
  const mesh = new THREE.Mesh(new THREE.TorusKnotGeometry(22, 7, 220, 28, 2, 3))
  const data = exportModel(mesh, 'stl')
  mesh.geometry.dispose()
  await openModelFile({ name: 'sample-knot.stl', format: 'stl', size: data.byteLength, data })
}

const until = async (ok: () => boolean, ms = 60_000) => {
  const end = Date.now() + ms
  while (!ok() && Date.now() < end) await new Promise((r) => setTimeout(r, 100))
  return ok()
}

/** A torus knot with holes punched in it, some faces flipped, floating 5 mm above the plate. */
async function openBrokenSample() {
  const g = new THREE.TorusKnotGeometry(22, 7, 220, 28, 2, 3).toNonIndexed()
  const src = g.getAttribute('position').array as Float32Array
  const out: number[] = []
  const tris = src.length / 9
  for (let t = 0; t < tris; t++) {
    if (t % 1500 < 6) continue // holes
    const v = Array.from(src.subarray(t * 9, t * 9 + 9))
    if (t % 997 === 3) v.splice(3, 6, ...v.slice(6, 9), ...v.slice(3, 6)) // flipped face
    out.push(...v)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(out, 3))
  const mesh = new THREE.Mesh(geo)
  const data = exportModel(mesh, 'stl')
  geo.dispose()
  g.dispose()
  await openModelFile({ name: 'broken-knot.stl', format: 'stl', size: data.byteLength, data })
}

/** A post with a shelf and two blocks hanging in the air beside it: resin islands. */
async function openIslandSample() {
  const parts = [
    new THREE.BoxGeometry(8, 8, 30).translate(0, 0, 15),
    new THREE.BoxGeometry(20, 6, 3).translate(10, 0, 31.5),
    new THREE.BoxGeometry(6, 6, 6).translate(-18, 0, 20),
    new THREE.SphereGeometry(4, 32, 16).translate(20, 12, 14),
  ]
  const group = new THREE.Group()
  for (const g of parts) group.add(new THREE.Mesh(g))
  const data = exportModel(group, 'stl')
  for (const g of parts) g.dispose()
  await openModelFile({ name: 'islands-test.stl', format: 'stl', size: data.byteLength, data })
}

const issueList = () => ws.report?.issues.map((i) => i.code).join(',') ?? 'none'

/** Dev hooks used by the `--demo` screenshot runs. */
export function installDemo() {
  window.__demo = async () => {
    const getDemo = (window as unknown as { __demoGet?: string }).__demoGet
    if (getDemo) {
      const [what, ...rest] = getDemo.split('|')
      if (what === 'page') {
        // "Get in Birdy" on a real model page.
        const url = rest.join('|')
        ws.layout = 'browse'
        window.api.tabs.navigate(url)
        await until(() => browserState.tabs.some((t) => t.url.startsWith(url) && !t.loading), 30_000)
        await new Promise((r) => setTimeout(r, 1500))
        const btn = document.querySelector<HTMLButtonElement>('.get')
        console.log(`get: button=${!!btn}`)
        if (!btn) return
        const before = ws.models.length
        btn.click()
        await new Promise((r) => setTimeout(r, 800))
        console.log(`get: note=${document.querySelector('.getnote span')?.textContent} layout=${ws.layout}`)
        await new Promise((r) => setTimeout(r, 6000))
        await new Promise((r) => setTimeout(r, 1500))
        console.log(`get: models=${ws.models.map((m) => m.name).join(',')} notice=${modelsState.notice} url=${browserState.tabs.find((t) => t.id === browserState.activeId)?.url}`)
      } else {
        // Search and favourites in the Models panel.
        ws.layout = 'split'
        setModelsOpen(true)
        await until(() => modelsState.entries.length > 0, 10_000)
        if (what === 'search') {
          setQuery(rest[0] ?? '')
          await new Promise((r) => setTimeout(r, 600))
          await until(() => !modelsState.loading, 10_000)
          console.log(`search "${rest[0]}": ${modelsState.results.map((e) => e.rel).join(', ')}`)
        } else if (what === 'favs') {
          setQuery('gear')
          await new Promise((r) => setTimeout(r, 600))
          for (const e of modelsState.results.slice(0, 2)) toggleFav(e.rel)
          setQuery('')
          setFavsOnly(true)
          await new Promise((r) => setTimeout(r, 600))
          console.log(`favs: stored=${localStorage.getItem('birdy.modelFavs')} shown=${modelsState.results.map((e) => e.name).join(',')}`)
        }
        await until(() => modelsState.results.every((e) => e.kind === 'dir' || !!modelsState.thumbs[e.rel]), 15_000).catch(() => {})
      }
      return
    }
    const uiDemo = (window as unknown as { __demoUi?: string }).__demoUi
    if (uiDemo) {
      // Command palette, shortcuts list and drop-anywhere.
      const [what, arg = ''] = uiDemo.split(':')
      if (what === 'palette') {
        await openSample()
        ws.layout = 'split'
        ui.palette = true
        await new Promise((r) => setTimeout(r, 200))
        const input = document.querySelector<HTMLInputElement>('[aria-label="Search commands"]')!
        input.value = arg
        input.dispatchEvent(new Event('input', { bubbles: true }))
        await new Promise((r) => setTimeout(r, 200))
        const found = search(commands(), arg).slice(0, 5).map((c) => c.title)
        console.log(`palette "${arg}": ${found.join(' | ')}`)
        for (const ms of [0, 1500]) await new Promise((r) => setTimeout(r, ms)).then(() => console.log(`palette dom@${ms}: open=${ui.palette} value=${document.querySelector<HTMLInputElement>('[aria-label="Search commands"]')?.value} rows=${document.querySelectorAll('#pal-list [role=option]').length}`))
        if (arg === 'orient') {
          // Run the top hit with Enter and check that it acted.
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
          await new Promise((r) => setTimeout(r, 400))
          console.log(`palette ran: open=${ui.palette} note=${ws.fixNote}`)
        }
      } else if (what === 'tour') {
        await openSample()
        if (!ui.tour) startTour()
        for (let k = 0; k < Number(arg || 0); k++) {
          await new Promise((r) => setTimeout(r, 300))
          document.querySelector<HTMLButtonElement>('.tour .primary')?.click()
        }
        await new Promise((r) => setTimeout(r, 700))
        console.log(`tour: open=${ui.tour} title=${document.querySelector('#tour-title')?.textContent} hole=${!!document.querySelector('.tour .hole')} layout=${ws.layout}`)
      } else if (what === 'shortcuts') {
        ws.layout = 'split'
        window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }))
        await new Promise((r) => setTimeout(r, 300))
        console.log(`shortcuts open=${ui.shortcuts}`)
      } else if (what === 'drop') {
        ws.layout = 'browse'
        const box = new THREE.Mesh(new THREE.BoxGeometry(20, 20, 20))
        box.updateMatrixWorld(true)
        const stl = exportModel(box, 'stl')
        const dt = new DataTransfer()
        dt.items.add(new File([stl as Uint8Array<ArrayBuffer>], 'dropped-cube.stl'))
        if (arg !== 'hover') dt.items.add(new File(['hello'], 'notes.txt'))
        window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true }))
        window.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }))
        await new Promise((r) => setTimeout(r, 300))
        console.log(`drop overlay=${!!document.querySelector('.dropzone')}`)
        if (arg !== 'hover') {
          window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
          await until(() => ws.models.some((m) => m.name === 'dropped-cube.stl'), 10_000)
          await new Promise((r) => setTimeout(r, 400))
          console.log(`dropped: layout=${ws.layout} models=${ws.models.map((m) => m.name).join(',')} overlay=${!!document.querySelector('.dropzone')} error=${ws.error}`)
        }
      }
      return
    }
    const repairDemo = (window as unknown as { __demoRepair?: string }).__demoRepair
    if (repairDemo) {
      await openBrokenSample()
      ws.layout = 'workspace'
      ws.sidebarTab = 'model'
      await until(() => !!ws.report && !ws.checking)
      // Lift it off the plate too, so the plate fix shows.
      setXForm('pz', (ws.xf?.pz ?? 0) + 5)
      await checkNow()
      const before = ws.report!
      console.log(`repair before: verdict=${before.verdict} issues=${issueList()} open=${before.stats.openEdges} flipped=${before.stats.flippedEdges}`)
      if (repairDemo === 'after') {
        const btn = [...document.querySelectorAll<HTMLButtonElement>('.sidebar button')].find((b) => b.textContent?.includes('Fix automatically'))
        if (!btn) throw new Error('no Fix automatically button')
        btn.click()
        await until(() => !ws.repairing)
        await new Promise((r) => setTimeout(r, 200))
        await checkNow()
        const r = ws.report!
        console.log(`repair after: verdict=${r.verdict} issues=${issueList()} watertight=${r.stats.watertight} volume=${r.stats.volumeCm3?.toFixed(2)} note=${ws.fixNote}`)
      } else if (repairDemo.startsWith('show:')) {
        // Press Show on one issue: highlight just that problem and zoom to it.
        const issue = before.issues.find((i) => i.code === repairDemo.slice(5))
        if (!issue?.mark) throw new Error(`no locatable ${repairDemo.slice(5)} issue`)
        focusMark(issue.mark)
        console.log(`repair show: ${issue.code} -> ${ws.markFocus}`)
      } else if (repairDemo === 'direct') {
        await repairActive()
        await checkNow()
        console.log(`repair direct: ${issueList()} note=${ws.fixNote}`)
      }
      return
    }
    const barPort = Number((window as unknown as { __demoBar?: string }).__demoBar)
    if (barPort) {
      // Live status from the local mock printers (tests/mock-printers.mjs).
      await openSample()
      ws.layout = 'workspace'
      const api = window.api.printers
      for (const p of await api.list()) await api.remove(p.id)
      await api.save({ name: 'Prusa MK4', kind: 'prusalink', url: `http://127.0.0.1:${barPort + 2}/`, username: 'maker', secret: 'prusa-test-pass' })
      await api.save({ name: 'Voron 2.4', kind: 'moonraker', url: `http://127.0.0.1:${barPort + 1}`, secret: 'moon-test-key' })
      const list = await api.save({ name: 'Ender 3 (OctoPi)', kind: 'octoprint', url: `127.0.0.1:${barPort}`, secret: 'octo-test-key' })
      await api.save({ name: 'Garage printer', kind: 'octoprint', url: `127.0.0.1:${barPort + 9}`, secret: 'x' })
      setBarHidden(false)
      refreshPrinters()
      await until(() => Object.keys(bar.status).length >= 4, 15_000)
      const octo = list.find((p) => p.kind === 'octoprint')!
      togglePrinter(octo.id)
      await until(() => !!bar.snapshots[octo.id], 15_000)
      for (const [id, s] of Object.entries(bar.status)) console.log(`bar ${bar.printers.find((p) => p.id === id)?.name}: ${s.state} ${s.detail} p=${s.progress} left=${s.remaining} noz=${s.hotend}/${s.hotendTarget} bed=${s.bed} cam=${s.camera}`)
      console.log(`bar snapshot bytes=${bar.snapshots[octo.id]?.length}`)
      return
    }
    if ((window as unknown as { __demoHistory?: boolean }).__demoHistory) {
      await openSample()
      ws.layout = 'workspace'
      ws.sidebarTab = 'slice'
      setSliceMode('resin')
      chooseResinPrinter('saturn4ultra')
      await sliceResinModel()
      const r = resin.result!
      const sc = document.querySelector('.sidebar .scroll')
      if (sc) sc.scrollTop = sc.scrollHeight
      await new Promise((res) => setTimeout(res, 300))
      const shot = getViewer()?.snapshot(160) ?? undefined
      const api = window.api.history
      for (const e of await api.list()) await api.remove(e.id)
      const base = { kind: 'resin' as const, printer: r.printer.name, seconds: r.printSeconds, grams: r.weightG, ml: r.volumeMm3 / 1000, thumbnail: shot }
      const a = await api.add({ ...base, name: 'sample-knot.stl', how: 'saved', path: 'C:\nowhere\sample-knot.goo', cost: printCost('resin', r.volumeMm3 / 1000, r.printSeconds)?.total ?? null, settings: '0.05 mm layers · 2.5 s / 30 s × 5' })
      const b = await api.add({ kind: 'fdm', name: 'bracket.stl', how: 'sent', printer: 'Voron 2.4 (Klipper)', seconds: 5400, grams: 38.2, ml: null, cost: printCost('fdm', 38.2, 5400)?.total ?? null, settings: '0.2 mm layers · 20% infill · Generic PLA' })
      await api.add({ kind: 'fdm', name: 'cable-clip.3mf', how: 'usb', printer: 'Ender 3 (USB)', seconds: 1260, grams: 6.1, ml: null, cost: printCost('fdm', 6.1, 1260)?.total ?? null, settings: '0.28 mm layers · Generic PETG' })
      await api.update(a.id, { outcome: 'ok', note: 'Crisp details, supports came off clean.' })
      await api.update(b.id, { outcome: 'failed', note: 'Warped at the corners; try a brim.' })
      await new Promise((res) => setTimeout(res, 200))
      console.log(`history: ${(await api.list()).length} entries, revealMissing=${!(await api.reveal(a.id))}`)
      if ((window as unknown as { __demoHistory?: string }).__demoHistory === 'library') {
        ws.layout = 'library'
        await new Promise((res) => setTimeout(res, 300))
        ;[...document.querySelectorAll<HTMLButtonElement>('[role=tab]')].find((t) => t.textContent?.includes('Print history'))?.click()
      }
      return
    }
    const explorerDemo = (window as unknown as { __demoExplorer?: string }).__demoExplorer
    if (explorerDemo) {
      // Browse a folder outside the Models folder, then send a model from it to the slicer.
      const [dir, action] = explorerDemo.split('|')
      setModelsOpen(true)
      const places = await window.api.models.places()
      console.log(`explorer places: ${places.map((p) => `${p.name}=${p.rel}`).join(', ')}`)
      openModelsFolder(dir!)
      await until(() => !modelsState.loading && modelsState.entries.length > 0)
      console.log(`explorer list: ${modelsState.entries.map((e) => `${e.kind}:${e.name}`).join(', ')}`)
      const model = modelsState.entries.find((e) => e.kind === 'model')!
      if (action === 'slice') {
        await sliceModelFromPanel(model.rel)
        console.log(`explorer slice: layout=${ws.layout} tab=${ws.sidebarTab} parts=${ws.parts.length} name=${ws.parts[0]?.name}`)
      } else if (action === 'zip') {
        const zip = modelsState.entries.find((e) => e.kind === 'archive')!
        await openZipFromPanel(zip.rel)
        await new Promise((r) => setTimeout(r, 1500))
        console.log(`explorer zip: cwd=${modelsState.cwd} notice=${modelsState.notice} parts=${ws.parts.length}`)
      } else {
        await new Promise((r) => setTimeout(r, 800))
      }
      return
    }
    const editDemo = (window as unknown as { __demoEdit?: string }).__demoEdit
    if (editDemo === 'orient') {
      // An "L" raised on a lone 30 mm box: seen from above (top) or the front, most of an L's area is low and left.
      const { runCsg } = await import('../engine/geometry/runCsg')
      const box = () => new Float32Array(new THREE.BoxGeometry(30, 30, 30).translate(0, 0, 15).toNonIndexed().getAttribute('position').array)
      for (const place of ['top', 'front'] as const) {
        const [out] = await runCsg({ op: 'text', solid: box(), options: { text: 'L', font: 'Arial', bold: true, size: 12, depth: 2, place, mode: 'emboss' } })
        // Area-weighted centre of the faces that stick out of the box, in the face's own right/up axes.
        let a = 0, sx = 0, sy = 0, lo = [Infinity, Infinity], hi = [-Infinity, -Infinity]
        for (let o = 0; o < out!.length; o += 9) {
          const pts = [0, 3, 6].map((k) => [out![o + k]!, out![o + k + 1]!, out![o + k + 2]!])
          const out1 = pts.every((p) => (place === 'top' ? p[2]! > 30.5 : p[1]! < -15.5))
          if (!out1) continue
          const r = pts.map((p) => [p[0]!, place === 'top' ? p[1]! : p[2]!])
          const ar = Math.abs((r[1]![0]! - r[0]![0]!) * (r[2]![1]! - r[0]![1]!) - (r[2]![0]! - r[0]![0]!) * (r[1]![1]! - r[0]![1]!)) / 2
          a += ar
          for (const q of r) {
            sx += (q[0]! * ar) / 3
            sy += (q[1]! * ar) / 3
            lo = [Math.min(lo[0]!, q[0]!), Math.min(lo[1]!, q[1]!)]
            hi = [Math.max(hi[0]!, q[0]!), Math.max(hi[1]!, q[1]!)]
          }
        }
        const cx = sx / a, cy = sy / a, mx = (lo[0]! + hi[0]!) / 2, my = (lo[1]! + hi[1]!) / 2
        console.log(`orient ${place}: centroid ${cx.toFixed(2)},${cy.toFixed(2)} box-mid ${mx.toFixed(2)},${my.toFixed(2)} size ${(hi[0]! - lo[0]!).toFixed(1)}x${(hi[1]! - lo[1]!).toFixed(1)} → ${cx < mx && cy < my ? 'reads correctly' : 'WRONG WAY'}`)
      }
      return
    }
    if (editDemo) {
      // A box and a sphere overlapping, as two parts, then one geometry edit.
      const group = new THREE.Group()
      if (editDemo.startsWith('fit')) group.add(new THREE.Mesh(new THREE.TorusKnotGeometry(110, 32, 200, 24).translate(0, 0, 150)))
      else {
        group.add(new THREE.Mesh(new THREE.BoxGeometry(30, 30, 30).translate(0, 0, 15)))
        group.add(new THREE.Mesh(new THREE.SphereGeometry(14, 48, 32).translate(15, 0, 30)))
      }
      const data = exportModel(group, '3mf')
      await openModelFile({ name: 'edit-test.3mf', format: '3mf', size: data.byteLength, data })
      ws.layout = 'workspace'
      ws.sidebarTab = 'transform'
      await until(() => !!ws.report && !ws.checking)
      const say = (what: string) => console.log(`edit ${what}: parts=${ws.parts.length} tris=${ws.parts.map((p) => p.triangles).join('+')} verdict=${ws.report?.verdict} issues=${ws.report?.issues.map((i) => i.code).join(',')} note=${ws.fixNote} error=${ws.error}`)
      say('start')
      const t0 = performance.now()
      if (editDemo === 'merge') await combineParts('union')
      if (editDemo === 'subtract') { selectPart(1); await combineParts('difference') }
      if (editDemo === 'overlap') { selectPart(1); await combineParts('intersect') }
      if (editDemo === 'cut') { selectPart(0); await cutPart('z', 12, 'both') }
      if (editDemo === 'simplify') { await combineParts('union'); await simplifyPart(0.25) }
      if (editDemo === 'smooth') { await combineParts('union'); await smoothPart(10) }
      if (editDemo === 'rebuild') { selectPart(0); await rebuildPart(0.5) }
      if (editDemo === 'fit') await splitToFit({ mode: 'smart', joiner: 'pegs', diameter: 5, clearance: 0.2 })
      if (editDemo === 'fit-palette') {
        // Same split, started the way a user would: Ctrl+K, type, Enter.
        ui.palette = true
        await new Promise((r) => setTimeout(r, 200))
        const input = document.querySelector<HTMLInputElement>('[aria-label="Search commands"]')!
        input.value = 'split to fit'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        await new Promise((r) => setTimeout(r, 200))
        console.log(`edit palette top: ${search(commands(), 'split to fit')[0]?.id}`)
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        await new Promise((r) => setTimeout(r, 400))
        console.log(`edit palette ran: open=${ui.palette} working=${ws.working}`)
      }
      if (editDemo === 'xform') {
        // Resize, move and turn, then step back and forward through them.
        const where = (t: string) => console.log(`xform ${t}: size=${['x', 'y', 'z'].map((k) => ws.stats?.size[k as 'x'].toFixed(1)).join('x')} pos=${ws.xf?.px.toFixed(1)},${ws.xf?.py.toFixed(1)} rz=${ws.xf?.rz.toFixed(0)} undo=${ws.undoLabel} redo=${ws.redoLabel}`)
        selectPart(0)
        where('start')
        scaleBy(200)
        where('scaled 200%')
        await new Promise((r) => setTimeout(r, 1300))
        moveBy(25, 0, 0)
        where('moved +25 X')
        await new Promise((r) => setTimeout(r, 1300))
        rotateBy('z', 90)
        where('turned 90')
        undo()
        where('undo 1')
        undo()
        where('undo 2')
        undo()
        where('undo 3')
        redo()
        where('redo 1')
        setUniform(false)
        setDimension('x', 50, ws.uniform)
        where('free X=50')
        setUniform(true)
        ws.tool = 'scale'
      }
      if (editDemo === 'fit-grid') await splitToFit({ mode: 'grid', joiner: 'dowels', diameter: 5, clearance: 0.2 })
      if (editDemo === 'shapes') for (const k of ['box', 'cylinder', 'sphere', 'cone', 'pyramid', 'torus', 'tube'] as const) await addShape(k, 20)
      if (editDemo === 'text-top') { selectPart(0); await writeTextOnPart({ text: 'BIRDY', font: 'Arial', bold: true, size: 6, depth: 1.5, place: 'top', mode: 'emboss' }) }
      if (editDemo === 'text-front') { selectPart(0); await writeTextOnPart({ text: 'Hi', font: 'Impact', bold: false, size: 12, depth: 1.5, place: 'front', mode: 'emboss' }) }
      if (editDemo === 'engrave') { selectPart(0); await writeTextOnPart({ text: 'A1', font: 'Arial', bold: true, size: 14, depth: 2, place: 'top', mode: 'engrave' }) }
      if (editDemo === 'text-part') { selectPart(0); await writeTextOnPart({ text: 'Birdy\nlabel', font: 'Segoe UI', bold: true, size: 8, depth: 2, place: 'top', mode: 'separate' }) }
      if (editDemo === 'color') { selectPart(1); setPartColor('#e53935'); selectPart(0); setPartColor('#1e88e5'); console.log(`edit colours: ${ws.parts.map((p) => p.color).join(',')}`) }
      if (editDemo === 'align') { selectPart(0); alignParts('x', 'min'); alignParts('z', 'min') }
      if (editDemo === 'history') { await combineParts('union'); await simplifyPart(0.1); await repairActive(); undoEdit() }
      if (editDemo === 'hollow') { await combineParts('union'); await hollowPart(2) }
      await until(() => !ws.working)
      await new Promise((r) => setTimeout(r, 1200))
      await until(() => !!ws.report && !ws.checking)
      say(`${editDemo} (${Math.round(performance.now() - t0)} ms)`)
      const look = (window as unknown as { __demoLook?: string }).__demoLook
      if (look) getViewer()?.view(look as never)
      if (ws.history.length) console.log(`edit history: ${ws.history.map((h) => h.label).join(' > ')}`)
      if (editDemo === 'undo') { await combineParts('union'); undoEdit(); await until(() => !!ws.report && !ws.checking); say('undo') }
      await new Promise((r) => setTimeout(r, 500))
      if (editDemo === 'color' || editDemo === 'align') {
        ws.sidebarTab = 'model'
        await new Promise((r) => setTimeout(r, 300))
        document.querySelector('.plate .colors')?.scrollIntoView({ block: 'center' })
      } else document.querySelector('.modify')?.scrollIntoView({ block: 'end' })
      return
    }
    const healthDemo = (window as unknown as { __demoHealth?: string }).__demoHealth
    if (healthDemo) {
      // A block with a 0.5 mm fin (thin wall), and a second block with a corner folded through it.
      const fin = new THREE.Mesh(new THREE.BoxGeometry(40, 0.5, 20).translate(0, 0, 10))
      const fold = new THREE.BoxGeometry(20, 20, 20).translate(40, 0, 10).toNonIndexed()
      const pos = fold.getAttribute('position') as THREE.BufferAttribute
      for (let i = 0; i < pos.count; i++) if (pos.getX(i) > 49 && pos.getY(i) > 9 && pos.getZ(i) > 19) pos.setZ(i, -6)
      const group = new THREE.Group()
      group.add(fin, new THREE.Mesh(new THREE.BoxGeometry(20, 20, 6).translate(0, -10, 3)), new THREE.Mesh(fold))
      const data = exportModel(group, 'stl')
      await openModelFile({ name: 'health-test.stl', format: 'stl', size: data.byteLength, data })
      ws.layout = 'workspace'
      ws.sidebarTab = 'model'
      await until(() => !!ws.report && !ws.checking)
      const st = ws.report!.stats
      console.log(`health: verdict=${ws.report!.verdict} issues=${ws.report!.issues.map((i) => i.code).join(',')} vertices=${st.vertices} intersecting=${st.intersecting} overlap=${st.overlappingParts} thin=${st.thinPct?.toFixed(1)} thinnest=${st.thinnest}`)
      if (healthDemo === 'split') {
        splitIntoParts()
        await until(() => !!ws.report && !ws.checking)
        console.log(`health split: parts=${ws.parts.length} names=${ws.parts.map((p) => p.name).join(' | ')} note=${ws.fixNote}`)
        selectPart(1)
        setIsolate(true)
        ws.sidebarTab = 'model'
      }
      if (healthDemo === 'thin' || healthDemo === 'intersect') {
        const issue = ws.report!.issues.find((i) => i.code === healthDemo)
        if (issue?.mark) focusMark(issue.mark)
      }
      await new Promise((r) => setTimeout(r, 400))
      const stats = document.querySelector('.checkstats')
      stats?.scrollIntoView({ block: 'end' })
      return
    }
    if ((window as unknown as { __demoFormats?: boolean }).__demoFormats) {
      // 3MF round trip of a two-part plate, then a small VRML file.
      await openSample()
      duplicatePart(1)
      await new Promise((r) => setTimeout(r, 100))
      const data = exportActive('3mf')!
      console.log(`formats 3mf bytes: ${data.byteLength}`)
      await openModelFile({ name: 'roundtrip.3mf', format: '3mf', size: data.byteLength, data })
      console.log(`formats 3mf reopened: models=${ws.models.length} parts=${ws.parts.length} tris=${ws.report?.stats.triangles ?? '?'}`)
      await until(() => !!ws.report && !ws.checking)
      console.log(`formats 3mf check: watertight=${ws.report?.stats.watertight} components=${ws.report?.stats.components} tris=${ws.report?.stats.triangles}`)
      const wrl = `#VRML V2.0 utf8
DirectionalLight { direction 0 -1 0 }
Background { skyColor [ 0 0 1 ] }
Shape {
  appearance Appearance { material Material { diffuseColor 0.9 0.4 0.1 } }
  geometry IndexedFaceSet {
    coord Coordinate { point [ 0 0 0, 20 0 0, 20 10 0, 0 10 0, 0 0 30, 20 0 30, 20 10 30, 0 10 30 ] }
    coordIndex [ 0 3 2 1 -1, 4 5 6 7 -1, 0 1 5 4 -1, 1 2 6 5 -1, 2 3 7 6 -1, 3 0 4 7 -1 ]
  }
}`
      const bytes = new TextEncoder().encode(wrl)
      await openModelFile({ name: 'block.wrl', format: 'wrl', size: bytes.byteLength, data: bytes })
      await until(() => !!ws.report && !ws.checking)
      console.log(`formats wrl: error=${ws.error} watertight=${ws.report?.stats.watertight} tris=${ws.report?.stats.triangles} size=${JSON.stringify(ws.report?.stats.size)}`)
      ws.layout = 'workspace'
      return
    }
    if ((window as unknown as { __demoSettle?: boolean }).__demoSettle) {
      // A tall block leaning well past its edge, floating above the plate: Settle should tip it onto its side.
      const block = new THREE.Mesh(new THREE.BoxGeometry(14, 20, 50))
      block.rotation.set(0.6, 0.25, 0.2)
      block.position.z = 40
      block.updateMatrixWorld(true)
      const data = exportModel(block, 'stl')
      await openModelFile({ name: 'leaning-block.stl', format: 'stl', size: data.byteLength, data })
      ws.layout = 'workspace'
      ws.sidebarTab = 'transform'
      await until(() => !!ws.report && !ws.checking)
      const size = () => {
        // Bounds of the model as it would be saved (binary STL as exported).
        const stl = exportActive('stl')!
        const view = new DataView(stl.buffer, stl.byteOffset, stl.byteLength)
        const b = new THREE.Box3()
        const pt = new THREE.Vector3()
        for (let t = 0; t < view.getUint32(80, true); t++)
          for (let k = 0; k < 3; k++) b.expandByPoint(pt.set(view.getFloat32(84 + t * 50 + 12 + k * 12, true), view.getFloat32(84 + t * 50 + 16 + k * 12, true), view.getFloat32(84 + t * 50 + 20 + k * 12, true)))
        const v = b.getSize(new THREE.Vector3())
        return `${v.x.toFixed(1)} x ${v.y.toFixed(1)} x ${v.z.toFixed(1)} min z ${b.min.z.toFixed(3)}`
      }
      console.log(`settle before: ${size()}`)
      settleModel()
      await new Promise((r) => setTimeout(r, 100))
      console.log(`settle after: ${size()} | ${ws.fixNote}`)
      settleModel()
      console.log(`settle again: ${size()} | ${ws.fixNote}`)
      return
    }
    if ((window as unknown as { __demoOrient?: boolean }).__demoOrient) {
      // A bracket printed the hard way: an L standing on its thin edge, tipped over.
      const parts = [new THREE.BoxGeometry(40, 20, 4).translate(0, 0, 18), new THREE.BoxGeometry(4, 20, 30).translate(-18, 0, 5)]
      const group = new THREE.Group()
      for (const g of parts) group.add(new THREE.Mesh(g))
      group.rotation.set(0.4, 0.2, 0.3)
      group.updateMatrixWorld(true)
      const data = exportModel(group, 'stl')
      await openModelFile({ name: 'bracket.stl', format: 'stl', size: data.byteLength, data })
      ws.layout = 'workspace'
      ws.sidebarTab = 'transform'
      await until(() => !!ws.report && !ws.checking)
      const before = ws.report?.stats.overhangPct ?? 0
      autoOrient()
      await new Promise((r) => setTimeout(r, 100))
      await checkNow()
      console.log(`orient: overhang ${before.toFixed(1)}% -> ${ws.report?.stats.overhangPct.toFixed(1)}% note=${ws.fixNote}`)
      return
    }
    const plateDemo = (window as unknown as { __demoPlate?: string }).__demoPlate
    if (plateDemo) {
      await openSample()
      ws.layout = 'workspace'
      ws.sidebarTab = 'model'
      duplicatePart(2)
      const fits = arrangePlate()
      selectPart(1)
      await until(() => !!ws.report && !ws.checking)
      await checkNow()
      const stl = exportActive('stl')
      console.log(`plate: parts=${ws.parts.length} sel=${ws.selPart} fits=${fits} verdict=${ws.report?.verdict} issues=${issueList()} stlTris=${stl ? (stl.byteLength - 84) / 50 : 0}`)
      if (plateDemo === 'repair') {
        await repairActive()
        console.log(`plate repair: parts=${ws.parts.length} note=${ws.fixNote}`)
      }
      return
    }
    const resinDemo = (window as unknown as { __demoResin?: string }).__demoResin
    if (resinDemo?.endsWith(':islands') || resinDemo?.endsWith(':supports')) await openIslandSample()
    else await openSample()
    ws.layout = 'split'
    if (resinDemo) {
      ws.layout = 'workspace'
      ws.sidebarTab = 'slice'
      setSliceMode('resin')
      chooseResinPrinter(resinDemo.split(':')[0]!)
      const t0 = performance.now()
      setSupport('enabled', resinDemo.endsWith(':supports') || resinDemo.endsWith(':hollow'))
      setHollow('enabled', resinDemo.endsWith(':hollow'))
      if (resinDemo.endsWith(':test')) await makeExposureTest()
      else await sliceResinModel()
      const r = resin.result
      await new Promise((r) => setTimeout(r, 300))
      const sc = document.querySelector('.sidebar .scroll')
      if (sc) sc.scrollTop = sc.scrollHeight
      if (resin.result?.islands.length) {
        pickIsland(0)
        await new Promise((r) => setTimeout(r, 400))
        const list = document.querySelector('.islands')
        list?.scrollIntoView({ block: 'center' })
      }
      if (r?.support || r?.hollow) console.log(`resin extras: ${JSON.stringify({ support: r.support, hollow: r.hollow, islands: r.islandCount })}`)
      console.log(`resin: ${resin.error ?? `${r?.layers} layers ${((r?.bytes ?? 0) / 1e6).toFixed(1)}MB ${((r?.volumeMm3 ?? 0) / 1000).toFixed(1)}ml ${Math.round(r?.printSeconds ?? 0)}s in ${Math.round(performance.now() - t0)}ms`}`)
      if (resinDemo.endsWith(':send')) {
        // Wi-Fi send to the local mock Elegoo printer (tests/mock-elegoo.mjs).
        const api = window.api.printers
        for (const p of await api.list()) await api.remove(p.id)
        const nobody = (await api.save({ name: 'Wrong address', kind: 'elegoo', url: '127.0.0.2' })).find((p) => p.name === 'Wrong address')!
        console.log(`sdcp test wrong: ${JSON.stringify(await api.test(nobody.id))}`)
        await api.remove(nobody.id)
        const list = await api.save({ name: 'Saturn 4 Ultra', kind: 'elegoo', url: '127.0.0.1' })
        sl.printers = list
        const p = list[0]!
        console.log(`sdcp test: ${JSON.stringify(await api.test(p.id))}`)
        console.log(`sdcp not offered for G-code: ${!sl.printers.filter((x) => isFdmKind(x.kind)).length}`)
        resin.startPrint = true
        await sendResin(p.id, p.name)
        console.log(`sdcp send: ${JSON.stringify(resin.sendResult)}`)
        setBarHidden(false)
        refreshPrinters()
        await until(() => bar.status[p.id]?.state === 'printing', 10_000)
        togglePrinter(p.id)
        console.log(`sdcp status: ${JSON.stringify(bar.status[p.id])}`)
        await new Promise((res) => setTimeout(res, 600))
        const sc2 = document.querySelector('.sidebar .scroll')
        if (sc2) sc2.scrollTop = sc2.scrollHeight
      }
      return
    }
    const sliceDemo = new URLSearchParams(location.search).get('demo') ?? (window as unknown as { __demoSlice?: string }).__demoSlice
    if (!sliceDemo) return
    ws.layout = 'workspace'
    ws.sidebarTab = 'slice'
    if (!(await until(() => !!sl.engine, 10_000))) throw new Error('no engine state')
    if (!sl.engine?.source && (window as unknown as { __demoInstall?: boolean }).__demoInstall) await installEngine()
    if (!sl.engine?.source) throw new Error(sl.error ?? 'no engine')
    if (!sl.catalog) await loadCatalog()
    if (!sl.catalog) throw new Error(sl.catalogError ?? 'no catalog')
    if (sliceDemo.startsWith('import:')) {
      await importFrom(sliceDemo.slice(7) as 'orca' | 'bambu' | 'prusa' | 'cura')
      console.log(`import: ${JSON.stringify($state.snapshot(sl.settings))} notes=${sl.importNotes.join(' | ')} error=${sl.error}`)
    } else if (sliceDemo.startsWith('bed:')) {
      // The plate follows the printer: switch through a few and read the build volume each time.
      for (const name of sliceDemo.slice(4).split('|')) {
        const before = `${BED.x}x${BED.y}x${BED.z}`
        chooseMachine(name)
        await until(() => `${BED.x}x${BED.y}x${BED.z}` !== before, 60_000)
        console.log(`bed ${name}: ${BED.x} x ${BED.y} x ${BED.z} (process ${sl.settings.process}, filament ${sl.settings.filament})`)
        await new Promise((r) => setTimeout(r, 300))
      }
    } else if (sliceDemo === 'custom' || sliceDemo === 'custom-edit') {
      // Add a printer through the editor, the way a person would.
      const setIn = (el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null | undefined, v: string) => {
        if (!el) throw new Error('field missing')
        el.value = v
        el.dispatchEvent(new Event(el instanceof HTMLInputElement && el.type === 'text' ? 'input' : 'change', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
      }
      const fieldByLabel = (label: string) =>
        [...document.querySelectorAll<HTMLLabelElement>('.dlg label')].find((l) => l.querySelector('span')?.textContent?.trim().startsWith(label))?.querySelector<HTMLInputElement | HTMLSelectElement>('input, select')
      const tab = async (t: string) => {
        ;[...document.querySelectorAll<HTMLButtonElement>('.dlg .tabs button')].find((b) => b.textContent?.startsWith(t))?.click()
        await new Promise((r) => setTimeout(r, 150))
      }
      const ready = () => !!document.querySelector<HTMLButtonElement>('.dlg footer .primary') && !document.querySelector<HTMLButtonElement>('.dlg footer .primary')!.disabled
      if (sliceDemo === 'custom-edit') {
        chooseMachine('Birdy Test Printer')
        openPrinterEditor('Birdy Test Printer')
      } else {
        if (sl.catalog?.machines.some((x) => x.name === 'Birdy Test Printer')) {
          for (const k of ['process', 'filament'] as const) for (const p of sl.catalog![k === 'process' ? 'processes' : 'filaments'].filter((x) => x.name.endsWith('@Birdy Test Printer'))) await window.api.engine.deleteCustom(k, p.name)
          sl.catalog = await window.api.engine.deleteCustom('machine', 'Birdy Test Printer')
        }
        openPrinterEditor()
      }
      const t0 = performance.now()
      if (!(await until(ready, 90_000))) throw new Error('editor never loaded its defaults')
      if (sliceDemo === 'custom') {
        setIn(document.querySelector<HTMLInputElement>('.dlg .top input'), 'Birdy Test Printer')
        setIn(fieldByLabel('Bed width X'), '220')
        setIn(fieldByLabel('Bed depth Y'), '180')
        setIn(fieldByLabel('Max height'), '150')
        setIn(fieldByLabel('Retraction'), '5.2')
        setIn(fieldByLabel('Heated bed'), 'no')
        await tab('Heating')
        setIn(fieldByLabel('Nozzle'), '213')
        setIn(fieldByLabel('Fan max'), '77')
        await tab('Print settings')
        setIn(fieldByLabel('Walls'), '4')
        await tab('All settings')
        setIn(document.querySelector<HTMLInputElement>('.dlg .search'), 'skirt_distance')
        document.querySelector<HTMLInputElement>('.dlg .search')!.dispatchEvent(new Event('input', { bubbles: true }))
        await new Promise((r) => setTimeout(r, 150))
        setIn(document.querySelector<HTMLInputElement>('.dlg .all .row input'), '7')
      } else {
        await tab('Heating')
        console.log(`custom-edit loaded: nozzle=${(fieldByLabel('Nozzle') as HTMLInputElement).value} changed=${document.querySelectorAll('.dlg .field.chg').length}`)
        setIn(fieldByLabel('Nozzle'), '208')
      }
      const shot = document.querySelector('.dlg .tabs')?.textContent
      console.log(`custom editor tabs: ${shot}`)
      document.querySelector<HTMLButtonElement>('.dlg footer .primary')!.click()
      if (!(await until(() => !sl.editor, 30_000))) throw new Error(document.querySelector('.dlg .err')?.textContent ?? 'save failed')
      const m = sl.catalog?.machines.find((x) => x.name === sl.settings.machine)
      console.log(`custom saved: machine=${sl.settings.machine} vendor=${m?.vendor} custom=${m?.custom} heatedBed=${m?.heatedBed} process=${sl.settings.process} filament=${sl.settings.filament}`)
      await until(() => BED.x === 220 && BED.y === 180, 90_000)
      console.log(`custom bed: ${BED.x} x ${BED.y} x ${BED.z} after ${Math.round(performance.now() - t0)} ms`)
    } else if (sliceDemo.startsWith('editor:')) {
      // Leave the printer editor open on a tab, for a screenshot.
      chooseMachine('Anycubic Mega X 0.4 nozzle')
      openPrinterEditor('Anycubic Mega X 0.4 nozzle')
      await until(() => !!document.querySelector<HTMLButtonElement>('.dlg footer .primary:not([disabled])'), 90_000)
      ;[...document.querySelectorAll<HTMLButtonElement>('.dlg .tabs button')].find((b) => b.textContent?.startsWith(sliceDemo.slice(7)))?.click()
      await new Promise((r) => setTimeout(r, 500))
      console.log(`editor open: ${document.querySelectorAll('.dlg .field').length} fields, ${document.querySelectorAll('.dlg .field.chg').length} changed`)
      return
    } else if (sliceDemo.startsWith('fil:')) {
      // "fil:<printer>|<filament>": slice with a given filament on a given printer.
      const [mach, fil] = sliceDemo.slice(4).split('|')
      chooseMachine(mach!)
      if (fil) setPreset('filament', fil)
      await until(() => BED.x !== 0, 60_000)
      console.log(`fil: ${sl.settings.machine} / ${sl.settings.process} / ${sl.settings.filament} bed=${BED.x}x${BED.y}x${BED.z}`)
    } else chooseMachine(sliceDemo)
    await slice()
    if (sl.error) throw new Error(sl.error)
    await until(() => sl.preview.ready)
    setPreviewLayer(Math.round(sl.preview.layers * 0.6))
    await new Promise((r) => setTimeout(r, 300))
    const scroller = document.querySelector('.sidebar .scroll')
    if (scroller) scroller.scrollTop = scroller.scrollHeight

    // Upload test against local mock printers (tests/mock-printers.mjs), then remove them.
    const port = Number((window as unknown as { __demoPrinters?: string }).__demoPrinters)
    if (port && sl.result?.jobId) {
      const api = window.api.printers
      const setups = [
        { name: 'Mock OctoPrint', kind: 'octoprint' as const, url: `127.0.0.1:${port}`, secret: 'octo-test-key' },
        { name: 'Mock Moonraker', kind: 'moonraker' as const, url: `http://127.0.0.1:${port + 1}`, secret: 'moon-test-key' },
        { name: 'Mock PrusaLink', kind: 'prusalink' as const, url: `http://127.0.0.1:${port + 2}/`, username: 'maker', secret: 'prusa-test-pass' },
        { name: 'Wrong key', kind: 'octoprint' as const, url: `127.0.0.1:${port}`, secret: 'nope' },
        { name: 'Nobody home', kind: 'octoprint' as const, url: `127.0.0.1:${port + 9}`, secret: 'x' },
      ]
      for (const s of setups) {
        const list = await api.save(s)
        const p = list.find((x) => x.name === s.name)!
        const t = await api.test(p.id)
        const r = await api.send({ printerId: p.id, jobId: sl.result.jobId, startPrint: s.kind !== 'moonraker' })
        console.log(`printer ${s.name}: secretStored=${p.hasSecret} url=${p.url} test=${t.ok}:${t.detail} send=${r.ok}:${r.detail}`)
        await api.remove(p.id)
      }
      sl.printers = await api.list()
    }
    console.log(`slice: ${sl.result?.summary?.printTime} ${sl.result?.summary?.filamentG}g layers=${sl.preview.layers} features=${sl.preview.features.map((f) => f.name).join('/')}`)
    if ((window as unknown as { __demoSave?: boolean }).__demoSave) {
      await saveGcode()
      console.log(`save: notice=${ws.notice?.text} error=${sl.error}`)
    }
    if (sl.result?.jobId) {
      // What the engine actually used, from the G-code's settings block.
      const text = new TextDecoder().decode(await window.api.engine.readGcode(sl.result.jobId))
      const pick = (k: string) => new RegExp(`^; ${k} = (.*)$`, 'm').exec(text)?.[1]
      console.log(`gcode: ${['printable_area', 'printable_height', 'retraction_length', 'nozzle_temperature', 'hot_plate_temp', 'fan_max_speed', 'wall_loops', 'skirt_distance', 'filament_type', 'gcode_flavor', 'outer_wall_speed', 'layer_height'].map((k) => `${k}=${pick(k)}`).join(' ')}`)
    }
  }
  ;(window as unknown as { __setTheme: (id: string, open: boolean) => void }).__setTheme = (id, open) => {
    const a = ACCENTS.find((x) => x.id === id)
    if (a) applyAccent(a)
    else if (/^#[0-9a-f]{6}$/i.test(id)) applyCustomAccent(id)
    theme.panelOpen = open
  }
  ;(window as unknown as { __models: (folder: string, open?: string) => Promise<string> }).__models = async (folder, open) => {
    setModelsOpen(true)
    if (folder === '!import') {
      await importModelsFromDownloads()
      folder = ''
      console.log(`models import: ${modelsState.notice}`)
    }
    openModelsFolder(folder)
    await until(() => !modelsState.loading && modelsState.entries.length > 0, 5000)
    await until(() => modelsState.entries.every((e) => e.kind === 'dir' || !!modelsState.thumbs[e.rel]), 15_000)
    if (open) await openModelsModel(open)
    return modelsState.entries.map((e) => `${e.kind}:${e.name}${modelsState.thumbs[e.rel] ? '+thumb' : ''}`).join(', ')
  }
  window.__setLayout = (l: string) => {
    if (l === 'browse' || l === 'split' || l === 'workspace' || l === 'library') ws.layout = l
  }
}
