# Document Organizer

A local desktop workspace for reviewing scanned documents, built with Electron, TypeScript, Vue 3, Vite, and Bootstrap.

## Run

Requires Node.js 22.12+ and npm, plus a graphical desktop for Electron.

```sh
npm install
npm run dev
```

Development mode watches Electron main/preload code as well as the interface. Main-process changes restart Electron; preload changes reload the window so new `window.files` methods become available. If an already-running window reports that a method is missing after updating the project, fully quit and restart `npm run dev`. Save any pending PDF edits before changing Electron code during development.

## Releases and continuous integration

GitHub Actions runs `npm ci`, all tests, and the production build for every branch push and pull request on Linux and Apple Silicon macOS. The release workflow repeats those checks before packaging a version tag.

Push a tag in the form **`vX.Y.Z`** that matches `package.json` exactly (for example, `v1.0.0` for version `1.0.0`). Prerelease tags such as `v1.1.0-beta.1` are also supported and create GitHub prereleases. Invalid or mismatched tags fail before packaging. To release a new patch version after committing your changes:

```sh
npm version patch
git push origin HEAD
git push origin "v$(node -p "require('./package.json').version")"
```

The workflow builds Linux **x64 AppImage and tar.gz** packages and macOS **Apple Silicon arm64 DMG and ZIP** packages. Both builds must succeed before a GitHub Release is published with all four downloads and `SHA256SUMS.txt`. Publishing uses GitHub's built-in token with `contents: write` only in the publishing job; no personal access token is required. A failed upload leaves a draft, and rerunning the workflow replaces existing assets for the same tag. Builds use [electron-builder](https://www.electron.build/) and native [GitHub-hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).

