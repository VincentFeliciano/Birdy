import * as THREE from 'three'
import { importDownloads as importModelsFromDownloads, models as modelsState, openFolder as openModelsFolder, openModel as openModelsModel, setModelsOpen } from '../features/models/store.svelte'
import { ACCENTS, applyAccent, applyCustomAccent, theme } from './theme.svelte'
import { exportModel } from '../engine/exporters/exportModel'
import { arrangePlate, checkNow, duplicatePart, exportActive, focusMark, openModelFile, repairActive, selectPart, setXForm, ws } from '../features/workspace/store.svelte'
import { choosePrinter as chooseResinPrinter, makeExposureTest, pickIsland, resin, setMode as setSliceMode, sliceResinModel } from '../features/slicing/resin.svelte'
import { chooseMachine, importFrom, installEngine, loadCatalog, setPreviewLayer, sl, slice } from '../features/slicing/store.svelte'

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
    if (resinDemo?.endsWith(':islands')) await openIslandSample()
    else await openSample()
    ws.layout = 'split'
    if (resinDemo) {
      ws.layout = 'workspace'
      ws.sidebarTab = 'slice'
      setSliceMode('resin')
      chooseResinPrinter(resinDemo.split(':')[0]!)
      const t0 = performance.now()
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
      console.log(`resin: ${resin.error ?? `${r?.layers} layers ${((r?.bytes ?? 0) / 1e6).toFixed(1)}MB ${((r?.volumeMm3 ?? 0) / 1000).toFixed(1)}ml ${Math.round(r?.printSeconds ?? 0)}s in ${Math.round(performance.now() - t0)}ms`}`)
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
