// Flashforge printers over Wi-Fi or Ethernet. Only the address the user typed is contacted.
//
// Two ways in, picked by whether the user entered the serial number and check code:
// - HTTP on port 8898 (Adventurer 5M, 5M Pro, AD5X): JSON with serialNumber and checkCode from
//   the printer's "LAN only" mode. Every answer is HTTP 200 with a numeric `code` (0 = success).
// - Text commands on TCP port 8899 (Adventurer 3 / 4, Finder, Guider and older): "~M115\r\n" and so
//   on, each answered with lines ending in "ok". A file is sent as raw bytes after ~M28.
import { connect, type Socket } from 'node:net'
import type { PrinterState, PrinterStatus } from '../src/types/slicing'

export const FF_HTTP_PORT = 8898
export const FF_TCP_PORT = 8899

export interface FlashforgeTarget {
  name: string
  url: string
  /** Serial number and check code: present for the HTTP API (5M series, AD5X). */
  serial?: string
  checkCode?: string
}

const host = (url: string) => new URL(url).hostname
/** A port the user typed in the address wins; otherwise the protocol's own port. */
const port = (url: string, fallback: number) => Number(new URL(url).port) || fallback
export const usesHttp = (t: FlashforgeTarget) => !!(t.serial && t.checkCode)

// ---- HTTP (5M series, AD5X) -------------------------------------------------------------------

interface FfDetail {
  status?: string
  printProgress?: number
  printFileName?: string
  printDuration?: number
  estimatedTime?: number
  rightTemp?: number
  rightTargetTemp?: number
  leftTemp?: number
  leftTargetTemp?: number
  platTemp?: number
  platTargetTemp?: number
  name?: string
  firmwareVersion?: string
  pid?: string | number
  errorCode?: string
}

function httpError(t: FlashforgeTarget, code: number, message?: string): Error {
  if (code === -2) return new Error(`${t.name} is not in LAN mode. On the printer turn on Settings → Network → "LAN only" mode, then use the check code it shows.`)
  if (code === 1) return new Error(`${t.name} rejected the serial number or check code. Both are on the printer: the serial number under Settings → About, the check code in LAN-only mode.`)
  if (code === 2) return new Error(`${t.name} is busy (already printing?).`)
  if (code === 3 && /unauthori/i.test(message ?? '')) return new Error(`${t.name} rejected the serial number or check code.`)
  if (code === 3) return new Error(`${t.name} couldn't find that file.`)
  return new Error(`${t.name} answered: ${message || `error ${code}`}.`)
}

async function httpCall<T>(t: FlashforgeTarget, path: string, init: RequestInit, timeoutMs: number): Promise<T> {
  const url = `http://${host(t.url)}:${port(t.url, FF_HTTP_PORT)}${path}`
  let res: Response
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), redirect: 'error' })
  } catch (err) {
    const e = err as Error & { cause?: { code?: string } }
    if (e.name === 'TimeoutError') throw new Error(`${t.name} did not answer in time. Check that it is on and on the same network.`)
    if (e.cause?.code === 'ECONNREFUSED') throw new Error(`${t.name} refused the connection on port ${FF_HTTP_PORT}. Older Flashforge printers have no serial number login: clear those fields.`)
    if (e.cause?.code === 'ENOTFOUND' || e.cause?.code === 'EAI_AGAIN') throw new Error(`Couldn’t find ${host(t.url)} on the network.`)
    throw new Error(`Couldn’t reach ${t.name}: ${e.message}`)
  }
  if (!res.ok) throw new Error(`${t.name} answered HTTP ${res.status}.`)
  let j: { code?: number; message?: string } & Record<string, unknown>
  try {
    j = (await res.json()) as typeof j
  } catch {
    throw new Error(`${t.name} sent an answer Boaty doesn't understand.`)
  }
  if (typeof j.code === 'number' && j.code !== 0) throw httpError(t, j.code, j.message)
  return j as T
}

const auth = (t: FlashforgeTarget) => ({ serialNumber: t.serial!, checkCode: t.checkCode! })
const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

