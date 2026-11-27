// In-app updates from Boaty's GitHub releases (electron-updater).
//
// Each release carries latest.yml (version, file name, SHA-512) next to the installer. Boaty checks
// it shortly after start and every few hours, but only downloads when the user asks, then installs
// on restart. The download is verified against the SHA-512 before it is run.
import { app, type BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'
import type { UpdateState } from '../src/types/ipc'

const { autoUpdater } = electronUpdater

const FIRST_CHECK_MS = 8_000
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000

let state: UpdateState = { status: 'idle', current: app.getVersion() }
let win: BrowserWindow | null = null
let timer: ReturnType<typeof setInterval> | null = null

function set(patch: Partial<UpdateState>) {
  state = { ...state, ...patch }
  if (win && !win.isDestroyed()) win.webContents.send('update:state', state)
}

export const getUpdateState = () => state

/** Release notes arrive as HTML from GitHub; keep plain text only. */
function plainNotes(notes: unknown): string | undefined {
  const text = Array.isArray(notes) ? notes.map((n) => (n as { note?: string }).note ?? '').join('\n') : typeof notes === 'string' ? notes : ''
  const plain = text
    .replace(/<\/(p|li|h\d)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return plain ? plain.slice(0, 2000) : undefined
}

function friendly(err: Error): string {
  const m = err.message || String(err)
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|net::ERR_/i.test(m)) return "Couldn't reach GitHub. Check your internet connection."
  if (/latest\.yml/i.test(m) && /404/.test(m)) return 'The newest release on GitHub has no update information yet.'
  if (/sha512 checksum mismatch/i.test(m)) return 'The downloaded update did not match its checksum, so it was discarded.'
  return m.split('\n')[0]!.slice(0, 300)
}

export function setupUpdater(window: BrowserWindow) {
  win = window
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  // Boaty's releases are published as pre-releases while it is in early development.
  autoUpdater.allowPrerelease = true
  autoUpdater.logger = null

  // Test hook: point at a local feed (tests serve one on 127.0.0.1). Nothing else is accepted.
  const feed = process.argv.find((a) => a.startsWith('--update-feed='))?.slice('--update-feed='.length)
  if (feed && /^http:\/\/127\.0\.0\.1:\d+\/?$/.test(feed)) {
    autoUpdater.setFeedURL({ provider: 'generic', url: feed })
    // A test run must never install what it downloaded over the real installed Boaty.
    autoUpdater.autoInstallOnAppQuit = false
  }

  autoUpdater.on('checking-for-update', () => set({ status: 'checking', error: undefined }))
  autoUpdater.on('update-not-available', () => set({ status: 'none', checkedAt: Date.now() }))
  autoUpdater.on('update-available', (info) =>
    set({ status: 'available', version: info.version, notes: plainNotes(info.releaseNotes), checkedAt: Date.now(), progress: undefined }),
  )
  autoUpdater.on('download-progress', (p) => set({ status: 'downloading', progress: p.percent / 100, bytesPerSecond: p.bytesPerSecond }))
  autoUpdater.on('update-downloaded', (info) => set({ status: 'ready', version: info.version, progress: 1 }))
  autoUpdater.on('error', (err) => set({ status: 'error', error: friendly(err), progress: undefined }))

  if (!app.isPackaged && !feed) {
    set({ status: 'unsupported', error: 'Updates work in the installed app, not in development.' })
    return
  }
  setTimeout(() => void checkForUpdates(), FIRST_CHECK_MS)
  timer = setInterval(() => {
    if (state.status === 'idle' || state.status === 'none' || state.status === 'error') void checkForUpdates()
  }, CHECK_EVERY_MS)
  app.on('before-quit', () => timer && clearInterval(timer))
}

export async function checkForUpdates(): Promise<UpdateState> {
  if (state.status === 'unsupported' || state.status === 'downloading' || state.status === 'ready') return state
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    set({ status: 'error', error: friendly(err as Error) })
  }
  return state
}

export async function downloadUpdate(): Promise<UpdateState> {
  if (state.status !== 'available' && !(state.status === 'error' && state.version)) return state
  set({ status: 'downloading', progress: 0, error: undefined })
  try {
    await autoUpdater.downloadUpdate()
  } catch (err) {
    set({ status: 'error', error: friendly(err as Error) })
  }
  return state
}

/** Quits and runs the downloaded installer silently; Boaty starts again afterwards. */
export function installUpdate() {
  if (state.status !== 'ready') return
  autoUpdater.quitAndInstall(true, true)
}
