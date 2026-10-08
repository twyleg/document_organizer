import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, shell } from 'electron'
import { archiveIndexPath, buildArchiveIndex, migrateArchiveIndex } from './archiveIndex'
import { randomUUID } from 'node:crypto'
import { basename, join, parse } from 'node:path'
import { pathToFileURL } from 'node:url'
import { realpath, stat } from 'node:fs/promises'
import { listDirectory, moveFile, previewFile, renameFile, validatePath } from './filesystem'
import type { Location } from '../shared/types'
import { readPdf, savePdf } from './pdf'
import { ocrPdf } from './ocr'
import { InputDirectoryReader } from './inputDirectory'
import {
  archiveEntry,
  createArchiveFolder,
  renameArchiveEntry,
  trashArchiveEntry,
  moveArchiveFile
} from './archive'
import { inputFile, trashInputFile } from './inputActions'

import { startupDirectories } from './startupDirectories'

const inputDirectory = new InputDirectoryReader()

let window: BrowserWindow | null = null
let activePreview: { route: string; path: string; mime: string } | null = null
let previewGeneration = 0
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'document',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])
const devUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined
const rendererFile = join(__dirname, '../renderer/index.html')
const rendererUrl = devUrl ? new URL(devUrl).href : pathToFileURL(rendererFile).href

