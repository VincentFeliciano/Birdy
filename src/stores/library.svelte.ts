import type { LibraryData, TabInfo } from '../types/ipc'

export const library = $state<LibraryData & { loaded: boolean }>({
  groups: ['Unsorted'],
  bookmarks: [],
  models: [],
  loaded: false,
})

function apply(d: LibraryData) {
  library.groups = d.groups
  library.bookmarks = d.bookmarks
  library.models = d.models
  library.loaded = true
}

export function initLibrary() {
  void window.api.library.get().then(apply)
  return window.api.library.onChange(apply)
}

export const isBookmarked = (url: string) => library.bookmarks.some((b) => b.url === url)

export function toggleBookmark(tab: TabInfo) {
  const existing = library.bookmarks.find((b) => b.url === tab.url)
  if (existing) window.api.library.removeBookmark(existing.id)
  else window.api.library.addBookmark({ title: tab.title, url: tab.url, favicon: tab.favicon })
}
