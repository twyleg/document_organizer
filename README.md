# Document Organizer

A local desktop workspace for reviewing scanned documents, built with Electron, TypeScript, Vue 3, Vite, and Bootstrap.

## Run

Requires Node.js 22.12+ and npm, plus a graphical desktop for Electron.

```sh
npm install
npm run dev
```

## First version

The workspace keeps three views in one window:

1. **Input documents**: choose the directory where new scans arrive, select a file, filter by filename, and refresh after adding scans. Files are sorted by name and show their size and modification date. With focus in the file list, use **Up/Down** to select the previous/next visible file and update its preview. The selected row stays in view; **Tab** (or Shift+Tab) switches between the input and archive columns, restoring the last archive entry. **Shift+Right** switches from input to archive; **Shift+Left** switches back to input. From the input column, **Ctrl+Shift+Right** moves the selected file to the selected archive folder and returns focus to the next input file. These shortcuts leave text fields and the rename dialog alone; unsaved PDF edits must be saved or discarded before moving.
2. **Archive**: choose your archive root and expand folders to explore your existing filing structure, including archived files. Contents are read on demand, including linked folders, with folders sorted before files. Select a folder to see its full path below the tree. Each folder has a **Move** button on the right that moves the selected input document into that folder using its current filename. You can also drag any input file onto a folder row, including the archive root. The destination highlights while you hover; dropping moves the dragged file. Expand folders first to reach deeper destinations. With focus in the archive tree, **Up/Down** moves between visible folders and files, **Right** expands a folder (or enters its first child when already open), and **Left** collapses it (or returns to its parent when already closed). Folder navigation updates the selected destination and keeps the focused entry in view. Type a folder-name prefix to jump to a visible subdirectory, ignoring case (for example, `ao` selects `AOK`). The matched folder is placed about one-third down the scrollable archive view, where the available scroll range allows, leaving room to see its contents. Letters typed within one second form a prefix; repeated single letters cycle through matching folders. Expand parent folders first to include their subdirectories.
3. **Document preview**: read and edit the selected PDF in a custom viewer with a large current page above a horizontal thumbnail strip, or view a PNG, JPEG, GIF, WebP, or BMP image. Previous/next controls step through the filtered input list. The open button opens the selected file in its default application, including formats without an embedded preview.

Input and archive folder choices are remembered on this computer between sessions. Each view scrolls independently. Refresh the input folder or archive tree to pick up filesystem changes; expanded archive folders remain open when refreshed. After a move, both views refresh and the next matching input document is selected. Inaccessible folders and unavailable files produce readable errors or warnings.

The input list includes files directly in the selected directory, without recursively scanning subfolders. Hidden files and folders (names beginning with a dot) are omitted. Metadata dates are filesystem modification dates, not dates extracted from document content.

Moving never overwrites an existing destination file. A name conflict displays an error and leaves the input document in place. Moves also work across drives. Source symbolic links cannot be moved. If the destination copy succeeds but removing the source fails, both copies are kept and an error explains the outcome. The intended naming convention remains `YYYYMMDD_SENDER-SUBJECT.pdf`, for example `20260301_ADAC-Beitragsrechnung.pdf`, with an archive destination such as `archive/Fahrzeuge/FAHRZEUGNAME/Versicherungen/ADAC/`.

OCR, extracted dates/senders/subjects, and filename and destination suggestions are future steps. Manual filing is available through drag and drop or the folder Move buttons.

In the archive tree, focus a file and press **Ctrl+Shift+Left** to return it to the input folder. The returned file becomes selected in the input list with its preview displayed. Folders are not moved, and existing input files are never overwritten. Save or discard PDF edits before moving files in either direction.

## Renaming documents

Select an input file and press **F2** to open a centered rename dialog. The current filename, including its extension, is prefilled; only the part before the extension is selected so you can type a new name while keeping `.pdf` or the existing extension. Press **Enter** to apply, or **Esc** to cancel.

Renaming stays in the same folder and refuses to overwrite existing files. Invalid names display an error in the dialog. The input list and preview update with the new name, and the renamed file remains selected. Save or discard unsaved PDF edits before renaming.

## PDF page editing

- Select a thumbnail to show that page in the large upper view. Page arrows and zoom controls help with review. Hold **Ctrl** and scroll the mouse wheel over the page to zoom in or out (50–300%); scrolling without Ctrl scrolls the view normally.
- Drag thumbnails to rearrange pages. A blue insertion marker shows where the page will go. The small earlier/later buttons provide a keyboard alternative.
- Rotate the current page left or right in 90-degree steps, or delete it. At least one page must remain.
- **Save** applies the current order, deletions, and rotations to the original PDF. **Discard** reloads the document from disk.

Edits stay in memory until you save. While changes are unsaved, switching documents, refreshing folders, opening the file externally, and moving it are disabled; save or discard to continue. Closing or reloading the window prompts before discarding unsaved edits.

Saving preserves the original PDF page resources instead of turning pages into images. It writes a temporary PDF beside the original and replaces the original only after that file is complete. If another program changed the source PDF, saving is refused; discard and reload to pick up the new version. Password-protected or damaged PDFs cannot be edited. This editor is intended for scanned documents, rather than interactive forms or digitally signed PDFs.

PDF rendering, fonts, character maps, and image decoders are bundled locally; previews work offline.

## Build and verify

```sh
npm test
npm run build
npm start
```

`npm run dev` starts Vite and Electron with renderer hot reload. `npm run build` checks TypeScript and builds to `out/`; `npm start` runs that production build. These commands do not generate an OS installer.

## Structure

- `electron/index.ts`: window lifecycle, validated IPC handlers, and a local document preview protocol.
- `electron/filesystem.ts`: directory reads with bounded concurrency and preview format validation, and moves that refuse to overwrite existing files.
- `electron/pdf.ts`: PDF reads, validated page edits, conflict detection, and atomic saves.
- `electron/preload.ts`: typed API exposed through `contextBridge`.
- `shared/types.ts`: shared API and file metadata types.
- `src/App.vue`: three-column workspace, folder preferences, selection, and preview state.
- `src/components/ArchiveFolder.vue`: recursive folder disclosure with lazy loading and retry.
- `src/components/PdfEditor.vue`: page selection, rotation, deletion, reordering, and save/discard state.
- `src/components/PdfCanvas.vue`: canvas rendering for the current page and thumbnails.
- `src/style.css`: workspace styling over Bootstrap.
- `tests/pdf.test.ts`: saved page order/rotation, resource preservation, invalid edits, and save conflicts.
- `tests/filesystem.test.ts`: directory metadata, symlink/error handling, preview validation, move integrity, and collision protection tests.

The renderer is sandboxed with context isolation and no Node integration. Filesystem access stays in the main process, and IPC checks the calling frame. The preview protocol serves only a selected PDF or supported image through an opaque temporary URL; it does not expose filesystem paths as navigable URLs. Additional windows, top-level page navigation, and permission requests are blocked. Documents are not uploaded to a service.
