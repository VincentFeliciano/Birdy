import type { Api } from './ipc'

declare global {
  interface Window {
    api: Api
    __demo?: () => Promise<void>
    __setLayout?: (layout: string) => void
  }
}

export {}
