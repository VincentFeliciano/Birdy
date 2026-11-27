// Everything the command palette can do, and the keyboard shortcuts overlay.
import { ACCENTS, applyAccent, cycleAccent, theme } from './theme.svelte'
import { checkNow as checkForUpdates } from './updates.svelte'
import { focusAddress } from '../stores/browser.svelte'
import { setModelsOpen, models } from '../features/models/store.svelte'
import { bar, networkPrinters, refreshPrinters, setBarHidden } from '../features/printers/status.svelte'
import { setMode as setSliceMode } from '../features/slicing/resin.svelte'
import {
  activeModel,
  addToPlateFromDialog,
  arrangePlate,
  autoOrient,
  centerOnBed,
  checkNow,
  dropToBed,
  duplicatePart,
  fit,
  openFromDialog,
  remember,
  removePart,
  repairActive,
  resetTransform,
  saveAs,
  setProjection,
  setTool,
  setView,
  toggle,
  ws,
} from '../features/workspace/store.svelte'

export const ui = $state({ tour: false, palette: false, shortcuts: false, libraryTab: null as null | 'models' | 'bookmarks' | 'history' | 'about' })

const TOUR_KEY = 'birdy.tourDone'

export function startTour() {
  ui.palette = false
  ui.shortcuts = false
  ui.tour = true
}

export function finishTour() {
  ui.tour = false
  localStorage.setItem(TOUR_KEY, '1')
}

/** First launch: show the tour once (not in screenshot runs, which set __noTour). */
export function maybeStartTour() {
  if (localStorage.getItem(TOUR_KEY) || (window as unknown as { __noTour?: boolean }).__noTour) return
  startTour()
}

export interface Command {
  id: string
  title: string
  group: string
  keys?: string
  /** Extra words that should find it. */
  words?: string
  when?: () => boolean
  run: () => unknown
}

const hasModel = () => !!activeModel()
const showWorkspace = () => {
  if (ws.layout === 'browse' || ws.layout === 'library') ws.layout = 'workspace'
}
const sidebar = (tab: 'model' | 'transform' | 'slice') => {
  showWorkspace()
  ws.sidebarOpen = true
  ws.sidebarTab = tab
  remember()
}
const layout = (l: 'browse' | 'split' | 'workspace' | 'library') => {
  ws.layout = l
  remember()
}

