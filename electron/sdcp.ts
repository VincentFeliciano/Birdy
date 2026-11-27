// Elegoo resin printers over Wi-Fi: SDCP V3 (Saturn 4 / Mars 5 series and similar).
// Only the address the user typed is contacted: discovery is a direct UDP message to it, never a broadcast.
import { createHash, randomUUID } from 'node:crypto'
import { createSocket } from 'node:dgram'
import type { PrinterState, PrinterStatus } from '../src/types/slicing'

const UDP_PORT = 3000
const DEFAULT_PORT = 3030
const CHUNK = 1024 * 1024
const ID_TTL_MS = 10 * 60_000

export interface SdcpInfo {
  mainboardId: string
  name: string
  machine: string
  firmware: string
}

function where(url: string) {
  const u = new URL(url)
  return { host: u.hostname, port: Number(u.port) || DEFAULT_PORT }
}

const known = new Map<string, { info: SdcpInfo; at: number }>()

/** Asks the printer at this address who it is (its mainboard ID is needed for every command). */
export function sdcpDiscover(url: string, timeoutMs = 3000): Promise<SdcpInfo> {
  const { host } = where(url)
  const cached = known.get(host)
  if (cached && Date.now() - cached.at < ID_TTL_MS) return Promise.resolve(cached.info)
  return new Promise((resolve, reject) => {
    const sock = createSocket('udp4')
    const done = (err: Error | null, info?: SdcpInfo) => {
      clearTimeout(timer)
      sock.close()
      if (err) reject(err)
      else {
        known.set(host, { info: info!, at: Date.now() })
        resolve(info!)
      }
    }
    const timer = setTimeout(
      () => done(new Error(`No Elegoo printer answered at ${host}. Check the address on the printer’s screen (Settings → Network) and that it is on the same network.`)),
      timeoutMs,
    )
    sock.on('error', (err) => done(new Error(`Could not reach ${host}: ${err.message}`)))
    sock.on('message', (buf) => {
      try {
        const j = JSON.parse(buf.toString('utf8')) as { Data?: { MainboardID?: string; Name?: string; MachineName?: string; FirmwareVersion?: string } }
        const d = j.Data
        if (!d?.MainboardID || !/^[\w-]{1,64}$/.test(d.MainboardID)) return
        done(null, { mainboardId: d.MainboardID, name: String(d.Name ?? 'Elegoo printer').slice(0, 80), machine: String(d.MachineName ?? '').slice(0, 80), firmware: String(d.FirmwareVersion ?? '').slice(0, 40) })
      } catch {
        // Not an SDCP answer.
      }
    })
    sock.send('M99999', UDP_PORT, host, (err) => err && done(new Error(`Could not reach ${host}: ${err.message}`)))
  })
}

type Msg = { Topic?: string; Data?: { Cmd?: number; RequestID?: string; Data?: { Ack?: number } }; Status?: SdcpStatus }

