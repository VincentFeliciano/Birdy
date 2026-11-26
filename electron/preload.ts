import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { Api } from '../src/types/ipc'

function on<T>(channel: string, cb: (payload: T) => void) {
  const handler = (_e: IpcRendererEvent, payload: T) => cb(payload)
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

// Only these narrowly scoped calls are exposed to the app UI. Websites never get a preload.
const api: Api = {
  tabs: {
    create: (url) => ipcRenderer.send('tabs:create', url),
    close: (id) => ipcRenderer.send('tabs:close', id),
    activate: (id) => ipcRenderer.send('tabs:activate', id),
    navigate: (input, searchType) => ipcRenderer.send('tabs:navigate', input, searchType),
    back: () => ipcRenderer.send('tabs:back'),
    forward: () => ipcRenderer.send('tabs:forward'),
    reload: () => ipcRenderer.send('tabs:reload'),
    stop: () => ipcRenderer.send('tabs:stop'),
    home: () => ipcRenderer.send('tabs:home'),
    onState: (cb) => on('tabs:state', cb),
  },
  layout: {
    setWebBounds: (rect) => ipcRenderer.send('layout:bounds', rect),
    setWebVisible: (visible) => ipcRenderer.send('layout:visible', visible),
  },
  downloads: {
    onUpdate: (cb) => on('downloads:update', cb),
    onModelReady: (cb) => on('downloads:model-ready', cb),
    cancel: (id) => ipcRenderer.send('downloads:cancel', id),
    retry: (id) => ipcRenderer.send('downloads:retry', id),
    showInFolder: (id) => ipcRenderer.send('downloads:show', id),
    clear: () => ipcRenderer.send('downloads:clear'),
    readModel: (id) => ipcRenderer.invoke('downloads:read-model', id),
    openFolder: () => ipcRenderer.send('downloads:open-folder'),
  },
  files: {
    openModel: () => ipcRenderer.invoke('files:open-model'),
    saveModel: (req) => ipcRenderer.invoke('files:save-model', req),
    reopenSaved: (path) => ipcRenderer.invoke('files:reopen-saved', path),
  },
  library: {
    get: () => ipcRenderer.invoke('library:get'),
    onChange: (cb) => on('library:changed', cb),
    addBookmark: (b) => ipcRenderer.send('library:add-bookmark', b),
    removeBookmark: (id) => ipcRenderer.send('library:remove-bookmark', id),
    addModel: (m) => ipcRenderer.invoke('library:add-model', m),
    removeModel: (id) => ipcRenderer.send('library:remove-model', id),
    readModel: (id) => ipcRenderer.invoke('library:read-model', id),
    showModel: (id) => ipcRenderer.send('library:show-model', id),
    move: (kind, id, group) => ipcRenderer.send('library:move', kind, id, group),
    createGroup: (name) => ipcRenderer.send('library:create-group', name),
    renameGroup: (from, to) => ipcRenderer.send('library:rename-group', from, to),
    deleteGroup: (name) => ipcRenderer.send('library:delete-group', name),
  },
  slicer: {
    list: () => ipcRenderer.invoke('slicer:list'),
    choose: () => ipcRenderer.invoke('slicer:choose'),
    setDefault: (id) => ipcRenderer.send('slicer:set-default', id),
    open: (req) => ipcRenderer.invoke('slicer:open', req),
  },
  app: {
    onShortcut: (cb) => on('app:shortcut', cb),
  },
}

contextBridge.exposeInMainWorld('api', api)
