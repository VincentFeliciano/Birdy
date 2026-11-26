import type { DownloadInfo, TabsState } from '../types/ipc'

export const browser = $state<TabsState & { focusAddressTick: number }>({
  tabs: [],
  activeId: null,
  focusAddressTick: 0,
})

export const downloads = $state({
  items: [] as DownloadInfo[],
  open: false,
})

export const activeTab = () => browser.tabs.find((t) => t.id === browser.activeId) ?? null

export function initStores() {
  const offTabs = window.api.tabs.onState((s) => {
    browser.tabs = s.tabs
    browser.activeId = s.activeId
  })
  const offDl = window.api.downloads.onUpdate((items) => {
    const known = new Set(downloads.items.map((d) => d.id))
    if (items.some((d) => !known.has(d.id))) downloads.open = true
    downloads.items = items
  })
  return () => {
    offTabs()
    offDl()
  }
}

export function focusAddress() {
  browser.focusAddressTick++
}
