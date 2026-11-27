import { app, BrowserWindow, ipcMain, Menu, session, type Input } from 'electron'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isSearchType, type NewBookmark, type NewLibraryModel, type SaveRequest, type SlicerHandoff } from '../src/types/ipc'
import { BrowserManager } from './browser-manager'
import { installSignInHeaders } from './user-agent'
import { Library } from './library'
import { chooseSlicer, listSlicers, openInSlicer, setDefaultSlicer } from './slicer-launcher'
import { DownloadManager } from './download-manager'
import { openModelDialog, reopenSaved, saveModel, workspaceDirs } from './file-system'
import { assertTrusted, isId, isRect, isShortString, setTrustedUi } from './security'
import { SlicingEngine } from './slicing/engine'
import { importCandidates, importSettings } from './slicing/import'
import { listPrinters, removePrinter, savePrinter, sendToPrinter, testPrinter } from './printers'
import type { ImportSource, PrinterInput, SendRequest, SerialPortChoice, SliceRequest } from '../src/types/slicing'

app.setName('Birdy')
// Screenshot mode must keep painting even when other windows cover this one.
if (process.argv.some((x) => x.startsWith('--screenshot='))) {
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
  app.commandLine.appendSwitch('disable-renderer-backgrounding')
  app.commandLine.appendSwitch('disable-background-timer-throttling')
}
if (!app.requestSingleInstanceLock()) app.quit()

let win: BrowserWindow | null = null
let browser: BrowserManager | null = null
let downloads: DownloadManager | null = null
let library: Library | null = null
let engine: SlicingEngine | null = null
let serialCallback: ((portId: string) => void) | null = null

const startPageUrl = pathToFileURL(join(app.getAppPath(), 'resources', 'start.html')).href

function sendShortcut(name: string) {
  if (!win) return
  if (name === 'focus-address') win.webContents.focus()
  win.webContents.send('app:shortcut', name)
}

/** Keyboard shortcuts, handled the same whether the app UI or a website has focus. */
function handleShortcut(input: Input): boolean {
  if (input.type !== 'keyDown' || !browser || !win) return false
  const ctrl = input.control || input.meta
  const k = input.key.toLowerCase()
  const wc = browser.active?.view.webContents
  if (ctrl && !input.shift && k === 't') {
    browser.create()
    sendShortcut('focus-address')
  } else if (ctrl && k === 'w') {
    if (browser.activeId) browser.close(browser.activeId)
  } else if ((ctrl && k === 'l') || (input.alt && k === 'd')) sendShortcut('focus-address')
  else if (ctrl && k === 'tab') browser.cycle(input.shift ? -1 : 1)
  else if ((ctrl && k === 'r') || k === 'f5') {
    if (input.shift) wc?.reloadIgnoringCache()
    else wc?.reload()
  } else if (input.alt && k === 'arrowleft') wc?.navigationHistory.goBack()
  else if (input.alt && k === 'arrowright') wc?.navigationHistory.goForward()
  else if (ctrl && (k === '=' || k === '+')) wc?.setZoomLevel(Math.min(wc.getZoomLevel() + 0.5, 5))
  else if (ctrl && k === '-') wc?.setZoomLevel(Math.max(wc.getZoomLevel() - 0.5, -5))
  else if (ctrl && k === '0') wc?.setZoomLevel(0)
  else if (ctrl && k === 'e') sendShortcut('toggle-workspace')
  else if (ctrl && k === 'o') sendShortcut('open-model')
  else if (k === 'f12') wc?.openDevTools({ mode: 'detach' })
  else if (k === 'f11') win.setFullScreen(!win.isFullScreen())
  else return false
  return true
}

function createWindow() {
  const dirs = workspaceDirs()
  const browserSession = session.fromPartition('persist:browser')

  // Present as a normal Chromium browser so sites don't block an unknown client.
  browserSession.setUserAgent(
    browserSession
      .getUserAgent()
      .replace(/\s?Electron\/\S+/, '')
      .replace(new RegExp(`\\s?(${app.getName()}|birdy)\\/\\S+`, 'i'), ''),
  )
  installSignInHeaders(browserSession)
  // Websites get no device permissions in the MVP except fullscreen and clipboard writes.
  browserSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(permission === 'fullscreen' || permission === 'clipboard-sanitized-write')
  })

  win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 980,
    minHeight: 620,
    show: false,
    title: 'Birdy',
    backgroundColor: '#0b0c0f',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0b0c0f', symbolColor: '#E6E8EB', height: 44 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
    },
  })
  setTrustedUi(win.webContents)
  win.once('ready-to-show', () => win?.show())

  // The app UI never navigates or opens windows; dropped files are handled in-page.
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('before-input-event', (e, input) => {
    if (handleShortcut(input)) e.preventDefault()
  })

  browser = new BrowserManager(win, { session: browserSession, startPageUrl, onShortcut: handleShortcut })
  downloads = new DownloadManager(win, browserSession, dirs.downloads)
  library = new Library(dirs.library, (d) => win?.webContents.send('library:changed', d))
  engine = new SlicingEngine((st) => win?.webContents.send('engine:state', st))
  setupSerial(win)
  registerIpc(dirs.exports)

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))

  win.webContents.once('did-finish-load', () => {
    browser?.restore()
    maybeScreenshot()
  })
  win.on('close', () => browser?.persist())
  win.on('closed', () => {
    win = null
  })
}

