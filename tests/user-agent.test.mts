// Run with: node tests/user-agent.test.mts
import assert from 'node:assert/strict'
import { isSignInUrl, SIGN_IN_USER_AGENT, signInHeaders } from '../electron/user-agent.ts'

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
console.log('user-agent tests passed')
