import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join, parse } from 'node:path'
import { pathToFileURL } from 'node:url'
import { stat } from 'node:fs/promises'
import { listDirectory, validatePath } from './filesystem'
import type { Location } from '../shared/types'

let window: BrowserWindow | null = null
const devUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined
const rendererFile = join(__dirname, '../renderer/index.html')
const rendererUrl = devUrl ? new URL(devUrl).href : pathToFileURL(rendererFile).href

function registerHandlers() {
  const handle = (channel: string, fn: (...args: any[]) => unknown) => {
    ipcMain.handle(channel, (event, ...args) => {
      if (!window || event.sender !== window.webContents ||
          event.senderFrame !== window.webContents.mainFrame ||
          event.senderFrame.url !== rendererUrl) {
        throw new Error('Untrusted request.')
      }
      return fn(...args)
    })
  }
  handle('files:locations', (): Location[] => [
    { name: 'Home', path: app.getPath('home'), icon: 'house-door' },
    { name: 'Desktop', path: app.getPath('desktop'), icon: 'display' },
    { name: 'Documents', path: app.getPath('documents'), icon: 'file-earmark-text' },
    { name: 'Downloads', path: app.getPath('downloads'), icon: 'download' },
    { name: 'Pictures', path: app.getPath('pictures'), icon: 'image' },
    { name: 'File system', path: parse(app.getPath('home')).root, icon: 'hdd' }
  ])
  handle('files:list', listDirectory)
  handle('files:choose', async () => {
    const result = await dialog.showOpenDialog(window!, { properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0] ?? null
  })
  handle('files:open', async (value: unknown) => {
    const path = validatePath(value)
    if (!(await stat(path)).isFile()) throw new Error('Only regular files can be opened.')
    const error = await shell.openPath(path)
    if (error) throw new Error(error)
  })
}

async function createWindow() {
  window = new BrowserWindow({
    width: 1120, height: 760, minWidth: 760, minHeight: 480,
    title: 'File Browser', backgroundColor: '#f8fafc', autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true
    }
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  window.on('closed', () => { window = null })
  if (devUrl) await window.loadURL(devUrl)
  else await window.loadFile(rendererFile)
}

app.whenReady().then(async () => {
  registerHandlers()
  await createWindow()
  app.on('activate', () => { if (!window) void createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
