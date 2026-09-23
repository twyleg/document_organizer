# Electron File Browser

A simple local file browser using **Electron, TypeScript, Vue 3, Vite, and Bootstrap 5**.

## Run

Requires Node.js 22.12+ and npm, plus a graphical desktop for Electron. Electron downloads its desktop binary on first launch if it is not already cached.

```sh
npm install
npm run dev
```

## Build and verify

```sh
npm test
npm run build
npm start
```

`npm run dev` starts Vite and Electron with renderer hot reload. `npm run build` checks TypeScript and builds to `out/`; `npm start` runs that production build. These commands do not generate an OS installer.

## Features

- Home, Desktop, Documents, Downloads, Pictures, and filesystem shortcuts.
- Native folder picker and editable absolute path.
- Back, forward, parent folder, and refresh controls.
- Search within the current folder, hidden-file toggle, and sortable name/size/modified columns. Folders stay first.
- Double-click a folder to navigate; double-click a file to open it in its default application. Keyboard users can focus a name and press Enter.
- File sizes, modification times, symbolic-link indicators, and readable errors for inaccessible folders. Unavailable entries are skipped with a warning.

Search is local to the current folder. Hidden files are identified by a leading dot. The browser does not create, delete, or modify files. Opening a file delegates to the OS, so only open files you trust. On Windows, use the path field or folder picker to visit other drives.

## Structure

- `electron/index.ts`: window lifecycle and validated IPC handlers.
- `electron/filesystem.ts`: directory reads with bounded concurrency.
- `electron/preload.ts`: narrow, typed API exposed with `contextBridge`.
- `shared/types.ts`: API and file metadata types shared by both processes.
- `src/App.vue`: browser interface and navigation state.
- `src/style.css`: custom styling over Bootstrap.

The renderer is sandboxed with context isolation and no Node integration. All filesystem access stays in the main process. IPC checks the calling frame; additional windows, page navigation, and permission requests are blocked.