The macOS application is **ad-hoc signed, without Apple notarization**. macOS may require approval through **System Settings → Privacy & Security → Open Anyway** on first launch. For Developer ID signing and notarization, replace the ad-hoc settings in `electron-builder.yml` and configure the Apple signing credentials following the [electron-builder signing instructions](https://www.electron.build/code-signing). Linux packages currently use Electron's default icon.

To build packages locally on the respective operating system:

```sh
npm ci
npm run package:linux   # Linux x64
npm run package:mac     # macOS Apple Silicon
```

Packages are written to `release/`. They include Electron and the application, including local PDF assets and fonts. **OCRmyPDF, Tesseract, and German/English language data must be installed separately** as described below. On macOS, applications launched from Finder may not inherit Homebrew's command search path; launch from a terminal with Homebrew on `PATH` if OCRmyPDF cannot be found:

```sh
PATH="/opt/homebrew/bin:$PATH" "/Applications/Document Organizer.app/Contents/MacOS/Document Organizer"
```

## First version

The workspace keeps three views in one window:

1. **Input documents**: choose the directory where new scans arrive, select a file, filter by filename, and watch new scans appear automatically. Files are sorted by name and show their size and modification date. With focus in the file list, use **Up/Down** to select the previous/next visible file and update its preview. The selected row stays in view; **Tab** (or Shift+Tab) switches between the input and archive columns, restoring the last archive entry. **Shift+Right** switches from input to archive; **Shift+Left** switches back to input. From the input column, **Ctrl+Shift+Right** moves the selected file to the selected archive folder and returns focus to the next input file. These shortcuts leave text fields and the rename dialog alone; unsaved PDF edits must be saved or discarded before moving.
2. **Archive**: choose your archive root and expand folders to explore your existing filing structure, including archived files. Contents are read on demand, including linked folders, with folders sorted before files. Select a folder to see its full path below the tree. You can also drag any input file onto a folder row, including the archive root. The destination highlights while you hover; dropping moves the dragged file. Expand folders first to reach deeper destinations. With focus in the archive tree, **Up/Down** moves between visible folders and files, **Enter** unfolds a folder, **Right** expands a folder (or enters its first child when already open), and **Left** collapses it (or returns to its parent when already closed). Folder navigation updates the selected destination and keeps the focused entry in view. Type a folder-name prefix to jump to a visible subdirectory, ignoring case (for example, `ao` selects `AOK`). The matched folder is placed about one-third down the scrollable archive view, where the available scroll range allows, leaving room to see its contents. Letters typed within one second form a prefix; repeated single letters cycle through matching folders. Expand parent folders first to include their subdirectories.
3. **Document preview**: read and edit the selected PDF in a custom viewer with a large current page above a horizontal thumbnail strip, or view a PNG, JPEG, GIF, WebP, or BMP image. Previous/next controls step through the filtered input list. The open button opens the selected file in its default application, including formats without an embedded preview.

Click an archive file, or focus it and press **Enter** or **Space**, to inspect it in the document preview. Archived PDFs open in a read-only viewer with page navigation, thumbnails, and zoom. The open-in-default-application button targets the previewed archive file. The input selection and archive destination are retained, so drag-and-drop and the move shortcuts still file the selected input document. Click an input file or switch back to the input column to restore its preview. Unsaved input edits must be saved or discarded before inspecting another document.

Right-click an archive folder to open a context menu with **New folder…**, **Rename…**, and **Delete…**. File menus offer rename and delete. New folders are created inside the clicked folder; the archive root supports folder creation and cannot itself be renamed or deleted. Name dialogs support **Enter** to apply and **Esc** to cancel, and existing names are never overwritten. Delete asks for confirmation and moves the entry (including a folder’s contents) to the system trash; there is no permanent-delete fallback. Linked entries and paths outside the archive cannot be modified. The tree, folder search and recommendations refresh after changes; renamed previews and selected destinations are updated, and deleting a previewed document restores the input preview.

Right-click an input file and choose **Rename simple…** to open a small filename-only dialog without date suggestions or OCR autocomplete. The original name and extension are retained, and the filename stem is selected. **Enter** applies and **Esc** cancels; focus returns to the input file. Input **F2** still opens the assisted rename view.

Focus an archive file or folder and press **F2** to open its simple rename dialog. The archive root cannot be renamed. Drag an archive file onto another archive folder, including the root, to move it within the archive. Folder dragging is not supported. Moves refuse name conflicts, keep the input selection, refresh the tree, and update an open preview of the moved file. Symbolic-link entries cannot be renamed or moved through these actions.

Right-click an input file and choose **Delete…**, or focus its row and press **Delete**, to remove a duplicate scan. Both paths ask for confirmation, with **Cancel** focused initially. Confirmed deletion moves only that file to the system trash; trash errors leave the file in place and keep the dialog open. Transfers, active OCR and unsaved PDF edits block deletion. After deleting, the next visible input file is selected and focused, or the previous file if there is no next one. **Esc** cancels and returns focus to the selected input file. The Delete shortcut does not act while typing in text fields or browsing the archive.

Each input row has a **right-arrow** button inside its highlight. Click it to select that file and open a slim menu next to the arrow with up to five recommended folder paths. Recommendations match the document’s embedded/OCR text and filename against archive folder names; hover over a folder for its full path and matching keywords. Click a suggestion to move the file immediately, or use **Up/Down** and **Enter**. **Esc** closes the menu and returns focus to the input file; clicking outside dismisses it. After moving, focus returns to the next input file. If no suggestions match, use **Ctrl+F** to find a folder and **Ctrl+Shift+Right** to move to the selected destination.

Press **Ctrl+F**, or click **Find folder**, to search the entire archive hierarchy without manually expanding folders first. Search ignores case and accents and accepts multiple path terms (for example, `golf adac`). Use **Up/Down** to choose a result and **Enter** to open and select it in the tree; **Esc** cancels and restores focus. After choosing a result, **Shift+Left** returns to the input column. Folder indexing skips hidden folders and directory symlinks; linked folders remain browsable manually. Refresh the archive to include newly created folders.

Input and archive folder choices are remembered on this computer between sessions. Each view scrolls independently. The input folder updates automatically; refresh the archive tree to pick up filesystem changes; expanded archive folders remain open when refreshed. After a move, both views refresh and the next matching input document is selected. Inaccessible folders and unavailable files produce readable errors or warnings.

Use **Filter filenames…** above the input list to instantly show filenames containing the entered text, ignoring case. Click the clear button or press **Esc** in the field to show all files again. Filtering only changes the displayed list; background OCR continues for all input files.

Filenames and filename inputs use locally bundled **JetBrains Mono**, while the rest of the interface keeps its existing font. The font works offline; its SIL Open Font License is included in `src/assets/fonts/jetbrains-mono/OFL.txt`.

The input list includes files directly in the selected directory, without recursively scanning subfolders. Hidden files and folders (names beginning with a dot) are omitted. Metadata dates are filesystem modification dates, not dates extracted from document content.

Moving never overwrites an existing destination file. A name conflict displays an error and leaves the input document in place. Moves also work across drives. Source symbolic links cannot be moved. If the destination copy succeeds but removing the source fails, both copies are kept and an error explains the outcome. The intended naming convention remains `YYYYMMDD_SENDER-SUBJECT.pdf`, for example `20260301_ADAC-Beitragsrechnung.pdf`, with an archive destination such as `archive/Fahrzeuge/FAHRZEUGNAME/Versicherungen/ADAC/`.

Date prefixes, OCR word completion and destination suggestions assist manual filing through the input-row arrow menu, drag-and-drop and move shortcuts.

In the archive tree, focus a file and press **Ctrl+Shift+Left** to return it to the input folder. The returned file becomes selected in the input list with its preview displayed. Folders are not moved, and existing input files are never overwritten. Save or discard PDF edits before moving files in either direction.

## Automatic OCR

Every input PDF is checked in the background, page by page, for embedded text. The input list shows its status; hover over the status for page coverage or an error explanation. Text may come from OCR or from an originally digital document: its presence does not prove that OCR was previously run or that the text is accurate.

The input folder is checked every second while the application is running. New and changed files appear automatically with **Waiting for transfer…** until their size and modification time stay unchanged for four seconds. PDFs also need a trailing `%%EOF` marker; `.part`, `.partial`, `.filepart`, `.tmp`, and `.upload` files wait until renamed to their final name. Completed transfers enter the text/OCR queue automatically. Polling preserves the current selection, focus, and unsaved PDF edits, and automatic refresh does not repeatedly retry OCR errors.

Filesystem checks cannot prove that an FTP upload has finished if the sender pauses on an already valid PDF. The quiet period and end-marker check avoid typical partial uploads; OCR also checks that the original contents still match before replacing them. For an explicit completion signal, configure the FTP sender to upload under a temporary name and rename the file when finished.

If any page has no embedded text, the application automatically runs local OCRmyPDF with German and English recognition (`deu+eng`). Pages that already contain text are skipped. PDFs with text on every page are left unchanged. Blank pages may still have no text after OCR; the status reports the remaining pages rather than repeatedly processing them. Renaming an unchanged PDF retains its completed OCR status during the session, including pages where no text was recognized. Images and other non-PDF input files are not processed.

OCR runs one document at a time and skips the document currently being edited or renamed. Files still transferring or being checked/processed cannot be edited, renamed, or moved. Other completed files remain available for renaming and moving while OCR continues in the background. Viewing and selecting files remains available. Unsaved PDF edits still need to be saved or discarded before switching or moving the edited document. The result retains its filename and replaces the source only after successful processing, PDF validation, and a check that the source has not changed. Failed OCR keeps the original. Password-protected, damaged, or signed PDFs may be unavailable for OCR; errors appear in their status. Refresh the input folder to retry failures after fixing their cause. The selected PDF preview reloads after OCR.

Install **OCRmyPDF**, **Tesseract**, and the **German and English language data**. Nothing is uploaded to an online OCR service. See the [official installation instructions](https://ocrmypdf.readthedocs.io/en/stable/installation.html).

On Arch Linux, install the system OCR engine and language data, then use the project virtual environment for OCRmyPDF:

```sh
sudo pacman -S --needed tesseract tesseract-data-deu tesseract-data-eng
python3 -m venv .venv-ocr
.venv-ocr/bin/pip install 'ocrmypdf>=16,<18'
```

The application uses `.venv-ocr/bin/ocrmypdf` when present, otherwise `ocrmypdf` on PATH. Set `DOCUMENT_ORGANIZER_OCRMYPDF` to an executable path for another installation. On Debian/Ubuntu, install `ocrmypdf tesseract-ocr-deu tesseract-ocr-eng` with apt instead. Restart the application after changing its PATH.

## Batch OCR for an existing archive

The batch script makes archived PDFs searchable in place. Backups are managed separately. Install dependencies with `npm ci` and install OCRmyPDF with German/English Tesseract data as described above. Close Document Organizer and pause scanner uploads or other archive changes during the batch run.

Start with a read-only inventory:

```sh
npm run archive:ocr -- --archive /path/to/archive --dry-run
```

Run OCR in place:

```sh
npm run archive:ocr -- --archive /path/to/archive
```

Add `--threads 4` to process up to four PDFs concurrently (default: `1`):

```sh
npm run archive:ocr -- --archive /path/to/archive --threads 4
```

Each OCRmyPDF process uses two page workers, so four concurrent PDFs can use up to eight page workers. Choose the count to suit your CPU and available memory.

The script does not create or verify backups. It processes regular PDFs recursively and leaves non-PDF files alone. Symbolic links are skipped.

Each regular PDF is checked page by page. PDFs with text on every page remain unchanged. Other PDFs are processed with OCRmyPDF's `--skip-text` option, so pages already containing text are retained. Successful output replaces the source after PDF/page-count validation and source-change checks; failures keep the source intact. Blank pages can remain without text. Password-protected, damaged or signed documents may fail and are reported individually. Text presence does not prove recognition quality; inspect a representative sample afterward.

Progress and errors are recorded in `ARCHIVE/.document-organizer-ocr-state.json`. Rerun the same command to resume; unchanged completed files, including files with blank pages, are skipped. New or changed PDFs are checked on the next run. Add **`--retry-errors`** to retry unchanged failed files after fixing their cause. Use **`--state /path/to/progress.json`** to store progress elsewhere; its parent directory must exist. Dry-run mode does not create or update progress files. Run only one batch at a time. **Ctrl+C** requests a stop; no new files are started, and active files finish and save their progress. Any failures produce a nonzero exit status.

The script accepts **`--ocrmypdf /absolute/path/to/ocrmypdf`** or the existing `DOCUMENT_ORGANIZER_OCRMYPDF` environment variable for a custom engine. For example, pass `--ocrmypdf /path/to/document_organizer/.venv-ocr/bin/ocrmypdf` when using the project virtual environment.

## Renaming documents

Select an input file and press **F2** to switch the third column from document preview to renaming. Filename controls and date suggestions appear on the left, with the document preview on the right; the archive remains available to scroll and expand folders while checking past filenames. The input selection stays on the document being renamed. Canceling or completing a rename restores the regular preview and returns focus to the input list. For PDFs with date candidates, the first prefix is inserted automatically with the existing extension (for example, `20260301_.pdf`). With a single candidate, it is accepted automatically and the filename field is focused with the caret before the extension, ready for typing. With multiple candidates, focus starts on the date list: use **Up/Down** to preview another prefix, then **Enter** to confirm it and focus the filename field with the caret before the extension. If no dates are found, or for non-PDF files, the original filename is prefilled and its stem is selected for editing. **Esc** cancels. After renaming, focus returns to the renamed file in the input column so you can immediately move it with **Ctrl+Shift+Right** to the selected archive folder.

For PDFs, the rename view reads the embedded text on every page and lists recommended date prefixes in `YYYYMMDD_` format. Supported formats include `01.03.2026`, `1/3/2026`, `2026-03-01` (including ISO timestamps), `20260301`, and German/English month names such as `1. März 2026` or `March 1st, 2026`. Two-digit years use 2000–2069 for `00`–`69` and 1970–1999 for `70`–`99`. Invalid or incomplete dates are omitted; repeated dates produce one prefix.

Selecting a recommendation prepends the date or replaces an existing eight-digit date prefix, while keeping the rest of the filename and its extension. After confirming a date, type the sender and subject before the extension. Returning to the date list later replaces the prefix while keeping your edited filename stem. The PDF preview to the right of the filename controls shows the document being renamed. Colored rectangles around the suggestions match rectangles over the exact date text in the preview. Selecting a suggestion also jumps to its page; page buttons below repeated dates let you inspect each occurrence. Ambiguous interpretations of the same printed date share a color and rectangle. Hovering over a candidate adds a stronger outline and glow to its location, showing the appropriate page without changing the filename. Preview page controls and zoom help inspect the source; Ctrl + mouse wheel centers the document point under the cursor when zooming. Consecutive wheel events keep that point centered throughout the gesture, including pages without dates; page-fit sizing stays stable when scrollbars appear. Each suggestion shows the original date and page; hover for nearby text and other occurrences. Ambiguous slash/dash dates show both valid interpretations, while dotted dates use day/month/year. Suggestions follow their order in the document and do not claim which date is the document date. Manual renaming stays available if text cannot be read or no dates are found.

While editing the filename, autocomplete offers words and short phrases from the PDF text for the segment at the caret. Suggestions appear below the field; use Up/Down to choose, then **Enter** (or **Tab**) to apply, or click an option. Date prefixes, other filename segments, and the extension are kept; phrase spaces become hyphens. Accepting a completion keeps focus and the caret in the filename field, so you can add more text. **Enter** renames the file when the suggestion dropdown is closed. **Esc** dismisses the suggestions first; press it again to cancel renaming. Tab retains normal focus navigation when no completion is available, and Shift+Tab always moves focus backward.

Renaming stays in the same folder and refuses to overwrite existing files. Invalid names display an error in the rename view. The input list and preview update with the new name, and the renamed file remains selected. Save or discard unsaved PDF edits before renaming.

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