export function commands(): Command[] {
  const list: Command[] = [
    { id: 'open', title: 'Open a model…', group: 'File', keys: 'Ctrl+O', words: 'load stl 3mf obj file', run: openFromDialog },
    { id: 'add', title: 'Add a model to the plate…', group: 'File', words: 'plate import another', when: hasModel, run: addToPlateFromDialog },
    { id: 'save', title: 'Save model as…', group: 'File', words: 'export stl obj', when: hasModel, run: saveAs },
    { id: 'tab', title: 'New browser tab', group: 'Browser', keys: 'Ctrl+T', run: () => window.api.tabs.create() },
    { id: 'address', title: 'Go to the address bar', group: 'Browser', keys: 'Ctrl+L', words: 'url search website', run: () => {
      if (ws.layout === 'workspace' || ws.layout === 'library') ws.layout = 'split'
      focusAddress()
    } },

    { id: 'layout-browse', title: 'Show the website only', group: 'Layout', words: 'browse web', run: () => layout('browse') },
    { id: 'layout-split', title: 'Show website and workspace side by side', group: 'Layout', words: 'split', run: () => layout('split') },
    { id: 'layout-workspace', title: 'Show the workspace only', group: 'Layout', keys: 'Ctrl+E', words: 'viewer 3d', run: () => layout('workspace') },
    { id: 'layout-library', title: 'Open the library', group: 'Layout', words: 'saved bookmarks', run: () => layout('library') },
    {
      id: 'history',
      title: 'Show print history',
      group: 'Layout',
      words: 'prints cost spent log',
      run: () => {
        ui.libraryTab = 'history'
        layout('library')
      },
    },
    { id: 'models', title: models.open ? 'Hide the Models panel' : 'Show the Models panel', group: 'Layout', words: 'folder files', run: () => setModelsOpen(!models.open) },
    {
      id: 'printer-bar',
      title: bar.hidden ? 'Show the printer status bar' : 'Hide the printer status bar',
      group: 'Layout',
      words: 'octoprint klipper prusalink webcam',
      when: () => networkPrinters().length > 0,
      run: () => {
        setBarHidden(!bar.hidden)
        refreshPrinters()
      },
    },
    {
      id: 'sidebar',
      title: ws.sidebarOpen ? 'Hide the workspace sidebar' : 'Show the workspace sidebar',
      group: 'Layout',
      run: () => {
        ws.sidebarOpen = !ws.sidebarOpen
        remember()
      },
    },

    { id: 'tool-select', title: 'Select / orbit tool', group: 'View', keys: 'Q', when: hasModel, run: () => setTool('select') },
    { id: 'tool-move', title: 'Move tool', group: 'View', keys: 'W', when: hasModel, run: () => setTool('move') },
    { id: 'tool-rotate', title: 'Rotate tool', group: 'View', keys: 'E', when: hasModel, run: () => setTool('rotate') },
    { id: 'tool-scale', title: 'Scale tool', group: 'View', keys: 'R', when: hasModel, run: () => setTool('scale') },
    { id: 'fit', title: 'Fit the model in view', group: 'View', keys: 'F', words: 'zoom frame', when: hasModel, run: fit },
    { id: 'view-iso', title: 'Isometric view', group: 'View', when: hasModel, run: () => setView('iso') },
    { id: 'view-front', title: 'Front view', group: 'View', when: hasModel, run: () => setView('front') },
    { id: 'view-top', title: 'Top view', group: 'View', when: hasModel, run: () => setView('top') },
    { id: 'view-bottom', title: 'Bottom view', group: 'View', words: 'underside', when: hasModel, run: () => setView('bottom') },
    {
      id: 'projection',
      title: ws.projection === 'perspective' ? 'Switch to orthographic camera' : 'Switch to perspective camera',
      group: 'View',
      when: hasModel,
      run: () => setProjection(ws.projection === 'perspective' ? 'orthographic' : 'perspective'),
    },
    { id: 'wireframe', title: 'Toggle wireframe', group: 'View', when: hasModel, run: () => toggle('wireframe') },
    { id: 'grid', title: 'Toggle the bed grid', group: 'View', when: hasModel, run: () => toggle('grid') },
    { id: 'bbox', title: 'Toggle the bounding box', group: 'View', when: hasModel, run: () => toggle('bbox') },

    { id: 'orient', title: 'Auto-orient for printing', group: 'Model', words: 'rotate overhang flat', when: hasModel, run: autoOrient },
    { id: 'drop', title: 'Drop the model onto the bed', group: 'Model', words: 'floor', when: hasModel, run: dropToBed },
    { id: 'center', title: 'Center on the bed', group: 'Model', when: hasModel, run: centerOnBed },
    { id: 'reset', title: 'Reset position, rotation and scale', group: 'Model', words: 'transform undo', when: hasModel, run: resetTransform },
    { id: 'check', title: 'Run the print check again', group: 'Model', words: 'problems errors', when: hasModel, run: checkNow },
    { id: 'repair', title: 'Repair the model', group: 'Model', words: 'fix holes normals', when: hasModel, run: repairActive },
    { id: 'duplicate', title: 'Duplicate the selected part', group: 'Model', words: 'copy plate', when: hasModel, run: () => duplicatePart(1) },
    { id: 'arrange', title: 'Arrange the plate', group: 'Model', words: 'pack layout parts', when: () => ws.parts.length > 1, run: arrangePlate },
    { id: 'remove-part', title: 'Remove the selected part from the plate', group: 'Model', words: 'delete', when: () => ws.parts.length > 1, run: removePart },

    { id: 'slice', title: 'Slice for a filament printer', group: 'Slice', words: 'fdm gcode orca', when: hasModel, run: () => { setSliceMode('fdm'); sidebar('slice') } },
    { id: 'slice-resin', title: 'Slice for a resin printer', group: 'Slice', words: 'goo elegoo saturn mars sla msla', when: hasModel, run: () => { setSliceMode('resin'); sidebar('slice') } },

    { id: 'theme', title: 'Change the accent colour…', group: 'Birdy', words: 'theme colour color neon', run: () => (theme.panelOpen = true) },
    { id: 'accent-next', title: 'Next accent colour', group: 'Birdy', words: 'theme cycle', run: cycleAccent },
    { id: 'updates', title: 'Check for updates', group: 'Birdy', words: 'version upgrade', run: checkForUpdates },
    { id: 'tour', title: 'Take the tour', group: 'Birdy', words: 'help welcome intro guide', run: startTour },
    { id: 'shortcuts', title: 'Keyboard shortcuts', group: 'Birdy', keys: '?', words: 'help keys', run: () => (ui.shortcuts = true) },
    {
      id: 'about',
      title: 'About Birdy and credits',
      group: 'Birdy',
      words: 'licence license orcaslicer',
      run: () => {
        ui.libraryTab = 'about'
        layout('library')
      },
    },
  ]
  for (const a of ACCENTS) list.push({ id: `accent-${a.id}`, title: `Accent: ${a.name}`, group: 'Birdy', words: 'theme colour color', run: () => applyAccent(a) })
  return list.filter((c) => !c.when || c.when())
}

