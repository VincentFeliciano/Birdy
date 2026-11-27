import type { Session, WebContents } from 'electron'

/**
 * Google refuses sign-in from browsers built on Electron ("This browser or app may not be secure").
 * Its check looks past the user agent string at Chromium's brand hints, which say "Chromium" but
 * not "Google Chrome". On Google's sign-in host only, Birdy presents as Firefox, which sends no
 * brand hints, the same approach other Electron-based browsers use. Every other site sees Birdy's
 * normal Chromium identity.
 */
export const SIGN_IN_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0'

const SIGN_IN_HOSTS = new Set(['accounts.google.com'])

export function isSignInUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && SIGN_IN_HOSTS.has(u.hostname)
  } catch {
    return false
  }
}

/** Request headers for sign-in pages: Firefox's user agent and none of Chromium's client hints. */
export function signInHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    if (!k.toLowerCase().startsWith('sec-ch-ua')) out[k] = v
  }
  for (const k of Object.keys(out)) if (k.toLowerCase() === 'user-agent') delete out[k]
  out['User-Agent'] = SIGN_IN_USER_AGENT
  return out
}

/** Rewrites the headers of every request to the sign-in hosts made in this session. */
export function installSignInHeaders(session: Session) {
  session.webRequest.onBeforeSendHeaders({ urls: [...SIGN_IN_HOSTS].map((h) => `https://${h}/*`) }, (details, cb) => {
    cb({ requestHeaders: signInHeaders(details.requestHeaders) })
  })
}

/**
 * Runs before any page script. Firefox has no navigator.userAgentData, so on the sign-in hosts it is
 * removed to match the Firefox user agent; other sites keep it. Nothing else on the page changes.
 */
const HIDE_BRAND_HINTS = `if (${JSON.stringify([...SIGN_IN_HOSTS])}.includes(location.hostname)) delete Navigator.prototype.userAgentData`

/** Keeps a tab's page-visible identity in step with the host it is opening. */
export function followSignInUserAgent(wc: WebContents, normal: string) {
  let scriptAdded = false
  wc.on('did-start-navigation', (details) => {
    if (!details.isMainFrame || details.isSameDocument) return
    const signIn = isSignInUrl(details.url)
    const want = signIn ? SIGN_IN_USER_AGENT : normal
    if (wc.getUserAgent() !== want) wc.setUserAgent(want)
    // Leaving the sign-in host: drop the DevTools connection so no other site can detect it. It is
    // only ours if we attached it (a user's open developer tools are left alone).
    if (!signIn && scriptAdded) {
      scriptAdded = false
      try {
        if (wc.debugger.isAttached()) wc.debugger.detach()
      } catch {
        // Already gone.
      }
    }
    // Registered (through Chromium's DevTools protocol, not a website preload) when this tab opens a
    // sign-in page; it applies to the documents that follow until the tab leaves the sign-in host.
    if (signIn && !scriptAdded) {
      scriptAdded = true
      try {
        if (!wc.debugger.isAttached()) wc.debugger.attach('1.3')
        void wc.debugger
          .sendCommand('Page.enable')
          .then(() => wc.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: HIDE_BRAND_HINTS }))
          .catch(() => {})
      } catch {
        // Developer tools already own the protocol connection; the user agent switch still applies.
      }
    }
  })
}
