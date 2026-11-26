import { app, safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import { digestHeader } from './digest'
import { readFileSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { PrinterInfo, PrinterInput, PrinterKind, PrinterTestResult, SendResult } from '../src/types/slicing'

/**
 * Printers on the local network. Birdy talks to them only at the address the user typed.
 * API keys and passwords are encrypted with Windows' per-user data protection (safeStorage)
 * and never sent to the app UI.
 */
interface Stored {
  id: string
  name: string
  kind: PrinterKind
  url?: string
  username?: string
  baudRate?: number
  secret?: string
}

const KINDS: PrinterKind[] = ['octoprint', 'moonraker', 'prusalink', 'serial']
const file = () => join(app.getPath('userData'), 'printers.json')
const TIMEOUT_MS = 8000
const UPLOAD_TIMEOUT_MS = 10 * 60 * 1000

function load(): Stored[] {
  try {
    const list = JSON.parse(readFileSync(file(), 'utf8')) as Stored[]
    return Array.isArray(list) ? list.filter((p) => p && KINDS.includes(p.kind)) : []
  } catch {
    return []
  }
}

function save(list: Stored[]) {
  writeFileSync(file(), JSON.stringify(list, null, 2))
}

const info = (p: Stored): PrinterInfo => ({
  id: p.id,
  name: p.name,
  kind: p.kind,
  url: p.url,
  username: p.username,
  baudRate: p.baudRate,
  hasSecret: !!p.secret,
})

export const listPrinters = (): PrinterInfo[] => load().map(info)

/** Accepts http(s) addresses only, and normalises a bare host such as 192.168.1.20. */
export function normalizeUrl(raw: string): string {
  let s = raw.trim()
  if (!/^[a-z]+:\/\//i.test(s)) s = `http://${s}`
  const u = new URL(s)
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Use an http:// or https:// address.')
  if (u.username || u.password) throw new Error('Put the password in the password field, not in the address.')
  return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`
}

export function savePrinter(input: PrinterInput): PrinterInfo[] {
  if (!input || typeof input.name !== 'string' || !KINDS.includes(input.kind)) throw new Error('Incomplete printer details.')
  const name = input.name.trim().slice(0, 80) || 'Printer'
  const list = load()
  const existing = input.id ? list.find((p) => p.id === input.id) : undefined
  const p: Stored = existing ?? { id: randomUUID(), name, kind: input.kind }
  p.name = name
  p.kind = input.kind
  if (input.kind === 'serial') {
    p.url = undefined
    p.baudRate = [9600, 19200, 38400, 57600, 115200, 230400, 250000, 500000, 1000000].includes(Number(input.baudRate)) ? Number(input.baudRate) : 115200
  } else {
    if (typeof input.url !== 'string' || !input.url.trim()) throw new Error('Enter the printer’s address.')
    p.url = normalizeUrl(input.url)
    p.username = typeof input.username === 'string' && input.username.trim() ? input.username.trim().slice(0, 80) : undefined
  }
  if (typeof input.secret === 'string') {
    if (!input.secret) p.secret = undefined
    else {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows could not protect the key, so it was not saved.')
      p.secret = safeStorage.encryptString(input.secret.slice(0, 500)).toString('base64')
    }
  }
  if (!existing) list.push(p)
  save(list)
  return list.map(info)
}

export function removePrinter(id: string): PrinterInfo[] {
  const list = load().filter((p) => p.id !== id)
  save(list)
  return list.map(info)
}

const secretOf = (p: Stored) => (p.secret ? safeStorage.decryptString(Buffer.from(p.secret, 'base64')) : '')

function find(id: string): Stored {
  const p = load().find((x) => x.id === id)
  if (!p) throw new Error('That printer is no longer set up.')
  if (p.kind === 'serial' || !p.url) throw new Error('USB printers are driven from the app window.')
  return p
}

export async function testPrinter(id: string): Promise<PrinterTestResult> {
  try {
    const p = find(id)
    if (p.kind === 'octoprint') {
      const j = (await call(p, 'GET', '/api/version')) as { text?: string; server?: string }
      return { ok: true, detail: `Connected to ${j.text ?? `OctoPrint ${j.server ?? ''}`}`.trim() }
    }
    if (p.kind === 'moonraker') {
      const j = (await call(p, 'GET', '/server/info')) as { result?: { klippy_state?: string; moonraker_version?: string } }
      return { ok: true, detail: `Connected to Moonraker ${j.result?.moonraker_version ?? ''} (Klipper ${j.result?.klippy_state ?? 'unknown'})`.replace(/\s+/g, ' ') }
    }
    const j = (await call(p, 'GET', '/api/version')) as { text?: string; server?: string; hostname?: string }
    return { ok: true, detail: `Connected to ${j.hostname ?? j.text ?? 'PrusaLink'} ${j.server ?? ''}`.trim() }
  } catch (err) {
    return { ok: false, detail: (err as Error).message }
  }
}

/** Uploads a G-code file and, if asked, starts printing it. */
export async function sendToPrinter(id: string, gcodePath: string, start: boolean): Promise<SendResult> {
  try {
    const p = find(id)
    const data = await readFile(gcodePath)
    const name = basename(gcodePath).replace(/[^\w.\- ]+/g, '_')
    if (p.kind === 'octoprint') {
      const form = new FormData()
      form.append('file', new Blob([data], { type: 'application/octet-stream' }), name)
      form.append('select', start ? 'true' : 'false')
      form.append('print', start ? 'true' : 'false')
      await call(p, 'POST', '/api/files/local', form, UPLOAD_TIMEOUT_MS)
    } else if (p.kind === 'moonraker') {
      const form = new FormData()
      form.append('file', new Blob([data], { type: 'application/octet-stream' }), name)
      form.append('root', 'gcodes')
      form.append('print', start ? 'true' : 'false')
      await call(p, 'POST', '/server/files/upload', form, UPLOAD_TIMEOUT_MS)
    } else {
      // PrusaLink keeps files on its USB drive ("usb"); some printers name it "local".
      const headers = { 'Content-Type': 'text/x.gcode', 'Print-After-Upload': start ? '?1' : '?0', Overwrite: '?1' }
      // Get the login challenge with a small request first, so the file is only sent once.
      if (p.username) await call(p, 'GET', '/api/version')
      try {
        await call(p, 'PUT', `/api/v1/files/usb/${encodeURIComponent(name)}`, data, UPLOAD_TIMEOUT_MS, headers)
      } catch (err) {
        if (!/404/.test((err as Error).message)) throw err
        await call(p, 'PUT', `/api/v1/files/local/${encodeURIComponent(name)}`, data, UPLOAD_TIMEOUT_MS, headers)
      }
    }
    return { ok: true, detail: start ? `Sent ${name} to ${p.name} and started the print.` : `Uploaded ${name} to ${p.name}.` }
  } catch (err) {
    return { ok: false, detail: (err as Error).message }
  }
}

/** Last digest challenge per printer, so later requests can log in on the first try. */
const challenges = new Map<string, { header: string; count: number }>()

/** One request to a printer, with its API key header or HTTP digest login (PrusaLink). */
async function call(
  p: Stored,
  method: string,
  path: string,
  body?: FormData | Buffer,
  timeoutMs = TIMEOUT_MS,
  extra: Record<string, string> = {},
): Promise<unknown> {
  const url = `${p.url}${path}`
  const secret = secretOf(p)
  const headers: Record<string, string> = { ...extra }
  if (secret && !(p.kind === 'prusalink' && p.username)) headers['X-Api-Key'] = secret
  const send = (h: Record<string, string>) =>
    fetch(url, { method, headers: h, body: body as RequestInit['body'], signal: AbortSignal.timeout(timeoutMs), redirect: 'error' })
  const digest = p.kind === 'prusalink' && !!p.username && !!secret
  const uri = new URL(url).pathname + new URL(url).search
  const authFor = (c: { header: string; count: number }) => digestHeader(c.header, method, uri, p.username!, secret, undefined, ++c.count)

  let res: Response
  try {
    const known = digest ? challenges.get(p.id) : undefined
    res = await send(known ? { ...headers, Authorization: authFor(known) } : headers)
    if (res.status === 401 && digest) {
      const c = { header: res.headers.get('www-authenticate') ?? '', count: 0 }
      challenges.set(p.id, c)
      res = await send({ ...headers, Authorization: authFor(c) })
    }
  } catch (err) {
    const e = err as Error & { cause?: { code?: string } }
    if (e.name === 'TimeoutError') throw new Error(`${p.name} did not answer in time. Check that it is on and on the same network.`)
    if (e.cause?.code === 'ECONNREFUSED') throw new Error(`${p.name} refused the connection. Check the address and port.`)
    if (e.cause?.code === 'ENOTFOUND' || e.cause?.code === 'EAI_AGAIN') throw new Error(`Couldn’t find ${new URL(url).host} on the network.`)
    throw new Error(`Couldn’t reach ${p.name}: ${e.message}`)
  }
  if (res.status === 401 || res.status === 403) throw new Error(`${p.name} rejected the ${p.kind === 'prusalink' && p.username ? 'username or password' : 'API key'} (HTTP ${res.status}).`)
  if (res.status === 409) throw new Error(`${p.name} is busy (already printing?) and refused the request (HTTP 409).`)
  if (!res.ok) throw new Error(`${p.name} answered HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}.`)
  const text = await res.text()
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    return {}
  }
}