function registerIpc(exportsDir: string) {
  const on = (channel: string, fn: (...args: unknown[]) => void) =>
    ipcMain.on(channel, (e, ...args) => {
      try {
        assertTrusted(e)
        fn(...args)
      } catch (err) {
        console.warn(`[ipc] ${channel}:`, (err as Error).message)
      }
    })
  const handle = (channel: string, fn: (...args: unknown[]) => Promise<unknown>) =>
    ipcMain.handle(channel, (e, ...args) => {
      assertTrusted(e)
      return fn(...args)
    })

  on('tabs:create', (url) => browser?.create(isShortString(url) ? url : undefined))
  on('tabs:close', (id) => isId(id) && browser?.close(id))
  on('tabs:activate', (id) => isId(id) && browser?.activate(id))
  on('tabs:navigate', (input, type) => isShortString(input, 8192) && browser?.navigate(input, isSearchType(type) ? type : 'models'))
  on('tabs:back', () => browser?.active?.view.webContents.navigationHistory.goBack())
  on('tabs:forward', () => browser?.active?.view.webContents.navigationHistory.goForward())
  on('tabs:reload', () => browser?.active?.view.webContents.reload())
  on('tabs:stop', () => browser?.active?.view.webContents.stop())
  on('tabs:home', () => browser?.home())
  on('layout:bounds', (rect) => isRect(rect) && browser?.setBounds(rect))
  on('layout:visible', (v) => typeof v === 'boolean' && browser?.setVisible(v))

  on('downloads:cancel', (id) => isId(id) && downloads?.cancel(id))
  on('downloads:retry', (id) => isId(id) && downloads?.retry(id))
  on('downloads:show', (id) => isId(id) && downloads?.showInFolder(id))
  on('downloads:clear', () => downloads?.clear())
  on('downloads:open-folder', () => downloads?.openFolder())
  handle('downloads:read-model', async (id) => {
    if (!isId(id) || !downloads) throw new Error('Unknown download.')
    return downloads.readModel(id)
  })

  handle('files:open-model', async () => (win ? openModelDialog(win) : null))
  handle('files:save-model', async (req) => (win ? saveModel(win, req as SaveRequest, exportsDir) : { ok: false }))
  handle('files:reopen-saved', async (path) => reopenSaved(path))

  handle('library:get', async () => library?.get())
  on('library:add-bookmark', (b) => library?.addBookmark(b as NewBookmark))
  on('library:remove-bookmark', (id) => library?.removeBookmark(id))
  handle('library:add-model', async (m) => {
    if (!library) throw new Error('Library unavailable.')
    return library.addModel(m as NewLibraryModel)
  })
  on('library:remove-model', (id) => void library?.removeModel(id))
  handle('library:read-model', async (id) => {
    if (!library) throw new Error('Library unavailable.')
    return library.readModel(id)
  })
  on('library:show-model', (id) => library?.showModel(id))
  on('library:move', (kind, id, group) => library?.moveItem(kind, id, group))
  on('library:create-group', (name) => library?.createGroup(name))
  on('library:rename-group', (from, to) => library?.renameGroup(from, to))
  on('library:delete-group', (name) => library?.deleteGroup(name))

  handle('slicer:list', async () => listSlicers())
  handle('slicer:choose', async () => (win ? chooseSlicer(win) : listSlicers()))
  on('slicer:set-default', (id) => isShortString(id, 100) && setDefaultSlicer(id))
  handle('slicer:open', async (req) => openInSlicer(req as SlicerHandoff, exportsDir))

  const eng = () => {
    if (!engine) throw new Error('The slicing engine is unavailable.')
    return engine
  }
  handle('engine:get', async () => eng().locate())
  handle('engine:install', async () => eng().install())
  on('engine:cancel-install', () => engine?.cancelInstall())
  handle('engine:catalog', async (refresh) => eng().getCatalog(refresh === true))
  handle('engine:slice', async (req) => eng().slice(req as SliceRequest))
  on('engine:cancel-slice', () => engine?.cancelSlice())
  handle('engine:read-gcode', async (jobId) => eng().readGcode(String(jobId)))
  handle('engine:save-gcode', async (jobId) => (win ? eng().saveGcode(win, String(jobId)) : { ok: false }))
  handle('engine:import-candidates', async () => importCandidates())
  handle('engine:import', async (source) => {
    if (!['orca', 'bambu', 'prusa', 'cura'].includes(String(source))) throw new Error('Unknown slicer.')
    return importSettings(source as ImportSource, await eng().getCatalog())
  })

  handle('printers:list', async () => listPrinters())
  handle('printers:save', async (p) => savePrinter(p as PrinterInput))
  handle('printers:remove', async (id) => removePrinter(String(id)))
  handle('printers:test', async (id) => testPrinter(String(id)))
  handle('printers:send', async (req) => {
    const r = req as SendRequest
    if (!r || typeof r.printerId !== 'string' || typeof r.jobId !== 'string') throw new Error('Incomplete request.')
    return sendToPrinter(r.printerId, eng().jobGcode(r.jobId), r.startPrint === true)
  })
  on('serial:chosen', (portId) => {
    serialCallback?.(typeof portId === 'string' ? portId : '')
    serialCallback = null
  })
}

