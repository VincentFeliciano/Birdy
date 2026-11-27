import { app, WebContentsView, type BrowserWindow, type Input, type Session, type WebContents } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildSearchUrl, isSearchType, type Rect, type SearchType, type TabInfo, type TabsState } from '../src/types/ipc'
import { isWebUrl } from './security'
import { followSignInUserAgent } from './user-agent'

interface Tab {
  id: number
  view: WebContentsView
  favicon: string | null
}

interface Options {
  session: Session
  startPageUrl: string
  /** Return true when the key was handled as an app shortcut. */
  onShortcut: (input: Input) => boolean
}

/** Turns address-bar text into a URL: full URLs, bare hosts, localhost, or a Google search. */
export function resolveInput(raw: string, type: SearchType = 'models'): string {
  const text = raw.trim()
  if (!text) return ''
  if (/^https?:\/\//i.test(text)) return text
  if (/^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?(\/.*)?$/i.test(text)) return `http://${text}`
  if (!/\s/.test(text) && /^[^/]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(text)) return `https://${text}`
  return buildSearchUrl(text, type)
}

/** Owns every website tab. Each tab is a sandboxed WebContentsView with no preload and no Node. */
export class BrowserManager {
  private tabs = new Map<number, Tab>()
  private order: number[] = []
  private nextId = 1
  activeId: number | null = null
  private bounds: Rect = { x: 0, y: 0, width: 0, height: 0 }
  private visible = true
  private persistTimer: NodeJS.Timeout | null = null
  private sessionFile = join(app.getPath('userData'), 'session.json')

  constructor(
    private win: BrowserWindow,
    private opts: Options,
  ) {}

  get active() {
    return this.activeId ? this.tabs.get(this.activeId) : undefined
  }

  restore() {
    try {
      if (existsSync(this.sessionFile)) {
        const saved = JSON.parse(readFileSync(this.sessionFile, 'utf8')) as { urls: string[]; active: number }
        const urls = (saved.urls ?? []).filter((u) => typeof u === 'string' && isWebUrl(u)).slice(0, 30)
        if (urls.length) {
          const ids = urls.map((u) => this.create(u, false))
          this.activate(ids[Math.min(Math.max(saved.active ?? 0, 0), ids.length - 1)])
          return
        }
      }
    } catch {
      // A damaged session file should never block startup.
    }
    this.create()
  }

  create(url?: string, activate = true): number {
    const id = this.nextId++
    const view = new WebContentsView({
      webPreferences: {
        session: this.opts.session,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: false,
      },
    })
    view.setBackgroundColor('#ffffff')
    view.setBorderRadius(10)
    view.setVisible(false)
    const tab: Tab = { id, view, favicon: null }
    const wc = view.webContents

    // Pop-ups and target=_blank links open as tabs; anything that is not http(s) is refused.
    wc.setWindowOpenHandler(({ url, disposition }) => {
      if (isWebUrl(url)) this.create(url, disposition !== 'background-tab')
      return { action: 'deny' }
    })
    wc.on('will-navigate', (e, url) => {
      if (!isWebUrl(url) && url !== this.opts.startPageUrl) {
        e.preventDefault()
        return
      }
      // The start page's search form submits ?q=…&type=…; apply the 3D search terms.
      if (wc.getURL() === this.opts.startPageUrl) {
        const u = new URL(url)
        if (u.hostname === 'www.google.com' && u.pathname === '/search' && u.searchParams.has('birdy_type')) {
          e.preventDefault()
          const t = u.searchParams.get('birdy_type')
          void wc.loadURL(buildSearchUrl(u.searchParams.get('q') ?? '', isSearchType(t) ? t : 'models'))
        }
      }
    })
    wc.on('before-input-event', (e, input) => {
      if (this.opts.onShortcut(input)) e.preventDefault()
    })
    wc.on('page-favicon-updated', (_e, favicons) => {
      tab.favicon = favicons.find((f) => isWebUrl(f)) ?? null
      this.emit()
    })
    wc.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) tab.favicon = null
    })
    followSignInUserAgent(wc, this.opts.session.getUserAgent())
    wc.on('dom-ready', () => {
      this.accentCss.delete(id)
      void this.styleStartPage(id, wc)
    })
    for (const ev of ['page-title-updated', 'did-start-loading', 'did-stop-loading', 'did-navigate', 'did-navigate-in-page'] as const) {
      wc.on(ev as 'did-stop-loading', () => this.emit())
    }
    wc.on('render-process-gone', () => this.emit())

    this.tabs.set(id, tab)
    const at = this.activeId ? this.order.indexOf(this.activeId) + 1 : this.order.length
    this.order.splice(at, 0, id)
    this.win.contentView.addChildView(view)
    void wc.loadURL(url && (isWebUrl(url) || url === this.opts.startPageUrl) ? url : this.opts.startPageUrl)
    if (activate || this.activeId === null) this.activate(id)
    else this.emit()
    return id
  }

  /** Neon colour for the new-tab page, which is a separate document from the app UI. */
  private accent: string | null = null
  private accentCss = new Map<number, string>()

  setStartPageAccent(hex: string) {
    this.accent = hex
    for (const tab of this.tabs.values()) void this.styleStartPage(tab.id, tab.view.webContents)
  }

  private async styleStartPage(id: number, wc: WebContents) {
    if (!this.accent || wc.isDestroyed() || wc.getURL() !== this.opts.startPageUrl) return
    const n = parseInt(this.accent.slice(1), 16)
    // html:root outranks the page's own :root defaults.
    const css = `html:root{--accent:${this.accent};--accent-rgb:${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}}`
    const old = this.accentCss.get(id)
    this.accentCss.set(id, await wc.insertCSS(css))
    if (old) void wc.removeInsertedCSS(old).catch(() => {})
  }

  close(id: number) {
    const tab = this.tabs.get(id)
    if (!tab) return
    const idx = this.order.indexOf(id)
    this.order.splice(idx, 1)
    this.tabs.delete(id)
    this.accentCss.delete(id)
    this.win.contentView.removeChildView(tab.view)
    tab.view.webContents.close()
    if (this.order.length === 0) {
      this.activeId = null
      this.create()
      return
    }
    if (this.activeId === id) {
      this.activeId = null
      this.activate(this.order[Math.min(idx, this.order.length - 1)])
    } else this.emit()
  }

  activate(id: number) {
    if (!this.tabs.has(id)) return
    if (this.activeId && this.activeId !== id) this.tabs.get(this.activeId)?.view.setVisible(false)
    this.activeId = id
    this.applyLayout()
    this.emit()
  }

  cycle(step: number) {
    if (!this.activeId || this.order.length < 2) return
    const i = this.order.indexOf(this.activeId)
    this.activate(this.order[(i + step + this.order.length) % this.order.length])
  }

  navigate(input: string, type?: SearchType) {
    const url = resolveInput(input, type)
    if (url && this.active) void this.active.view.webContents.loadURL(url)
  }

  home() {
    void this.active?.view.webContents.loadURL(this.opts.startPageUrl)
  }

  setBounds(rect: Rect) {
    this.bounds = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.max(0, Math.round(rect.width)),
      height: Math.max(0, Math.round(rect.height)),
    }
    this.applyLayout()
  }

  setVisible(visible: boolean) {
    this.visible = visible
    this.applyLayout()
  }

  private applyLayout() {
    const tab = this.active
    if (!tab) return
    const show = this.visible && this.bounds.width > 0 && this.bounds.height > 0
    tab.view.setBounds(this.bounds)
    tab.view.setVisible(show)
  }

  state(): TabsState {
    const tabs: TabInfo[] = this.order.map((id) => {
      const { view, favicon } = this.tabs.get(id)!
      const wc = view.webContents
      const url = wc.getURL()
      const isStartPage = url === this.opts.startPageUrl || url === ''
      return {
        id,
        title: isStartPage ? 'New tab' : wc.getTitle() || url,
        url: isStartPage ? '' : url,
        favicon,
        loading: wc.isLoading(),
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward(),
        isStartPage,
      }
    })
    return { tabs, activeId: this.activeId }
  }

  private emit() {
    if (this.win.isDestroyed()) return
    this.win.webContents.send('tabs:state', this.state())
    this.schedulePersist()
  }

  private schedulePersist() {
    if (this.persistTimer) clearTimeout(this.persistTimer)
    this.persistTimer = setTimeout(() => this.persist(), 800)
  }

  persist() {
    const { tabs, activeId } = this.state()
    const web = tabs.filter((t) => isWebUrl(t.url))
    const data = { urls: web.map((t) => t.url), active: Math.max(0, web.findIndex((t) => t.id === activeId)) }
    try {
      writeFileSync(this.sessionFile, JSON.stringify(data))
    } catch {
      // Session restore is best effort.
    }
  }
}