async function httpDetail(t: FlashforgeTarget, timeoutMs: number): Promise<FfDetail> {
  const j = await httpCall<{ detail?: FfDetail }>(t, '/detail', json(auth(t)), timeoutMs)
  return j.detail ?? {}
}

const MODELS: Record<number, string> = { 0x35: 'Adventurer 5M', 0x36: 'Adventurer 5M Pro', 0x38: 'AD5X' }
const pidOf = (d: FfDetail) => (typeof d.pid === 'number' ? d.pid : parseInt(String(d.pid ?? ''), 16))

// ---- TCP (all models, the only way in on older ones) ------------------------------------------

/** One TCP session: commands go out as "~CMD\r\n"; each answer runs up to its "ok" line. */
class TcpSession {
  private buf = ''
  private waiter: { test: (s: string) => boolean; resolve: (s: string) => void; reject: (e: Error) => void; timer: NodeJS.Timeout } | null = null
  private closedErr: Error | null = null

  private t: FlashforgeTarget
  private sock: Socket

  private constructor(t: FlashforgeTarget, sock: Socket) {
    this.t = t
    this.sock = sock
    sock.setEncoding('latin1')
    sock.on('data', (d: string) => {
      this.buf += d
      this.check()
    })
    sock.on('error', (err) => this.fail(new Error(`Lost the connection to ${t.name}: ${err.message}`)))
    sock.on('close', () => this.fail(new Error(`${t.name} closed the connection.`)))
  }

  static open(t: FlashforgeTarget, timeoutMs: number): Promise<TcpSession> {
    return new Promise((resolve, reject) => {
      const sock = connect({ host: host(t.url), port: port(t.url, FF_TCP_PORT) })
      const timer = setTimeout(() => {
        sock.destroy()
        reject(new Error(`${t.name} did not answer in time. Check that it is on and on the same network.`))
      }, timeoutMs)
      sock.once('connect', () => {
        clearTimeout(timer)
        resolve(new TcpSession(t, sock))
      })
      sock.once('error', (err: NodeJS.ErrnoException) => {
        clearTimeout(timer)
        if (err.code === 'ECONNREFUSED') reject(new Error(`${t.name} refused the connection on port ${FF_TCP_PORT}. Check the address on the printer's screen.`))
        else if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') reject(new Error(`Couldn’t find ${host(t.url)} on the network.`))
        else reject(new Error(`Couldn’t reach ${t.name}: ${err.message}`))
      })
    })
  }

  private fail(err: Error) {
    this.closedErr ??= err
    const w = this.waiter
    if (w) {
      this.waiter = null
      clearTimeout(w.timer)
      w.reject(this.closedErr)
    }
  }

  private check() {
    const w = this.waiter
    if (!w || !w.test(this.buf)) return
    this.waiter = null
    clearTimeout(w.timer)
    const out = this.buf
    this.buf = ''
    w.resolve(out)
  }

  /** Sends one command and returns its whole answer. */
  send(cmd: string, timeoutMs = 5000, done = (s: string) => /(^|\n)ok\r?\n/.test(s)): Promise<string> {
    if (this.closedErr) return Promise.reject(this.closedErr)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = null
        reject(new Error(`${this.t.name} did not answer ${cmd.split(' ')[0]} in time.`))
      }, timeoutMs)
      this.waiter = { test: done, resolve, reject, timer }
      // Each answer is read from scratch, so a late line from an earlier command can't end this one.
      this.buf = ''
      this.sock.write(`~${cmd}\r\n`)
    })
  }

  write(data: Buffer): Promise<void> {
    return new Promise((resolve, reject) => this.sock.write(data, (err) => (err ? reject(err) : resolve())))
  }

  /** Takes control of the printer (only one program at a time may). */
  async login() {
    // Success ends with "ok"; failure has no "ok" line, so stop at its own line.
    const r = await this.send('M601 S1', 5000, (s) => /Control Failed[^\n]*\n/i.test(s) || /(^|\n)ok\r?\n/.test(s))
    if (/Control Failed/i.test(r)) throw new Error(`${this.t.name} is being controlled by another program (FlashPrint or Orca?). Close it and try again.`)
  }

  async close() {
    try {
      await this.send('M602', 2000)
    } catch {
      // Closing anyway.
    }
    this.sock.destroy()
  }
}

