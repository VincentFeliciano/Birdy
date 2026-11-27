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
    getModel: () => ipcRenderer.invoke('tabs:get-model'),
    onState: (cb) => on('tabs:state', cb),
  },
  layout: {
    setWebBounds: (rect) => ipcRenderer.send('layout:bounds', rect),
    setWebVisible: (visible) => ipcRenderer.send('layout:visible', visible),
  },
  downloads: {
    onUpdate: (cb) => on('downloads:update', cb),
    onModelReady: (cb) => on('downloads:model-ready', cb),
    onModelDropped: (cb) => on('files:dropped', cb),
    cancel: (id) => ipcRenderer.send('downloads:cancel', id),
    retry: (id) => ipcRenderer.send('downloads:retry', id),
    showInFolder: (id) => ipcRenderer.send('downloads:show', id),
    clear: () => ipcRenderer.send('downloads:clear'),
    readModel: (id) => ipcRenderer.invoke('downloads:read-model', id),
    openFolder: () => ipcRenderer.send('downloads:open-folder'),
  },
  models: {
    list: (rel) => ipcRenderer.invoke('models:list', rel),
    read: (rel) => ipcRenderer.invoke('models:read', rel),
    reveal: (rel) => ipcRenderer.send('models:reveal', rel),
    search: (query) => ipcRenderer.invoke('models:search', query),
    lookup: (rels) => ipcRenderer.invoke('models:lookup', rels),
    getThumb: (rel) => ipcRenderer.invoke('models:get-thumb', rel),
    importDownloads: () => ipcRenderer.invoke('models:import-downloads'),
    saveThumb: (rel, dataUrl) => ipcRenderer.send('models:save-thumb', rel, dataUrl),
    onChanged: (cb) => on('models:changed', cb),
    onImported: (cb) => on('models:imported', cb),
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
  updates: {
    get: () => ipcRenderer.invoke('update:get'),
    onState: (cb) => on('update:state', cb),
    check: () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.send('update:install'),
  },
  theme: {
    setAccent: (hex) => ipcRenderer.send('theme:accent', hex),
  },
  history: {
    list: () => ipcRenderer.invoke('history:list'),
    add: (e) => ipcRenderer.invoke('history:add', e),
    update: (id, patch) => ipcRenderer.invoke('history:update', id, patch),
    remove: (id) => ipcRenderer.invoke('history:remove', id),
    reveal: (id) => ipcRenderer.invoke('history:reveal', id),
    onChange: (cb) => on('history:changed', cb),
  },
  resin: {
    save: (req) => ipcRenderer.invoke('resin:save', req),
    reveal: (path) => ipcRenderer.send('resin:reveal', path),
  },
  slicer: {
    list: () => ipcRenderer.invoke('slicer:list'),
    choose: () => ipcRenderer.invoke('slicer:choose'),
    setDefault: (id) => ipcRenderer.send('slicer:set-default', id),
    open: (req) => ipcRenderer.invoke('slicer:open', req),
  },
  engine: {
    get: () => ipcRenderer.invoke('engine:get'),
    onState: (cb) => on('engine:state', cb),
    install: () => ipcRenderer.invoke('engine:install'),
    cancelInstall: () => ipcRenderer.send('engine:cancel-install'),
    catalog: (refresh) => ipcRenderer.invoke('engine:catalog', !!refresh),
    slice: (req) => ipcRenderer.invoke('engine:slice', req),
    cancelSlice: () => ipcRenderer.send('engine:cancel-slice'),
    readGcode: (jobId) => ipcRenderer.invoke('engine:read-gcode', jobId),
    saveGcode: (jobId) => ipcRenderer.invoke('engine:save-gcode', jobId),
    importCandidates: () => ipcRenderer.invoke('engine:import-candidates'),
    importSettings: (source) => ipcRenderer.invoke('engine:import', source),
  },
  printers: {
    list: () => ipcRenderer.invoke('printers:list'),
    save: (p) => ipcRenderer.invoke('printers:save', p),
    remove: (id) => ipcRenderer.invoke('printers:remove', id),
    test: (id) => ipcRenderer.invoke('printers:test', id),
    send: (req) => ipcRenderer.invoke('printers:send', req),
    status: (id) => ipcRenderer.invoke('printers:status', id),
    snapshot: (id) => ipcRenderer.invoke('printers:snapshot', id),
    onChoosePort: (cb) => on('serial:choose', cb),
    choosePort: (portId) => ipcRenderer.send('serial:chosen', portId),
  },
  app: {
    onShortcut: (cb) => on('app:shortcut', cb),
  },
}

contextBridge.exposeInMainWorld('api', api)
