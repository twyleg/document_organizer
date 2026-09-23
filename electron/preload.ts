import { contextBridge, ipcRenderer } from 'electron'
import type { FileBrowserAPI } from '../shared/types'

const api: FileBrowserAPI = {
  locations: () => ipcRenderer.invoke('files:locations'),
  listDirectory: (path) => ipcRenderer.invoke('files:list', path),
  chooseDirectory: () => ipcRenderer.invoke('files:choose'),
  openFile: (path) => ipcRenderer.invoke('files:open', path)
}
contextBridge.exposeInMainWorld('files', api)