/** Subsequence match with a bonus for word starts and runs; null when the query doesn't match. */
export function score(query: string, text: string): number | null {
  const q = query.toLowerCase().replace(/\s+/g, '')
  if (!q) return 0
  const t = text.toLowerCase()
  // Whole substrings beat scattered letters; a word that starts with the query beats both.
  const words = query.toLowerCase().trim().split(/\s+/)
  if (words.every((w) => t.includes(w))) {
    let s = 100
    for (const w of words) {
      const i = t.indexOf(w)
      const atWord = (j: number) => j === 0 || /[\s/·(-]/.test(t[j - 1])
      let j = i
      while (j >= 0 && !atWord(j)) j = t.indexOf(w, j + 1)
      s += j >= 0 ? 30 - j * 0.1 : 10 - i * 0.1
    }
    return s - t.length * 0.01
  }
  let s = 0
  let ti = 0
  let run = 0
  for (const ch of q) {
    const at = t.indexOf(ch, ti)
    if (at < 0) return null
    run = at === ti ? run + 1 : 0
    s += 1 + run * 2 + (at === 0 || /[\s/·(-]/.test(t[at - 1]) ? 4 : 0) - Math.min(at - ti, 6) * 0.3
    ti = at + 1
  }
  return s - t.length * 0.01
}

export function search(list: Command[], query: string): Command[] {
  if (!query.trim()) return list
  const ranked: { c: Command; s: number }[] = []
  for (const c of list) {
    const a = score(query, c.title)
    const b = c.words ? score(query, `${c.title} ${c.words} ${c.group}`) : score(query, `${c.title} ${c.group}`)
    const s = Math.max(a ?? -Infinity, b === null ? -Infinity : b - 3)
    if (s > -Infinity) ranked.push({ c, s })
  }
  return ranked.sort((x, y) => y.s - x.s).map((r) => r.c)
}

export const SHORTCUTS: { group: string; items: [string, string][] }[] = [
  {
    group: 'Anywhere',
    items: [
      ['Ctrl+K', 'Command palette'],
      ['Ctrl+/  or  ?', 'This list of shortcuts'],
      ['Ctrl+O', 'Open a model'],
      ['Ctrl+E', 'Switch between website and workspace'],
      ['F11', 'Full screen'],
    ],
  },
  {
    group: 'Browser',
    items: [
      ['Ctrl+T', 'New tab'],
      ['Ctrl+W', 'Close tab'],
      ['Ctrl+Tab', 'Next tab (Shift for previous)'],
      ['Ctrl+L  or  Alt+D', 'Address bar'],
      ['Alt+← / Alt+→', 'Back / forward'],
      ['Ctrl+R  or  F5', 'Reload (Shift to skip the cache)'],
      ['Ctrl+= / Ctrl+- / Ctrl+0', 'Zoom the website'],
      ['F12', 'Developer tools for the website'],
    ],
  },
  {
    group: '3D viewport',
    items: [
      ['Q', 'Select / orbit'],
      ['W', 'Move'],
      ['E', 'Rotate'],
      ['R', 'Scale'],
      ['F', 'Fit the model in view'],
      ['Left drag', 'Orbit'],
      ['Right drag', 'Pan'],
      ['Wheel', 'Zoom'],
      ['Click a part', 'Select it on a plate'],
    ],
  },
  {
    group: 'Files',
    items: [['Drop files', 'Drop STL, 3MF, OBJ, GLB, glTF or PLY anywhere in Birdy to open them']],
  },
]