async function withTcp<T>(t: FlashforgeTarget, timeoutMs: number, fn: (s: TcpSession) => Promise<T>): Promise<T> {
  const s = await TcpSession.open(t, timeoutMs)
  try {
    await s.login()
    return await fn(s)
  } finally {
    await s.close()
  }
}

/** "Key: value" lines of a TCP answer, keyed by the text before the first colon. */
export function ffFields(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z][\w ]*?)\s*:\s?(.*)$/.exec(line)
    if (m && !(m[1]! in out)) out[m[1]!] = m[2]!.trim()
  }
  return out
}

/** Temperatures from "T0:210/210 T1:0/0 B:60/60" (older firmware writes "T0:22 /0"). */
export function ffTemps(text: string): { hotend: number | null; hotendTarget: number | null; bed: number | null; bedTarget: number | null } {
  const t = /T0:\s*([\d.]+)\s*\/\s*([\d.]+)/.exec(text)
  const b = /B:\s*([\d.]+)\s*\/\s*([\d.]+)/.exec(text)
  return { hotend: t ? Number(t[1]) : null, hotendTarget: t ? Number(t[2]) : null, bed: b ? Number(b[1]) : null, bedTarget: b ? Number(b[2]) : null }
}

/** Print state from ~M119's MachineStatus line. */
export function ffTcpState(machineStatus: string, moveMode = ''): PrinterState {
  const s = machineStatus.toUpperCase()
  if (/PAUSED/.test(s) || /PAUSED/.test(moveMode.toUpperCase())) return 'paused'
  if (/BUILDING_COMPLETED/.test(s)) return 'done'
  if (/BUILDING/.test(s)) return 'printing'
  if (/ERROR/.test(s)) return 'error'
  if (/BUSY/.test(s)) return 'printing'
  return 'idle'
}

/** Print state from the HTTP /detail status word. */
export function ffHttpState(status: string): PrinterState {
  const s = status.toLowerCase()
  if (s === 'ready' || s === '') return 'idle'
  if (s === 'pause' || s === 'pausing') return 'paused'
  if (s === 'completed') return 'done'
  if (s === 'error') return 'error'
  if (s === 'cancel') return 'idle'
  return 'printing'
}

/** A file name the printer accepts: plain characters and a .gcode ending. */
export function ffFileName(name: string): string {
  const base = name.replace(/[^\w.\- ]+/g, '_').replace(/^\.+/, '').slice(0, 80) || 'print'
  return /\.(gcode|gx|g)$/i.test(base) ? base : `${base}.gcode`
}

// ---- What printers.ts calls -------------------------------------------------------------------

export async function ffTest(t: FlashforgeTarget): Promise<string> {
  if (usesHttp(t)) {
    const d = await httpDetail(t, 8000)
    const model = MODELS[pidOf(d)] ?? 'Flashforge printer'
    return `Connected to ${d.name || model}${d.firmwareVersion ? ` (firmware ${d.firmwareVersion})` : ''}.`
  }
  return withTcp(t, 8000, async (s) => {
    const f = ffFields(await s.send('M115'))
    const what = f['Machine Name'] || f['Machine Type'] || 'Flashforge printer'
    return `Connected to ${what}${f.Firmware ? ` (firmware ${f.Firmware.trim()})` : ''}.`
  })
}