function registerHandlers() {
  const handle = (channel: string, fn: (...args: any[]) => unknown) => {
    ipcMain.handle(channel, (event, ...args) => {
      if (
        !window ||
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame ||
        event.senderFrame.url !== rendererUrl
      ) {
        throw new Error('Untrusted request.')
      }

      return fn(...args)
    })
  }
  handle('files:startup-directories', () => startupDirectories(process.argv))
  handle('files:locations', (): Location[] => [
    { name: 'Home', path: app.getPath('home'), icon: 'house-door' },
    { name: 'Desktop', path: app.getPath('desktop'), icon: 'display' },
    { name: 'Documents', path: app.getPath('documents'), icon: 'file-earmark-text' },
    { name: 'Downloads', path: app.getPath('downloads'), icon: 'download' },
    { name: 'Pictures', path: app.getPath('pictures'), icon: 'image' },
    { name: 'File system', path: parse(app.getPath('home')).root, icon: 'hdd' }
  ])
  const indexing = new Map<string, Promise<unknown>>()
  handle('archive:index', async (rootValue, rebuild = false, requestId = '') => {
    const requestedRoot = validatePath(rootValue)
    const root = await realpath(requestedRoot)
    const previous = indexing.get(root)
    const pending = (previous ? previous.catch(() => {}) : Promise.resolve())
      .then(async () => {
        const current = await migrateArchiveIndex(
          root,
          requestedRoot,
          app.getPath('userData'),
          rebuild
        )

        return rebuild
          ? buildArchiveIndex(root, archiveIndexPath(root), undefined, (progress) => {
              if (window && !window.webContents.isDestroyed()) {
                window.webContents.send('archive:index-progress', { ...progress, requestId })
              }
            })
          : current
      })
      .finally(() => {
        if (indexing.get(root) === pending) {
          indexing.delete(root)
        }
      })
    indexing.set(root, pending)
    return pending
  })
  handle('files:list', listDirectory)
  handle('input:menu', async (root, path) => {
    await inputFile(root, path)

    return new Promise((resolve) => {
      let action: 'rename' | 'delete' | null = null
      Menu.buildFromTemplate([
        {
          label: 'Rename simple…',
          click: () => {
            action = 'rename'
          }
        },
        {
          label: 'Delete…',
          click: () => {
            action = 'delete'
          }
        }
      ]).popup({ window: window!, callback: () => resolve(action) })
    })
  })
  handle('input:delete', async (root, path) => {
    await trashInputFile(root, path, (target) => shell.trashItem(target))
    if (activePreview?.path === path) {
      activePreview = null
      previewGeneration++
    }
  })
  handle('archive:menu', async (root, path) => {
    const entry = await archiveEntry(root, path, true)

    return new Promise((resolve) => {
      let action: 'create' | 'rename' | 'delete' | null = null
      Menu.buildFromTemplate([
        {
          label: 'New folder…',
          enabled: entry.isDirectory,
          click: () => {
            action = 'create'
          }
        },
        {
          label: 'Rename…',
          enabled: entry.path !== entry.root,
          click: () => {
            action = 'rename'
          }
        },
        { type: 'separator' },
        {
          label: 'Delete…',
          enabled: entry.path !== entry.root,
          click: () => {
            action = 'delete'
          }
        }
      ]).popup({ window: window!, callback: () => resolve(action) })
    })
  })
  handle('archive:create', createArchiveFolder)
  handle('archive:move', async (root, source, destination) => {
    const path = await moveArchiveFile(root, source, destination)
    if (activePreview?.path === source) {
      activePreview = null
      previewGeneration++
    }

    return path
  })
  handle('archive:rename', renameArchiveEntry)
  handle('archive:delete', (root, path) =>
    trashArchiveEntry(root, path, (target) => shell.trashItem(target))
  )
  handle('files:input', (path) => inputDirectory.read(path))
  handle('files:rename', async (source: unknown, name: unknown) => {
    const path = await renameFile(source, name)
    await inputDirectory.acknowledge(path).catch(() => {})
    activePreview = null
    previewGeneration++
    return path
  })
  handle('pdf:read', readPdf)
  handle('pdf:ocr', async (path, version) => {
    const data = await ocrPdf(path, version)
    await inputDirectory.acknowledge(path, data).catch(() => {})

    return data
  })
  handle('pdf:save', async (path, version, pages) => {
    const data = await savePdf(path, version, pages)
    await inputDirectory.acknowledge(path, data).catch(() => {})

    return data
  })
  handle('files:move', async (source: unknown, folder: unknown) => {
    activePreview = null
    previewGeneration++
    const path = await moveFile(source, folder)
    await inputDirectory.acknowledge(path).catch(() => {})

    return path
  })
  handle('files:preview', async (value: unknown) => {
    const generation = ++previewGeneration
    activePreview = null
    const file = await previewFile(value)
    if (generation !== previewGeneration) {
      throw new Error('Preview selection changed.')
    }

    const route = `/${randomUUID()}/${encodeURIComponent(basename(file.path))}`
    activePreview = { route, path: file.path, mime: file.mime }

    return { url: `document://preview${route}`, kind: file.kind }
  })
  handle('files:choose', async () => {
    const result = await dialog.showOpenDialog(window!, { properties: ['openDirectory'] })

    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  handle('files:open', async (value: unknown) => {
    const path = validatePath(value)
    if (!(await stat(path)).isFile()) {
      throw new Error('Only regular files can be opened.')
    }

    const error = await shell.openPath(path)
    if (error) {
      throw new Error(error)
    }
  })
}

async function createWindow() {
  window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    title: 'Document Organizer',
    backgroundColor: '#f8fafc',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      plugins: true,
      // Scanner arrivals and the OCR queue must keep running when minimized.
      backgroundThrottling: false
    }
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.on('will-prevent-unload', (event) => {
    const response = dialog.showMessageBoxSync(window!, {
      type: 'question',
      title: 'Unsaved PDF changes',
      message: 'Keep editing this PDF or discard your unsaved changes?',
      buttons: ['Keep editing', 'Discard changes'],
      defaultId: 0,
      cancelId: 0
    })
    if (response === 1) {
      event.preventDefault()
    }
  })
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false)
  )
  window.on('closed', () => {
    window = null
    activePreview = null
  })
  if (devUrl) {
    await window.loadURL(devUrl)
  } else {
    await window.loadFile(rendererFile)
  }
}

app.whenReady().then(async () => {
  protocol.handle('document', async (request) => {
    const url = new URL(request.url)
    const preview = activePreview
    if (
      !preview ||
      url.hostname !== 'preview' ||
      url.pathname !== preview.route ||
      !['GET', 'HEAD'].includes(request.method)
    ) {
      return new Response(null, { status: 404 })
    }

    try {
      const response = await net.fetch(pathToFileURL(preview.path).href)

      return new Response(request.method === 'HEAD' ? null : response.body, {
        status: response.status,
        headers: {
          'Content-Type': preview.mime,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff'
        }
      })
    } catch {
      return new Response('The document could not be read.', { status: 404 })
    }
  })
  registerHandlers()
  await createWindow()
  app.on('activate', () => {
    if (!window) {
      void createWindow()
    }
  })
})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
