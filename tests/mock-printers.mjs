// Local stand-ins for OctoPrint, Moonraker and PrusaLink, for testing Birdy's uploads.
// Usage: node tests/mock-printers.mjs <basePort> <logFile>
// Listens on 127.0.0.1 only: basePort (OctoPrint), +1 (Moonraker), +2 (PrusaLink, digest login).
import { createHash, randomBytes } from 'node:crypto'
import { appendFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'

const base = Number(process.argv[2] ?? 47110)
const logFile = process.argv[3] ?? 'mock-printers.log'
writeFileSync(logFile, '')
const log = (o) => appendFileSync(logFile, `${JSON.stringify(o)}\n`)
const md5 = (s) => createHash('md5').update(s).digest('hex')

const OCTO_KEY = 'octo-test-key'
const MOON_KEY = 'moon-test-key'
const PL_USER = 'maker'
const PL_PASS = 'prusa-test-pass'
const REALM = 'Printer API'
const nonce = randomBytes(8).toString('hex')

function body(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
  })
}

/** Field names and the uploaded file's name/size from a multipart body. */
function multipart(req, buf) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/.exec(req.headers['content-type'] ?? '')
  if (!m) return null
  const boundary = `--${m[1] ?? m[2]}`
  const out = { fields: {}, file: null }
  for (const part of buf.toString('latin1').split(boundary).slice(1, -1)) {
    const [head, ...rest] = part.split('\r\n\r\n')
    const content = rest.join('\r\n\r\n').replace(/\r\n$/, '')
    const name = /name="([^"]+)"/.exec(head)?.[1]
    const filename = /filename="([^"]+)"/.exec(head)?.[1]
    if (filename) out.file = { field: name, filename, size: Buffer.byteLength(content, 'latin1'), head: content.slice(0, 40) }
    else if (name) out.fields[name] = content
  }
  return out
}

const json = (res, code, o) => {
  res.writeHead(code, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(o))
}

createServer(async (req, res) => {
  const buf = await body(req)
  const entry = { printer: 'octoprint', method: req.method, url: req.url, key: req.headers['x-api-key'] ?? null }
  if (req.headers['x-api-key'] !== OCTO_KEY) {
    log({ ...entry, status: 403 })
    return json(res, 403, { error: 'Invalid API key' })
  }
  if (req.method === 'GET' && req.url === '/api/version') {
    log({ ...entry, status: 200 })
    return json(res, 200, { api: '0.1', server: '1.10.0', text: 'OctoPrint 1.10.0' })
  }
  if (req.method === 'POST' && req.url === '/api/files/local') {
    const mp = multipart(req, buf)
    log({ ...entry, status: 201, form: mp })
    return json(res, 201, { done: true, files: { local: { name: mp?.file?.filename } } })
  }
  log({ ...entry, status: 404 })
  json(res, 404, {})
}).listen(base, '127.0.0.1')

createServer(async (req, res) => {
  const buf = await body(req)
  const entry = { printer: 'moonraker', method: req.method, url: req.url, key: req.headers['x-api-key'] ?? null }
  if (req.headers['x-api-key'] !== MOON_KEY) {
    log({ ...entry, status: 401 })
    return json(res, 401, { error: { code: 401, message: 'Unauthorized' } })
  }
  if (req.method === 'GET' && req.url === '/server/info') {
    log({ ...entry, status: 200 })
    return json(res, 200, { result: { klippy_state: 'ready', moonraker_version: 'v0.9.3' } })
  }
  if (req.method === 'POST' && req.url === '/server/files/upload') {
    const mp = multipart(req, buf)
    log({ ...entry, status: 201, form: mp })
    return json(res, 201, { result: { item: { path: mp?.file?.filename, root: 'gcodes' }, print_started: mp?.fields.print === 'true' } })
  }
  log({ ...entry, status: 404 })
  json(res, 404, {})
}).listen(base + 1, '127.0.0.1')

createServer(async (req, res) => {
  const buf = await body(req)
  const auth = req.headers.authorization ?? ''
  const entry = { printer: 'prusalink', method: req.method, url: req.url, auth: auth ? auth.split(' ')[0] : null }
  const f = (k) => new RegExp(`${k}="?([^",]+)"?`).exec(auth)?.[1] ?? ''
  const ha1 = md5(`${PL_USER}:${REALM}:${PL_PASS}`)
  const ha2 = md5(`${req.method}:${f('uri')}`)
  const expected = md5(`${ha1}:${nonce}:${f('nc')}:${f('cnonce')}:${f('qop')}:${ha2}`)
  const ok = auth.startsWith('Digest ') && f('username') === PL_USER && f('nonce') === nonce && f('uri') === req.url && f('response') === expected
  if (!ok) {
    log({ ...entry, status: 401 })
    res.writeHead(401, { 'WWW-Authenticate': `Digest realm="${REALM}", nonce="${nonce}", qop="auth"` })
    return res.end()
  }
  if (req.method === 'GET' && req.url === '/api/version') {
    log({ ...entry, status: 200 })
    return json(res, 200, { api: '2.0.0', server: '2.1.2', hostname: 'prusa-mk4' })
  }
  if (req.method === 'PUT' && req.url.startsWith('/api/v1/files/usb/')) {
    log({ ...entry, status: 201, size: buf.length, printAfter: req.headers['print-after-upload'] ?? null, type: req.headers['content-type'] ?? null })
    res.writeHead(201)
    return res.end()
  }
  log({ ...entry, status: 404 })
  json(res, 404, {})
}).listen(base + 2, '127.0.0.1')

console.log(`mock printers on 127.0.0.1:${base}-${base + 2}`)
