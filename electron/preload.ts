import { contextBridge, ipcRenderer } from 'electron'
import type { FileBrowserAPI } from '../shared/types'

const api: FileBrowserAPI = {
  archiveContextMenu: (root, path) => ipcRenderer.invoke('archive:menu', root, path),
  createArchiveFolder: (root, parent, name) => ipcRenderer.invoke('archive:create', root, parent, name),
  renameArchiveEntry: (root, path, name) => ipcRenderer.invoke('archive:rename', root, path, name),
  deleteArchiveEntry: (root, path) => ipcRenderer.invoke('archive:delete', root, path),
  locations: () => ipcRenderer.invoke('files:locations'),
  listDirectory: (path) => ipcRenderer.invoke('files:list', path),
  listInputDirectory: (path) => ipcRenderer.invoke('files:input', path),
  chooseDirectory: () => ipcRenderer.invoke('files:choose'),
  openFile: (path) => ipcRenderer.invoke('files:open', path),
  previewFile: (path) => ipcRenderer.invoke('files:preview', path),
  moveFile: (source, folder) => ipcRenderer.invoke('files:move', source, folder),
  renameFile: (source, name) => ipcRenderer.invoke('files:rename', source, name),
  readPdf: (path) => ipcRenderer.invoke('pdf:read', path),
  ocrPdf: (path, version) => ipcRenderer.invoke('pdf:ocr', path, version),
  savePdf: (path, version, pages) => ipcRenderer.invoke('pdf:save', path, version, pages)
}
contextBridge.exposeInMainWorld('files', api)
