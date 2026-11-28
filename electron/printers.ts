import { app, safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import { digestHeader } from './digest'
import { readFileSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { ffSend, ffStatus, ffTest, type FlashforgeTarget } from './flashforge'
import { printFileFor } from './slicing/engine'
import { sdcpStart, sdcpStatus, sdcpTest, sdcpUpload } from './sdcp'
import type { PrinterInfo, PrinterInput, PrinterKind, PrinterState, PrinterStatus, PrinterTestResult, SendResult } from '../src/types/slicing'

/**
 * Printers on the local network. Boaty talks to them only at the address the user typed.
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

const KINDS: PrinterKind[] = ['octoprint', 'moonraker', 'prusalink', 'serial', 'elegoo', 'flashforge']
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

/** A Flashforge printer: its serial number is kept as the username, its check code as the secret. */
const ff = (p: Stored): FlashforgeTarget => ({ name: p.name, url: p.url!, serial: p.username, checkCode: secretOf(p) || undefined })

function find(id: string): Stored {
  const p = load().find((x) => x.id === id)
  if (!p) throw new Error('That printer is no longer set up.')
  if (p.kind === 'serial' || !p.url) throw new Error('USB printers are driven from the app window.')
  return p
}

export async function testPrinter(id: string): Promise<PrinterTestResult> {
  try {
    const p = find(id)
    if (p.kind === 'elegoo') return { ok: true, detail: await sdcpTest(p.url!) }
    if (p.kind === 'flashforge') return { ok: true, detail: await ffTest(ff(p)) }
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
    if (p.kind === 'elegoo') throw new Error(`${p.name} is a resin printer. Switch Slice to Resin and send the .goo file from there.`)
    const data = await readFile(gcodePath)
    const name = basename(gcodePath).replace(/[^\w.\- ]+/g, '_')
    if (p.kind === 'flashforge') {
      // Older Flashforge models get a .gx file (G-code with a header and preview).
      const file = await printFileFor(gcodePath)
      const stored = await ffSend(ff(p), file.name.replace(/[^\w.\- ]+/g, '_'), file.data ?? data, start, UPLOAD_TIMEOUT_MS)
      return { ok: true, detail: start ? `Sent ${stored} to ${p.name} and started the print.` : `Uploaded ${stored} to ${p.name}. Start it from the printer’s screen.` }
    }
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

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const STATUS_TIMEOUT_MS = 4000
const MAX_SNAPSHOT = 4 * 1024 * 1024

function offline(detail: string): PrinterStatus {
  return { state: 'offline', detail, file: null, progress: null, elapsed: null, remaining: null, hotend: null, hotendTarget: null, bed: null, bedTarget: null, camera: false }
}

/** What a network printer is doing: state, job progress and temperatures. */
export async function printerStatus(id: string): Promise<PrinterStatus> {
  let p: Stored
  try {
    p = find(id)
  } catch (err) {
    return offline((err as Error).message)
  }
  try {
    if (p.kind === 'elegoo') return await sdcpStatus(p.url!)
    if (p.kind === 'flashforge') return await ffStatus(ff(p), STATUS_TIMEOUT_MS)
    if (p.kind === 'octoprint') {
      const job = (await call(p, 'GET', '/api/job', undefined, STATUS_TIMEOUT_MS)) as {
        state?: string
        job?: { file?: { name?: string } }
        progress?: { completion?: number; printTime?: number; printTimeLeft?: number }
      }
      let temps: { temperature?: Record<string, { actual?: number; target?: number }> } = {}
      try {
        temps = (await call(p, 'GET', '/api/printer', undefined, STATUS_TIMEOUT_MS)) as typeof temps
      } catch {
        // 409 when OctoPrint is not connected to the printer; the job state says so.
      }
      const raw = job.state ?? ''
      const state: PrinterState = /error/i.test(raw)
        ? 'error'
        : /offline|closed/i.test(raw)
          ? 'offline'
          : /paus/i.test(raw)
            ? 'paused'
            : /printing|cancelling|finishing/i.test(raw)
              ? 'printing'
              : 'idle'
      const c = num(job.progress?.completion)
      return {
        state,
        detail: raw || 'Connected',
        file: job.job?.file?.name ?? null,
        progress: c === null ? null : c / 100,
        elapsed: num(job.progress?.printTime),
        remaining: num(job.progress?.printTimeLeft),
        hotend: num(temps.temperature?.tool0?.actual),
        hotendTarget: num(temps.temperature?.tool0?.target),
        bed: num(temps.temperature?.bed?.actual),
        bedTarget: num(temps.temperature?.bed?.target),
        camera: true,
      }
    }
    if (p.kind === 'moonraker') {
      const j = (await call(p, 'GET', '/printer/objects/query?print_stats&virtual_sdcard&extruder&heater_bed', undefined, STATUS_TIMEOUT_MS)) as {
        result?: {
          status?: {
            print_stats?: { state?: string; filename?: string; print_duration?: number; message?: string }
            virtual_sdcard?: { progress?: number }
            extruder?: { temperature?: number; target?: number }
            heater_bed?: { temperature?: number; target?: number }
          }
        }
      }
      const st = j.result?.status ?? {}
      const raw = st.print_stats?.state ?? 'standby'
      const state: PrinterState = raw === 'printing' ? 'printing' : raw === 'paused' ? 'paused' : raw === 'complete' ? 'done' : raw === 'error' ? 'error' : 'idle'
      const progress = num(st.virtual_sdcard?.progress)
      const elapsed = num(st.print_stats?.print_duration)
      const remaining = state === 'printing' && progress && progress > 0.01 && elapsed !== null ? elapsed / progress - elapsed : null
      let camera = false
      try {
        const cams = (await call(p, 'GET', '/server/webcams/list', undefined, STATUS_TIMEOUT_MS)) as { result?: { webcams?: { snapshot_url?: string }[] } }
        camera = !!cams.result?.webcams?.some((w) => w.snapshot_url)
      } catch {
        // Older Moonraker without the webcams API.
      }
      return {
        state,
        detail: st.print_stats?.message || raw.charAt(0).toUpperCase() + raw.slice(1),
        file: st.print_stats?.filename || null,
        progress,
        elapsed,
        remaining,
        hotend: num(st.extruder?.temperature),
        hotendTarget: num(st.extruder?.target),
        bed: num(st.heater_bed?.temperature),
        bedTarget: num(st.heater_bed?.target),
        camera,
      }
    }
    const j = (await call(p, 'GET', '/api/v1/status', undefined, STATUS_TIMEOUT_MS)) as {
      printer?: { state?: string; temp_nozzle?: number; target_nozzle?: number; temp_bed?: number; target_bed?: number }
      job?: { progress?: number; time_remaining?: number; time_printing?: number }
    }
    const raw = j.printer?.state ?? 'IDLE'
    const state: PrinterState = /PRINTING|BUSY/.test(raw) ? 'printing' : /PAUSED/.test(raw) ? 'paused' : /FINISHED/.test(raw) ? 'done' : /ERROR|ATTENTION/.test(raw) ? 'error' : 'idle'
    const pr = num(j.job?.progress)
    return {
      state,
      detail: raw.charAt(0) + raw.slice(1).toLowerCase(),
      file: null,
      progress: pr === null ? null : pr / 100,
      elapsed: num(j.job?.time_printing),
      remaining: num(j.job?.time_remaining),
      hotend: num(j.printer?.temp_nozzle),
      hotendTarget: num(j.printer?.target_nozzle),
      bed: num(j.printer?.temp_bed),
      bedTarget: num(j.printer?.target_bed),
      camera: false,
    }
  } catch (err) {
    return offline((err as Error).message)
  }
}

/** Uploads a sliced resin file to an Elegoo printer over Wi-Fi and, if asked, starts it. */
export async function sendResinToPrinter(id: string, name: string, data: Buffer, start: boolean): Promise<SendResult> {
  try {
    const p = find(id)
    if (p.kind !== 'elegoo') throw new Error(`${p.name} takes G-code, not resin files.`)
    const file = name.replace(/[^\w.\- ]+/g, '_').slice(0, 100) || 'print.goo'
    await sdcpUpload(p.url!, data, file, UPLOAD_TIMEOUT_MS)
    if (start) await sdcpStart(p.url!, file)
    return { ok: true, detail: start ? `Sent ${file} to ${p.name} and started the print.` : `Uploaded ${file} to ${p.name}. Start it from the printer’s screen.` }
  } catch (err) {
    return { ok: false, detail: (err as Error).message }
  }
}

/** A still from the webcam of an OctoPrint or Moonraker printer, as a data URL, or null. */
export async function printerSnapshot(id: string): Promise<string | null> {
  try {
    const p = find(id)
    let path: string | null = null
    if (p.kind === 'octoprint') path = '/webcam/?action=snapshot'
    else if (p.kind === 'moonraker') {
      const cams = (await call(p, 'GET', '/server/webcams/list', undefined, STATUS_TIMEOUT_MS)) as { result?: { webcams?: { snapshot_url?: string }[] } }
      const url = cams.result?.webcams?.find((w) => w.snapshot_url)?.snapshot_url
      // Only paths on the printer itself: Boaty talks to no other address.
      if (url && url.startsWith('/') && !url.startsWith('//')) path = url
    }
    if (!path) return null
    const base = new URL(p.url!)
    const res = await request({ ...p, url: `${base.protocol}//${base.host}` }, 'GET', path, undefined, STATUS_TIMEOUT_MS)
    const type = res.headers.get('content-type') ?? ''
    if (!/^image\/(jpeg|png|webp)/.test(type)) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (!buf.length || buf.length > MAX_SNAPSHOT) return null
    return `data:${type.split(';')[0]};base64,${buf.toString('base64')}`
  } catch {
    return null
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
  const res = await request(p, method, path, body, timeoutMs, extra)
  const text = await res.text()
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    return {}
  }
}

/** One request to a printer, returning the raw response once it is known to be OK. */
async function request(
  p: Stored,
  method: string,
  path: string,
  body?: FormData | Buffer,
  timeoutMs = TIMEOUT_MS,
  extra: Record<string, string> = {},
): Promise<Response> {
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
  return res
}
