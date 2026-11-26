import type { IpcMainEvent, IpcMainInvokeEvent, WebContents } from 'electron'
import type { Rect } from '../src/types/ipc'

let trustedUi: WebContents | null = null

export function setTrustedUi(wc: WebContents) {
  trustedUi = wc
}

/** Only the app's own UI (top frame) may call privileged IPC. */
export function assertTrusted(e: IpcMainEvent | IpcMainInvokeEvent) {
  const frame = e.senderFrame
  if (!trustedUi || e.sender.id !== trustedUi.id || !frame || frame.parent !== null) {
    throw new Error('Rejected IPC from an untrusted sender')
  }
}

export function isId(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0
}

export function isShortString(v: unknown, max = 4096): v is string {
  return typeof v === 'string' && v.length <= max
}

export function isRect(v: unknown): v is Rect {
  if (!v || typeof v !== 'object') return false
  const r = v as Record<string, unknown>
  return ['x', 'y', 'width', 'height'].every((k) => typeof r[k] === 'number' && Number.isFinite(r[k] as number))
}

/** Pages in tabs may only be http(s); the bundled start page is allowed separately. */
export function isWebUrl(url: string) {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}
