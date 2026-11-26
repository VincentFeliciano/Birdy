import type { Api } from './ipc'

declare global {
  /** The part of the Web Serial API Birdy uses for USB printing. */
  interface BirdySerialPort {
    open(options: { baudRate: number; bufferSize?: number }): Promise<void>
    close(): Promise<void>
    readonly readable: ReadableStream<Uint8Array> | null
    readonly writable: WritableStream<Uint8Array> | null
    getInfo(): { usbVendorId?: number; usbProductId?: number }
  }
  interface Navigator {
    serial?: {
      requestPort(options?: { filters?: { usbVendorId?: number; usbProductId?: number }[] }): Promise<BirdySerialPort>
      getPorts(): Promise<BirdySerialPort[]>
    }
  }
  interface Window {
    api: Api
    __demo?: () => Promise<void>
    __setLayout?: (layout: string) => void
  }
}

export {}
