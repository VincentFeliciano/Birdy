// Run with: node tests/user-agent.test.mts
import assert from 'node:assert/strict'
import { followSignInUserAgent, isSignInUrl, SIGN_IN_USER_AGENT, signInHeaders } from '../electron/user-agent.ts'

assert.ok(isSignInUrl('https://accounts.google.com/v3/signin/identifier?continue=x'))
assert.ok(!isSignInUrl('http://accounts.google.com/'), 'plain http is not treated as sign-in')
assert.ok(!isSignInUrl('https://accounts.google.com.evil.example/'))
assert.ok(!isSignInUrl('https://www.google.com/search?q=stl'))
assert.ok(!isSignInUrl('not a url'))

const out = signInHeaders({
  'User-Agent': 'Mozilla/5.0 ... Chrome/140.0.0.0 Safari/537.36',
  'sec-ch-ua': '"Chromium";v="140"',
  'sec-ch-ua-mobile': '?0',
  'Sec-CH-UA-Platform': '"Windows"',
  Accept: 'text/html',
})
assert.deepEqual(out, { Accept: 'text/html', 'User-Agent': SIGN_IN_USER_AGENT })
// A tab that visits Google sign-in gets the DevTools link only while it is there.
{
  let attached = false
  let ua = 'Chrome-ish'
  const log: string[] = []
  let onNav: (d: { isMainFrame: boolean; isSameDocument: boolean; url: string }) => void = () => {}
  const wc = {
    on: (_e: string, f: typeof onNav) => (onNav = f),
    getUserAgent: () => ua,
    setUserAgent: (u: string) => (ua = u),
    debugger: {
      isAttached: () => attached,
      attach: () => { attached = true; log.push('attach') },
      detach: () => { attached = false; log.push('detach') },
      sendCommand: () => Promise.resolve(),
    },
  }
  followSignInUserAgent(wc as never, 'Chrome-ish')
  const go = (url: string) => onNav({ isMainFrame: true, isSameDocument: false, url })
  go('https://example.com/')
  assert.equal(attached, false)
  go('https://accounts.google.com/signin')
  assert.equal(attached, true)
  assert.equal(ua, SIGN_IN_USER_AGENT)
  go('https://accounts.google.com/next')
  go('https://challenge.example/')
  assert.equal(attached, false, 'detached after leaving sign-in')
  assert.equal(ua, 'Chrome-ish')
  go('https://accounts.google.com/again')
  assert.equal(attached, true, 'attaches again on a later sign-in')
  assert.deepEqual(log, ['attach', 'detach', 'attach'])
}
console.log('user-agent tests passed')
import { plainChromeUserAgent } from '../electron/user-agent.ts'
assert.equal(
  plainChromeUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Birdy/0.4.1 Chrome/156.0.8078.109 Electron/45.5.0 Safari/537.36'),
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.8078.109 Safari/537.36',
)
console.log('plain user agent test passed')
