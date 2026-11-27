import type { Temps } from '../../engine/serial/marlin'
import { streamGcode, type StreamControl } from '../../engine/serial/stream'

/**
 * Prints over a USB cable: streams G-code to Marlin-compatible firmware line by line.
 * The app window must stay open for the whole print.
 */
export type UsbStatus = 'idle' | 'connecting' | 'printing' | 'paused' | 'stopping' | 'done' | 'error'

export const usb = $state({
  status: 'idle' as UsbStatus,
  name: '',
  sent: 0,
  total: 0,
  temps: {} as Temps,
  message: '',
  startedAt: 0,
})

let ctl: StreamControl = { paused: false, cancelled: false }

export const usbActive = () => usb.status === 'connecting' || usb.status === 'printing' || usb.status === 'paused' || usb.status === 'stopping'

export function pauseUsb(on: boolean) {
  if (!usbActive()) return
  ctl.paused = on
  usb.status = on ? 'paused' : 'printing'
}

export function cancelUsb() {
  if (!usbActive()) return
  ctl.cancelled = true
  ctl.paused = false
  usb.status = 'stopping'
}

/** Must be called from a click: the port picker needs the click's user gesture. */
export async function startUsbPrint(getGcode: () => Promise<Uint8Array>, name: string, baudRate: number, onStarted?: () => void) {
  if (usbActive()) return
  if (!navigator.serial) {
    Object.assign(usb, { status: 'error', message: 'USB printing is not available in this window.' })
    return
  }
  ctl = { paused: false, cancelled: false }
  Object.assign(usb, { status: 'connecting', name, sent: 0, total: 0, temps: {}, message: 'Choose the printer’s USB port…', startedAt: Date.now() })

  let port: BirdySerialPort
  try {
    port = await navigator.serial.requestPort()
  } catch {
    Object.assign(usb, { status: 'idle', message: '' })
    return
  }

  try {
    usb.message = 'Connecting…'
    const text = new TextDecoder().decode(await getGcode())
    const outcome = await streamGcode(port, text, { baudRate }, ctl, {
      onStart: (total) => {
        Object.assign(usb, { status: 'printing', total, message: '' })
        onStarted?.()
      },
      onProgress: (sent) => (usb.sent = sent),
      onTemps: (t) => (usb.temps = { ...usb.temps, ...t }),
      onMessage: (m) => (usb.message = m),
    })
    if (outcome.kind === 'done') Object.assign(usb, { status: 'done', message: 'All G-code sent. The printer finishes the last moves on its own.' })
    else if (outcome.kind === 'cancelled') Object.assign(usb, { status: 'idle', message: 'Print stopped. Heaters are off.' })
    else Object.assign(usb, { status: 'error', message: outcome.message })
  } catch (err) {
    Object.assign(usb, { status: 'error', message: (err as Error).message })
  }
}
