import * as THREE from 'three'
import { exportModel } from '../engine/exporters/exportModel'
import { openModelFile, ws } from '../features/workspace/store.svelte'
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

/** Dev hooks used by the `--demo` screenshot runs. */
export function installDemo() {
  window.__demo = async () => {
    await openSample()
    ws.layout = 'split'
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
  window.__setLayout = (l: string) => {
    if (l === 'browse' || l === 'split' || l === 'workspace' || l === 'library') ws.layout = l
  }
}