/** Opens the printer's WebSocket, sends one command and waits for the message `want` accepts. */
async function command(url: string, cmd: number, data: Record<string, unknown>, want: (m: Msg, requestId: string) => boolean, timeoutMs = 5000): Promise<Msg> {
  const info = await sdcpDiscover(url)
  const { host, port } = where(url)
  const requestId = randomUUID().replace(/-/g, '')
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${host}:${port}/websocket`)
    const finish = (err: Error | null, m?: Msg) => {
      clearTimeout(timer)
      try {
        ws.close()
      } catch {
        // Already closed.
      }
      if (err) reject(err)
      else resolve(m!)
    }
    const timer = setTimeout(() => finish(new Error(`${info.name} did not answer in time.`)), timeoutMs)
    ws.onerror = () => finish(new Error(`Could not open a connection to ${host}:${port}.`))
    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          Id: randomUUID().replace(/-/g, ''),
          Data: { Cmd: cmd, Data: data, RequestID: requestId, MainboardID: info.mainboardId, TimeStamp: Math.floor(Date.now() / 1000), From: 0 },
          Topic: `sdcp/request/${info.mainboardId}`,
        }),
      )
    }
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string' || ev.data === 'pong') return
      try {
        const m = JSON.parse(ev.data) as Msg
        if (want(m, requestId)) finish(null, m)
      } catch {
        // Ignore anything that is not JSON.
      }
    }
  })
}

interface SdcpStatus {
  CurrentStatus?: number[] | number
  TempOfUVLED?: number
  TempOfBox?: number
  PrintInfo?: { Status?: number; CurrentLayer?: number; TotalLayer?: number; CurrentTicks?: number; TotalTicks?: number; Filename?: string; ErrorNumber?: number }
}

const FILE_ERRORS = ['', 'the file failed its MD5 check', 'the file could not be read', 'the file is for a different screen resolution', 'the file format is not supported', 'the file is for a different printer model']

/** Maps an SDCP status push onto Boaty's printer status. */
export function mapSdcpStatus(s: SdcpStatus, name: string): PrinterStatus {
  const cur = Array.isArray(s.CurrentStatus) ? s.CurrentStatus : [s.CurrentStatus ?? 0]
  const pi = s.PrintInfo ?? {}
  const sub = pi.Status ?? 0
  const err = pi.ErrorNumber ?? 0
  let state: PrinterState = 'idle'
  let detail = 'Ready'
  if (err > 0) {
    state = 'error'
    detail = `Error: ${FILE_ERRORS[err] ?? `code ${err}`}`
  } else if (cur.includes(1) || cur.includes(3)) {
    state = sub === 5 || sub === 6 ? 'paused' : 'printing'
    detail = cur.includes(3) ? 'Exposure test' : (['Printing', 'Homing', 'Lowering', 'Exposing', 'Lifting', 'Pausing', 'Paused', 'Stopping', 'Stopped', 'Finished', 'Checking the file'][sub] ?? 'Printing')
  } else if (cur.includes(2)) detail = 'Receiving a file'
  else if (cur.includes(4)) detail = 'Self-check'
  else if (sub === 9) {
    state = 'done'
    detail = 'Finished'
  }
  const total = pi.TotalLayer ?? 0
  const active = state === 'printing' || state === 'paused' || state === 'done'
  const ticks = pi.CurrentTicks ?? null
  const totalTicks = pi.TotalTicks ?? null
  if (active && total) detail += ` · layer ${pi.CurrentLayer ?? 0} of ${total}`
  return {
    state,
    detail: detail || name,
    file: pi.Filename || null,
    progress: active && total ? Math.min(1, (pi.CurrentLayer ?? 0) / total) : null,
    elapsed: active && ticks !== null ? ticks / 1000 : null,
    remaining: active && state !== 'done' && ticks !== null && totalTicks ? Math.max(0, (totalTicks - ticks) / 1000) : null,
    hotend: null,
    hotendTarget: null,
    bed: null,
    bedTarget: null,
    camera: false,
  }
}

export async function sdcpStatus(url: string): Promise<PrinterStatus> {
  const info = await sdcpDiscover(url)
  const m = await command(url, 0, {}, (msg) => !!msg.Status && (msg.Topic ?? '').startsWith('sdcp/status/'), 4000)
  return mapSdcpStatus(m.Status!, info.name)
}

export async function sdcpTest(url: string): Promise<string> {
  known.delete(where(url).host)
  const info = await sdcpDiscover(url)
  return `Connected to ${info.name}${info.machine && info.machine !== info.name ? ` (${info.machine})` : ''}${info.firmware ? `, firmware ${info.firmware}` : ''}`
}

/** Uploads a file in 1 MB pieces, as the printer's own software does. */
export async function sdcpUpload(url: string, data: Buffer, filename: string, timeoutMs = 60_000) {
  const { host, port } = where(url)
  const md5 = createHash('md5').update(data).digest('hex')
  const uuid = randomUUID().replace(/-/g, '')
  for (let off = 0; off < data.length || off === 0; off += CHUNK) {
    const form = new FormData()
    form.append('S-File-MD5', md5)
    form.append('Check', '1')
    form.append('Offset', String(off))
    form.append('Uuid', uuid)
    form.append('TotalSize', String(data.length))
    form.append('File', new Blob([new Uint8Array(data.subarray(off, off + CHUNK))], { type: 'application/octet-stream' }), filename)
    let res: Response
    try {
      res = await fetch(`http://${host}:${port}/uploadFile/upload`, { method: 'POST', body: form, signal: AbortSignal.timeout(timeoutMs) })
    } catch (err) {
      throw new Error(`The upload to ${host} stopped: ${(err as Error).message}`)
    }
    const j = (await res.json().catch(() => ({}))) as { success?: boolean; messages?: { message?: string }[] | null }
    if (!res.ok || !j.success) throw new Error(`The printer refused the file${j.messages?.[0]?.message ? `: ${j.messages[0].message}` : ` (HTTP ${res.status})`}.`)
    if (data.length === 0) break
  }
}

const START_ERRORS = ['', 'the printer is busy', 'the file was not found on the printer', 'the file failed its MD5 check', 'the file could not be read', 'the file is for a different screen resolution', 'the file format is not recognised', 'the file is for a different printer model']

export async function sdcpStart(url: string, filename: string) {
  const m = await command(url, 128, { Filename: filename, StartLayer: 0 }, (msg, rid) => (msg.Topic ?? '').startsWith('sdcp/response/') && msg.Data?.Cmd === 128 && msg.Data?.RequestID === rid, 8000)
  const ack = m.Data?.Data?.Ack ?? 0
  if (ack !== 0) throw new Error(`The print did not start: ${START_ERRORS[ack] ?? `code ${ack}`}.`)
}