export async function ffStatus(t: FlashforgeTarget, timeoutMs: number): Promise<PrinterStatus> {
  if (usesHttp(t)) {
    const d = await httpDetail(t, timeoutMs)
    const raw = String(d.status ?? '')
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
    const state = ffHttpState(raw)
    const active = state === 'printing' || state === 'paused'
    return {
      state,
      detail: raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : 'Connected',
      file: active || state === 'done' ? d.printFileName || null : null,
      progress: active || state === 'done' ? num(d.printProgress) : null,
      elapsed: active ? num(d.printDuration) : null,
      remaining: active ? num(d.estimatedTime) : null,
      hotend: num(d.rightTemp) ?? num(d.leftTemp),
      hotendTarget: num(d.rightTargetTemp) ?? num(d.leftTargetTemp),
      bed: num(d.platTemp),
      bedTarget: num(d.platTargetTemp),
      camera: false,
    }
  }
  return withTcp(t, timeoutMs, async (s) => {
    const st = ffFields(await s.send('M119', timeoutMs))
    const temps = ffTemps(await s.send('M105', timeoutMs))
    const prog = /byte\s+(\d+)\s*\/\s*(\d+)/i.exec(await s.send('M27', timeoutMs))
    const state = ffTcpState(st.MachineStatus ?? '', st.MoveMode)
    const done = prog ? Number(prog[1]) : 0
    const total = prog ? Number(prog[2]) : 0
    const raw = (st.MachineStatus ?? 'READY').replace(/_/g, ' ').toLowerCase()
    return {
      state,
      detail: raw.charAt(0).toUpperCase() + raw.slice(1),
      file: st.CurrentFile || null,
      progress: (state === 'printing' || state === 'paused') && total > 0 ? Math.min(1, done / total) : null,
      elapsed: null,
      remaining: null,
      ...temps,
      camera: false,
    }
  })
}

/** Uploads G-code and, if asked, starts it. Returns the name the printer stored it under. */
export async function ffSend(t: FlashforgeTarget, fileName: string, data: Buffer, start: boolean, timeoutMs: number): Promise<string> {
  const name = ffFileName(fileName)
  if (usesHttp(t)) {
    // Checks the login first, so a wrong code doesn't wait for the whole upload.
    const d = await httpDetail(t, 8000)
    if (start && ffHttpState(String(d.status ?? '')) === 'printing') throw new Error(`${t.name} is busy printing. Wait for it to finish, or send without starting.`)
    const ad5x = pidOf(d) === 0x38
    const headers: Record<string, string> = {
      serialNumber: t.serial!,
      checkCode: t.checkCode!,
      fileSize: String(data.length),
      printNow: start ? 'true' : 'false',
      levelingBeforePrint: 'true',
    }
    if (ad5x) Object.assign(headers, { flowCalibration: 'false', firstLayerInspection: 'false', timeLapseVideo: 'false', useMatlStation: 'false', gcodeToolCnt: '0', materialMappings: 'W10=' })
    const form = new FormData()
    form.append('gcodeFile', new Blob([new Uint8Array(data)], { type: 'application/octet-stream' }), name)
    await httpCall(t, '/uploadGcode', { method: 'POST', headers, body: form }, timeoutMs)
    return name
  }
  await withTcp(t, 10_000, async (s) => {
    const path = `0:/user/${name}`
    const r = await s.send(`M28 ${data.length} ${path}`, 10_000, (x) => /(^|\n)ok\r?\n/.test(x) || /Error/i.test(x))
    if (/not enough space/i.test(r)) throw new Error(`${t.name} doesn't have enough free space for this file.`)
    if (/Error/i.test(r)) throw new Error(`${t.name} refused the file: ${r.split(/\r?\n/).find((l) => /Error/i.test(l))?.trim()}`)
    for (let o = 0; o < data.length; o += 64 * 1024) await s.write(data.subarray(o, o + 64 * 1024))
    const end = await s.send('M29', timeoutMs, (x) => /(^|\n)ok\r?\n/.test(x) || /Not Aviable|Not Available|Error/i.test(x))
    if (/Not Aviable|Not Available|Error/i.test(end)) throw new Error(`${t.name} didn't receive the whole file. Try again.`)
    if (start) await s.send(`M23 ${path}`, 10_000)
  })
  return name
}