/**
 * USB printing uses Web Serial in the app window only (websites live in another session and
 * never get serial access). When the page asks for a port, the app shows its own picker.
 */
function setupSerial(w: BrowserWindow) {
  const ses = w.webContents.session
  const isApp = (wc: Electron.WebContents | null | undefined) => !!wc && wc.id === w.webContents.id
  ses.setPermissionCheckHandler((wc, permission) => (permission === 'serial' ? isApp(wc) : true))
  ses.setDevicePermissionHandler((d) => d.deviceType === 'serial' && isApp(w.webContents))
  ses.on('select-serial-port', (event, ports, wc, callback) => {
    event.preventDefault()
    if (!isApp(wc)) return callback('')
    serialCallback?.('')
    serialCallback = callback
    const list: SerialPortChoice[] = ports.map((p) => ({
      portId: p.portId,
      portName: p.portName,
      displayName: p.displayName,
      vendorId: p.vendorId,
      productId: p.productId,
    }))
    w.webContents.send('serial:choose', list)
  })
}

/** Dev hook: `--screenshot=<file>` captures the window after it settles, then quits. */
function maybeScreenshot() {
  const arg = process.argv.find((a) => a.startsWith('--screenshot='))
  if (!arg || !win) return
  const out = arg.slice('--screenshot='.length)
  const demo = process.argv.includes('--demo')
  win.webContents.on('console-message', (e) => console.log(`[renderer] ${e.message}`))
  setTimeout(async () => {
    if (!win) return
    if (demo) {
      const sliceFor = process.argv.find((a) => a.startsWith('--demo-slice='))?.slice('--demo-slice='.length)
      if (sliceFor) await win.webContents.executeJavaScript(`window.__demoSlice = ${JSON.stringify(sliceFor)}`)
      const printersPort = process.argv.find((a) => a.startsWith('--demo-printers='))?.slice('--demo-printers='.length)
      if (printersPort) await win.webContents.executeJavaScript(`window.__demoPrinters = ${JSON.stringify(printersPort)}`)
      if (process.argv.includes('--demo-install')) await win.webContents.executeJavaScript('window.__demoInstall = true')
      const repairDemo = process.argv.find((a) => a.startsWith('--demo-repair='))?.slice('--demo-repair='.length)
      if (repairDemo) await win.webContents.executeJavaScript(`window.__demoRepair = ${JSON.stringify(repairDemo)}`)
      try {
        await win.webContents.executeJavaScript('window.__demo ? window.__demo().then(() => "demo ok") : "no demo hook"').then((r) => console.log(`[demo] ${r}`))
      } catch (err) {
        console.log(`[demo] failed: ${(err as Error).message}`)
      }
    }
    setTimeout(async () => {
      if (!win) return
      const view = process.argv.find((a) => a.startsWith('--view='))?.slice(7)
      if (view) {
        await win.webContents.executeJavaScript(`window.__setLayout?.(${JSON.stringify(view)})`)
        await new Promise((r) => setTimeout(r, 800))
      }
      const probe = process.argv.find((a) => a.startsWith('--probe-url='))?.slice('--probe-url='.length)
      const probeTab = browser?.active?.view.webContents
      if (probe && probeTab) {
        for (const u of probe.split(',')) {
          await probeTab.loadURL(u).catch(() => {})
          const seen = await probeTab.executeJavaScript('JSON.stringify({ host: location.host, ua: navigator.userAgent, brands: navigator.userAgentData?.brands?.map((b) => b.brand) ?? null })')
          console.log('[probe]', seen)
        }
      }
      console.log('[state]', await win.webContents.executeJavaScript('document.querySelector(".main")?.dataset.layout + " | models=" + document.querySelectorAll(".mtab").length + " | visible=" + document.visibilityState'))
      const img = await win.webContents.capturePage()
      writeFileSync(out, img.toPNG())
      const tab = browser?.active?.view.webContents
      if (tab) writeFileSync(out.replace(/\.png$/i, '-tab.png'), (await tab.capturePage()).toPNG())
      app.quit()
    }, 5000)
  }, 3000)
}

Menu.setApplicationMenu(null)

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

// Nothing in the app may create a <webview> or open external windows on its own.
app.on('web-contents-created', (_e, wc) => {
  wc.on('will-attach-webview', (e) => e.preventDefault())
})

app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())
