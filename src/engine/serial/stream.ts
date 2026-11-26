// Streams G-code to a Marlin-compatible printer over a serial port, one acknowledged line at a
// time with line numbers and checksums. Pure (Web Streams only), so tests can drive it with a
// simulated printer.
import { classify, isRecoverableError, numbered, SAFE_STOP, sendableLines, type Reply, type Temps } from './marlin.ts'

export interface SerialLike {
  open(options: { baudRate: number; bufferSize?: number }): Promise<void>
  close(): Promise<void>
  readonly readable: ReadableStream<Uint8Array> | null
  readonly writable: WritableStream<Uint8Array> | null
}

export interface StreamControl {
  paused: boolean
  cancelled: boolean
}

export interface StreamEvents {
  onStart?(total: number): void
  onProgress?(sent: number, total: number): void
  onTemps?(t: Temps): void
  onMessage?(text: string): void
}

export interface StreamOptions {
  baudRate: number
  /** Wait after opening for the board to reboot (most reset when the port opens). */
  bootDelayMs?: number
  /** Give up when the printer says nothing at all for this long. */
  silenceTimeoutMs?: number
}

export type StreamOutcome = { kind: 'done' } | { kind: 'cancelled' } | { kind: 'error'; message: string }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function streamGcode(port: SerialLike, gcode: string, opts: StreamOptions, ctl: StreamControl, ev: StreamEvents = {}): Promise<StreamOutcome> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  let writer: WritableStreamDefaultWriter<Uint8Array> | null = null
  const replies: Reply[] = []
  const signal: { wake: (() => void) | null } = { wake: null }
  let readerDone = false
  const enc = new TextEncoder()

  const next = async (timeoutMs: number): Promise<Reply | null> => {
    if (replies.length) return replies.shift()!
    if (readerDone) return null
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      new Promise<void>((r) => (signal.wake = r)),
      new Promise<void>((r) => (timer = setTimeout(r, timeoutMs))),
    ])
    clearTimeout(timer)
    signal.wake = null
    return replies.shift() ?? null
  }

  let n = 0
  const send = (cmd: string) => writer!.write(enc.encode(`${numbered(n, cmd)}\n`))

  try {
    await port.open({ baudRate: opts.baudRate, bufferSize: 4096 })
    if (!port.readable || !port.writable) throw new Error('The port could not be opened for reading and writing.')
    reader = port.readable.getReader()
    writer = port.writable.getWriter()

    void (async () => {
      const dec = new TextDecoder()
      let buf = ''
      try {
        for (;;) {
          const { value, done } = await reader!.read()
          if (done) break
          buf += dec.decode(value, { stream: true })
          let i: number
          while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i).trim()
            buf = buf.slice(i + 1)
            if (!line) continue
            const r = classify(line)
            if ((r.kind === 'ok' || r.kind === 'temps') && r.temps) ev.onTemps?.(r.temps)
            replies.push(r)
            signal.wake?.()
          }
        }
      } catch {
        /* port closed */
      } finally {
        readerDone = true
        signal.wake?.()
      }
    })()

    await sleep(opts.bootDelayMs ?? 2500)
    replies.length = 0
    const lines = sendableLines(gcode)
    ev.onStart?.(lines.length)
    const silence = opts.silenceTimeoutMs ?? 120_000

    // history: line number -> index into `lines` (-1 is the M110 that starts numbering).
    const history = new Map<number, number>()
    let i = -1
    while (i < lines.length && !ctl.cancelled) {
      while (ctl.paused && !ctl.cancelled) await sleep(100)
      if (ctl.cancelled) break
      history.set(n, i)
      if (history.size > 400) history.delete(n - 400)
      await send(i < 0 ? 'M110 N0' : lines[i]!)
      let resendFrom: number | null = null
      for (;;) {
        // After a resend request Marlin usually sends one more "ok"; don't wait long for it.
        const r = await next(resendFrom !== null ? 1500 : silence)
        if (!r) {
          if (resendFrom !== null) break
          throw new Error(readerDone ? 'The printer disconnected.' : 'The printer stopped responding.')
        }
        if (r.kind === 'resend') {
          resendFrom = r.line
          continue
        }
        if (r.kind === 'error') {
          if (isRecoverableError(r.text)) continue
          throw new Error(`The printer reported: ${r.text}`)
        }
        if (r.kind === 'start') throw new Error('The printer restarted during the print.')
        if (r.kind === 'ok') {
          if (resendFrom === null) {
            n++
            i++
            ev.onProgress?.(Math.max(0, i), lines.length)
          }
          break
        }
        // busy, temperature reports and messages: keep waiting.
      }
      if (resendFrom !== null) {
        const idx = history.get(resendFrom)
        if (idx === undefined) throw new Error(`The printer asked for line ${resendFrom}, which is no longer available.`)
        n = resendFrom
        i = idx
      }
    }

    if (ctl.cancelled) {
      ev.onMessage?.('Stopping: turning heaters off…')
      for (const cmd of SAFE_STOP) {
        await send(cmd)
        n++
        await next(3000)
      }
      return { kind: 'cancelled' }
    }
    return { kind: 'done' }
  } catch (err) {
    try {
      // Unnumbered commands are accepted too; make the printer safe if we can still talk to it.
      if (writer) for (const cmd of SAFE_STOP) await writer.write(enc.encode(`${cmd}\n`))
    } catch {
      /* port already gone */
    }
    return { kind: 'error', message: (err as Error).message }
  } finally {
    try {
      await reader?.cancel()
    } catch {
      /* ignore */
    }
    try {
      reader?.releaseLock()
      writer?.releaseLock()
    } catch {
      /* ignore */
    }
    await port.close().catch(() => {})
  }
}
