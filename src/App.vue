<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ArchiveFolder from './components/ArchiveFolder.vue'
import PdfEditor from './components/PdfEditor.vue'
import RenameDialog from './components/RenameDialog.vue'
import FolderSearch from './components/FolderSearch.vue'
import InputThumbnail from './components/InputThumbnail.vue'
import MoveMenu from './components/MoveMenu.vue'
import ArchiveActionDialog from './components/ArchiveActionDialog.vue'
import { useArchiveTargets } from './useArchiveTargets'
import { documentDragType, useFolderDrop } from './folderDrop'
import type { DirectoryListing, FileEntry, StartupDirectories } from '../shared/types'
import { applyTheme } from './theme'
import { matchingPreparation } from './renamePreparation'
import { useInputOcr } from './useInputOcr'

const darkMode = ref(document.documentElement.dataset.theme === 'dark')

function toggleDarkMode() {
  darkMode.value = !darkMode.value
  applyTheme(darkMode.value ? 'dark' : 'light', true)
}

const inbox = ref<DirectoryListing | null>(null)
const archive = ref<DirectoryListing | null>(null)
const archiveExpanded = ref(true)
const inboxLoading = ref(false)
const archiveLoading = ref(false)
const inboxError = ref('')
const archiveError = ref('')
const search = ref('')
const filenameFilter = ref<HTMLInputElement>()
const selectedPath = ref('')
const archivePreview = ref<FileEntry | null>(null)
const inputList = ref<HTMLUListElement>()
const inputPanel = ref<HTMLElement>()
const archiveTree = ref<HTMLElement>()
let lastArchivePath = ''
let archiveTypePrefix = ''
let archiveTypeTime = 0
const destination = ref('')
const treeVersion = ref(0)
const moving = ref(false)
const moveNotice = ref('')
const draggedPath = ref('')
let dragSource: 'input' | 'archive' = 'input'
let dragToken = ''
const preview = ref<{ url: string; kind: 'pdf' | 'image' } | null>(null)
const previewLoading = ref(false)
const previewError = ref('')
const previewRevision = ref(0)
const editorState = ref({ dirty: false, saving: false })
const editorLocked = computed(() => editorState.value.dirty || editorState.value.saving)
const renameEntry = ref<FileEntry | null>(null)
const renaming = ref(false)
const inputDeleteEntry = ref<FileEntry>()
const inputSimpleRenameEntry = ref<FileEntry>()
const inputMenuPath = ref('')
const deleting = ref(false)
const archiveAction = ref<{ entry: FileEntry; action: 'create' | 'rename' | 'delete' }>()
const folderSearchOpen = ref(false)
const moveMenuOpen = ref(false)
const moveMenuAnchor = ref<HTMLElement>()
const moveMenuPath = ref('')
const revealPath = ref('')
const archiveCollapseVersion = ref(0)
let revealRequest = 0
let searchReturnFocus: HTMLElement | null = null
const available = !!window.files
let startup: StartupDirectories = {}
let inboxRequest = 0
let archiveRequest = 0
let previewRequest = 0
let inputPoll: ReturnType<typeof setInterval> | undefined
let pollingInput = false

const files = computed(() =>
  (inbox.value?.entries ?? [])
    .filter((entry) => !entry.isDirectory && !entry.name.startsWith('.'))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
)
const ocr = useInputOcr(
  files,
  computed(() => moving.value || inboxLoading.value || deleting.value),
  computed(() => {
    const paths = new Set<string>()
    if (editorLocked.value || moveMenuOpen.value) {
      paths.add(selectedPath.value)
    }
    if (renameEntry.value) {
      paths.add(renameEntry.value.path)
    }
    if (inputDeleteEntry.value) {
      paths.add(inputDeleteEntry.value.path)
    }
    if (inputSimpleRenameEntry.value) {
      paths.add(inputSimpleRenameEntry.value.path)
    }
    if (inputMenuPath.value) {
      paths.add(inputMenuPath.value)
    }

    return paths
  }),
  (path, data) => {
    const file = files.value.find((entry) => entry.path === path)
    if (file) {
      Object.assign(file, { size: data.size, modified: data.modified, transferPending: false })
    }
    if (!archivePreview.value && selectedPath.value === path) {
      previewRevision.value++
    }
  }
)
const visibleFiles = computed(() =>
  files.value.filter((entry) =>
    entry.name.toLocaleLowerCase().includes(search.value.toLocaleLowerCase())
  )
)
const archiveEntries = computed(() =>
  (archive.value?.entries ?? [])
    .filter((entry) => !entry.name.startsWith('.'))
    .sort(
      (a, b) =>
        Number(b.isDirectory) - Number(a.isDirectory) ||
        a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    )
)
const selected = computed(() => files.value.find((entry) => entry.path === selectedPath.value))
const targets = useArchiveTargets(
  archive,
  treeVersion,
  selected,
  computed(() => {
    const phase = selected.value ? ocr.statuses.value[selected.value.path]?.phase : undefined

    return (
      !!phase &&
      !selected.value?.transferPending &&
      !['checking', 'queued', 'ocr', 'preparing'].includes(phase)
    )
  }),
  ocr.prepared,
  files
)
const textIndexProgressLabel = computed(() => {
  const progress = targets.indexProgress.value
  if (!progress) {
    return 'Loading text index…'
  }
  if (progress.phase === 'scanning') {
    return 'Finding PDFs…'
  }
  if (progress.phase === 'saving') {
    return 'Saving text index…'
  }

  return `${progress.processed} / ${progress.total} PDFs checked`
})
const viewed = computed(() => archivePreview.value ?? selected.value)

function documentBusy(path: string) {
  return (
    ocr.activePath.value === path ||
    !!files.value.find((file) => file.path === path)?.transferPending
  )
}

function canMoveFile(path: string) {
  return (
    !inputDeleteEntry.value &&
    !inputSimpleRenameEntry.value &&
    !inputMenuPath.value &&
    !renameEntry.value &&
    !archiveAction.value &&
    !editorLocked.value &&
    !documentBusy(path) &&
    !moving.value &&
    !inboxLoading.value &&
    !archiveLoading.value
  )
}

const canMove = computed(() => !!selected.value && canMoveFile(selected.value.path))
const canDragArchive = computed(
  () =>
    !!archive.value &&
    canMoveFile(archive.value.path) &&
    !folderSearchOpen.value &&
    !moveMenuOpen.value
)
const canDrop = computed(() => !!draggedPath.value && canMoveFile(draggedPath.value))
const rootDrop = useFolderDrop(
  () => canDrop.value,
  (event) => {
    if (archive.value) {
      dropTo(archive.value.path, event)
    }
  }
)
const selectedIndex = computed(() =>
  visibleFiles.value.findIndex((entry) => entry.path === selectedPath.value)
)
const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })

function message(cause: unknown) {
  return cause instanceof Error
    ? cause.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
    : String(cause)
}

function folderName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

function size(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`
  }

  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 4)
  return `${(bytes / 1024 ** exponent).toFixed(1)} ${['B', 'KB', 'MB', 'GB', 'TB'][exponent]}`
}

function remember(key: string, path: string) {
  if ((key === 'inbox' && startup.input) || (key === 'archive' && startup.archive)) {
    return
  }

  try {
    localStorage.setItem(`document-organizer.${key}`, path)
  } catch {
    /* Folder access works without storage. */
  }
}

async function loadInbox(path: string) {
  const id = ++inboxRequest
  inboxLoading.value = true
  inboxError.value = ''

  try {
    const result = await window.files.listInputDirectory(path)
    if (id !== inboxRequest) {
      return
    }

    const changed = inbox.value?.path !== result.path
    inbox.value = result
    if (changed) {
      search.value = ''
      archivePreview.value = null
    }
    if (changed || !files.value.some((entry) => entry.path === selectedPath.value)) {
      selectedPath.value = visibleFiles.value[0]?.path ?? ''
    }

    remember('inbox', result.path)
    ocr.retryErrors()
  } catch (cause) {
    if (id === inboxRequest) {
      inboxError.value = message(cause)
    }
  } finally {
    if (id === inboxRequest) {
      inboxLoading.value = false
    }
  }
}

async function pollInbox() {
  const path = inbox.value?.path
  if (
    !path ||
    pollingInput ||
    inboxLoading.value ||
    moving.value ||
    renaming.value ||
    deleting.value
  ) {
    return
  }

  const request = inboxRequest
  const stamp = (entry: FileEntry) => `${entry.size}:${entry.modified}:${!!entry.transferPending}`
  const before = new Map(files.value.map((entry) => [entry.path, stamp(entry)]))
  pollingInput = true

  try {
    const result = await window.files.listInputDirectory(path)
    if (
      request !== inboxRequest ||
      path !== inbox.value?.path ||
      moving.value ||
      renaming.value ||
      deleting.value
    ) {
      return
    }

    const existing = new Map(inbox.value.entries.map((entry) => [entry.path, entry]))
    let reloadPreview = false
    result.entries = result.entries.map((entry) => {
      const previous = existing.get(entry.path)
      if (!previous) {
        return entry
      }
      // Keep object identity and edits/focus intact. Ignore an older poll snapshot
      // when an OCR/save callback updated the entry while the read was pending.
      if (before.has(entry.path) && before.get(entry.path) !== stamp(previous)) {
        return previous
      }
      if (
        stamp(previous) !== stamp(entry) &&
        viewed.value?.path === entry.path &&
        !entry.transferPending &&
        !editorLocked.value &&
        ocr.activePath.value !== entry.path
      ) {
        reloadPreview = true
      }

      Object.assign(previous, entry)
      return previous
    })
    inbox.value = result
    if (inboxError.value.startsWith('Automatic input refresh failed:')) {
      inboxError.value = ''
    }
    if (!files.value.some((entry) => entry.path === selectedPath.value) && !editorLocked.value) {
      selectedPath.value = visibleFiles.value[0]?.path ?? ''
    }
    if (reloadPreview) {
      previewRevision.value++
    }
  } catch (cause) {
    if (request === inboxRequest) {
      inboxError.value = `Automatic input refresh failed: ${message(cause)}`
    }
  } finally {
    pollingInput = false
  }
}

async function loadArchive(path: string) {
  const id = ++archiveRequest
  archiveLoading.value = true
  archiveError.value = ''

  try {
    const result = await window.files.listDirectory(path)
    if (id !== archiveRequest) {
      return
    }
    if (archive.value?.path !== result.path) {
      destination.value = result.path
      archiveExpanded.value = true
      archivePreview.value = null
    }

    archive.value = result
    treeVersion.value++
    remember('archive', result.path)
  } catch (cause) {
    if (id === archiveRequest) {
      archiveError.value = message(cause)
    }
  } finally {
    if (id === archiveRequest) {
      archiveLoading.value = false
    }
  }
}

async function choose(kind: 'inbox' | 'archive') {
  if (editorLocked.value) {
    return
  }

  try {
    const path = await window.files.chooseDirectory()
    if (path) {
      await (kind === 'inbox' ? loadInbox(path) : loadArchive(path))
    }
  } catch (cause) {
    ;(kind === 'inbox' ? inboxError : archiveError).value = message(cause)
  }
}

function startDrag(event: DragEvent, path: string) {
  if (!canMoveFile(path) || !event.dataTransfer) {
    event.preventDefault()
    return
  }

  archivePreview.value = null
  selectedPath.value = path
  dragSource = 'input'
  draggedPath.value = path
  dragToken = crypto.randomUUID()
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData(documentDragType, dragToken)
}

function endDrag() {
  draggedPath.value = ''
  dragToken = ''
}

function dropTo(folder: string, event: DragEvent) {
  if (!canDrop.value || !dragToken || event.dataTransfer?.getData(documentDragType) !== dragToken) {
    return
  }

  const source = draggedPath.value
  const fromArchive = dragSource === 'archive'
  endDrag()
  if (fromArchive) {
    void moveWithinArchive(folder, source)
  } else {
    void moveTo(folder, source)
  }
}

function startArchiveDrag(entry: FileEntry, event: DragEvent) {
  if (!canDragArchive.value || entry.isDirectory || entry.isSymbolicLink || !event.dataTransfer) {
    event.preventDefault()
    return
  }

  dragSource = 'archive'
  lastArchivePath = entry.path
  draggedPath.value = entry.path
  dragToken = crypto.randomUUID()
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData(documentDragType, dragToken)
}

async function moveWithinArchive(folder: string, source: string) {
  const root = archive.value?.path
  if (!root || !canDragArchive.value) {
    return
  }

  moving.value = true
  archiveError.value = ''
  moveNotice.value = ''
  await nextTick()
  let movedPath = ''
  let moveError = ''

  try {
    const path = await window.files.moveArchiveFile(root, source, folder)
    movedPath = path
    if (archivePreview.value?.path === source) {
      archivePreview.value = { ...archivePreview.value, path }
    }

    lastArchivePath = path
    destination.value = folder
    moveNotice.value = `Moved ${folderName(source)} to ${folder}`
  } catch (cause) {
    moveError = message(cause)
  } finally {
    await loadArchive(root)
    if (moveError) {
      archiveError.value = moveError
    }

    moving.value = false
    if (movedPath) {
      await openTarget(folder, true)
      lastArchivePath = movedPath

      // Destination contents are loaded lazily after its folder becomes visible.
      for (let attempt = 0; attempt < 100; attempt++) {
        await nextTick()
        const row = Array.from(
          archiveTree.value?.querySelectorAll<HTMLElement>('[data-archive-entry="file"]') ?? []
        ).find((row) => row.title === movedPath)
        if (row) {
          focusEntry(row)
          break
        }

        await new Promise((resolve) => setTimeout(resolve, 30))
      }
    } else {
      focusArchive()
    }
  }
}

function simpleArchiveRename(entry: FileEntry) {
  if (!canDragArchive.value || inputMenuPath.value || entry.isSymbolicLink) {
    return
  }

  lastArchivePath = entry.path
  archiveAction.value = { entry, action: 'rename' }
}

async function moveTo(folder: string, sourcePath = selectedPath.value) {
  const source = files.value.find((entry) => entry.path === sourcePath)
  const inputPath = inbox.value?.path
  const archivePath = archive.value?.path
  if (!source || !canMoveFile(source.path) || !inputPath || !archivePath) {
    return
  }

  moving.value = true
  moveNotice.value = ''
  archiveError.value = ''
  previewRequest++
  preview.value = null
  previewLoading.value = false
  await nextTick()
  let moveError = ''

  try {
    const target = await window.files.moveFile(source.path, folder)
    destination.value = folder
    moveNotice.value = `Moved ${source.name} to ${target}`
  } catch (cause) {
    moveError = message(cause)
  } finally {
    await Promise.all([loadInbox(inputPath), loadArchive(archivePath)])
    if (moveError) {
      archiveError.value = moveError
    }

    archivePreview.value = null
    moving.value = false
  }
}

async function openOriginal() {
  if (!viewed.value || editorLocked.value || documentBusy(viewed.value.path)) {
    return
  }

  try {
    await window.files.openFile(viewed.value.path)
  } catch (cause) {
    previewError.value = message(cause)
  }
}

function step(offset: number) {
  if (editorLocked.value) {
    return
  }

  const entry = visibleFiles.value[selectedIndex.value + offset]
  if (entry) {
    archivePreview.value = null
    selectedPath.value = entry.path
  }
}

function selectDocument(path: string) {
  if (!renameEntry.value && !editorLocked.value && !moving.value) {
    archivePreview.value = null
    selectedPath.value = path
  }
}

function previewArchive(entry: FileEntry) {
  if (!editorLocked.value && !moving.value && !renameEntry.value) {
    archivePreview.value = entry
  }
}

function canDeleteInput(entry: FileEntry) {
  return (
    !!inbox.value &&
    !entry.isSymbolicLink &&
    !documentBusy(entry.path) &&
    !editorLocked.value &&
    !moving.value &&
    !inboxLoading.value &&
    !renameEntry.value &&
    !archiveAction.value &&
    !inputDeleteEntry.value &&
    !inputSimpleRenameEntry.value &&
    !folderSearchOpen.value &&
    !moveMenuOpen.value
  )
}

function requestInputDelete(entry: FileEntry) {
  if (!canDeleteInput(entry)) {
    return
  }

  selectDocument(entry.path)
  inputDeleteEntry.value = entry
}

async function inputContext(entry: FileEntry) {
  if (inputMenuPath.value || !canDeleteInput(entry) || !inbox.value) {
    return
  }

  inputMenuPath.value = entry.path
  selectDocument(entry.path)

  try {
    const action = await window.files.inputContextMenu(inbox.value.path, entry.path)
    if (action === 'delete') {
      requestInputDelete(entry)
    } else if (action === 'rename' && canDeleteInput(entry)) {
      inputSimpleRenameEntry.value = entry
    }
  } catch (cause) {
    inboxError.value = message(cause)
  } finally {
    inputMenuPath.value = ''
    await nextTick()
    if (!inputDeleteEntry.value && !inputSimpleRenameEntry.value) {
      focusInput()
    }
  }
}

async function cancelInputDelete() {
  inputDeleteEntry.value = undefined
  await nextTick()
  focusInput()
}

async function inputDeleted(path: string) {
  const index = visibleFiles.value.findIndex((entry) => entry.path === path)
  selectedPath.value =
    visibleFiles.value[index + 1]?.path ?? visibleFiles.value[index - 1]?.path ?? ''
  archivePreview.value = null
  if (inbox.value) {
    await loadInbox(inbox.value.path)
  }

  inputDeleteEntry.value = undefined
  await nextTick()
  focusInput()
}

async function archiveContext(entry: FileEntry) {
  if (
    !archive.value ||
    renameEntry.value ||
    editorLocked.value ||
    moving.value ||
    archiveLoading.value ||
    archiveAction.value ||
    inputDeleteEntry.value ||
    inputSimpleRenameEntry.value ||
    inputMenuPath.value
  ) {
    return
  }

  lastArchivePath = entry.path
  if (entry.isDirectory) {
    destination.value = entry.path
  }

  focusArchive()

  try {
    const action = await window.files.archiveContextMenu(archive.value.path, entry.path)
    if (action) {
      archiveAction.value = { entry, action }
    }
  } catch (cause) {
    archiveError.value = message(cause)
  }
}

function archiveRootContext() {
  if (archive.value) {
    void archiveContext({
      name: folderName(archive.value.path),
      path: archive.value.path,
      isDirectory: true,
      isSymbolicLink: false,
      size: 0,
      modified: 0
    })
  }
}

async function cancelArchiveAction() {
  archiveAction.value = undefined
  await nextTick()
  focusArchive()
}

async function archiveActionDone(path: string) {
  const operation = archiveAction.value
  const root = archive.value?.path
  if (!operation || !root) {
    return
  }

  const old = operation.entry.path
  const contains = (value: string) =>
    value === old || value.startsWith(old + '/') || value.startsWith(old + '\\')
  if (operation.action === 'rename') {
    if (contains(destination.value)) {
      destination.value = path + destination.value.slice(old.length)
    }
    if (contains(lastArchivePath)) {
      lastArchivePath = path + lastArchivePath.slice(old.length)
    }
    if (archivePreview.value && contains(archivePreview.value.path)) {
      const updatedPath = path + archivePreview.value.path.slice(old.length)
      archivePreview.value = {
        ...archivePreview.value,
        path: updatedPath,
        name: folderName(updatedPath)
      }
    }
  } else if (operation.action === 'delete') {
    if (contains(destination.value)) {
      destination.value = root
    }
    if (archivePreview.value && contains(archivePreview.value.path)) {
      archivePreview.value = null
    }

    lastArchivePath = destination.value
  }

  archiveAction.value = undefined
  await loadArchive(root)
  if (
    operation.action === 'create' ||
    (operation.action === 'rename' && operation.entry.isDirectory)
  ) {
    await openTarget(path, true)
  } else {
    const parent = path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))) || root
    await openTarget(operation.action === 'delete' ? destination.value : parent, true)
    if (operation.action === 'rename') {
      lastArchivePath = path
      focusArchive()
    }
  }
}

function focusEntry(entry?: HTMLElement | null) {
  entry?.focus({ preventScroll: true })
  entry?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

function focusInput() {
  if (!editorLocked.value) {
    archivePreview.value = null
  }

  const list = inputList.value
  focusEntry(
    list?.querySelector<HTMLButtonElement>('.document-row[aria-pressed="true"]:not(:disabled)') ??
      list?.querySelector<HTMLButtonElement>('.document-row:not(:disabled)') ??
      inputPanel.value
  )
}

function folderSearchShortcut(event: KeyboardEvent) {
  if (
    !event.ctrlKey ||
    event.key.toLowerCase() !== 'f' ||
    event.altKey ||
    event.shiftKey ||
    renameEntry.value ||
    archiveAction.value ||
    inputDeleteEntry.value ||
    inputSimpleRenameEntry.value ||
    inputMenuPath.value
  ) {
    return
  }

  event.preventDefault()
  showFolderSearch()
}

function showFolderSearch() {
  if (!archive.value || folderSearchOpen.value) {
    return
  }

  moveMenuOpen.value = false
  searchReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  folderSearchOpen.value = true
}

function showMoveMenu(path: string, event: MouseEvent) {
  if (!canMoveFile(path) || !archive.value || !(event.currentTarget instanceof HTMLElement)) {
    return
  }
  if (moveMenuOpen.value && moveMenuPath.value === path) {
    void cancelMoveMenu(true)
    return
  }

  selectDocument(path)
  moveMenuAnchor.value = event.currentTarget
  moveMenuPath.value = path
  moveMenuOpen.value = true
}

async function inspectSuggestedDestination(entry: FileEntry) {
  const top = targets.topDestination(entry)
  if (!top || !archive.value || archiveLoading.value || !canMoveFile(entry.path)) {
    return
  }

  moveMenuOpen.value = false
  selectDocument(entry.path)
  await openTarget(top.path, true, true)
}

async function moveToTopSuggestion(entry: FileEntry) {
  const top = targets.topDestination(entry)
  if (!top || !canMoveFile(entry.path)) {
    return
  }

  moveMenuOpen.value = false
  selectDocument(entry.path)
  await moveTo(top.path, entry.path)
  await nextTick()
  focusInput()
}

async function cancelMoveMenu(restoreFocus = true) {
  moveMenuOpen.value = false
  if (!restoreFocus) {
    return
  }

  await nextTick()
  focusInput()
}

async function moveFromMenu(path: string) {
  const source = moveMenuPath.value
  moveMenuOpen.value = false
  await moveTo(path, source)
  await nextTick()
  focusInput()
}

async function cancelFolderSearch() {
  folderSearchOpen.value = false
  await nextTick()
  if (searchReturnFocus?.isConnected) {
    searchReturnFocus.focus({ preventScroll: true })
  } else {
    focusInput()
  }
}

async function openTarget(path: string, fromSearch = false, collapseOthers = false) {
  const id = ++revealRequest
  folderSearchOpen.value = false
  destination.value = path
  lastArchivePath = path
  archiveExpanded.value = true
  revealPath.value = ''
  if (collapseOthers) {
    archiveCollapseVersion.value++
  }

  await nextTick()
  revealPath.value = path

  // Ancestors load lazily; wait for the selected row before placing it in view.
  for (let attempt = 0; attempt < 100 && id === revealRequest; attempt++) {
    await nextTick()
    const tree = archiveTree.value
    const row = Array.from(
      tree?.querySelectorAll<HTMLElement>('[data-archive-entry="folder"]') ?? []
    ).find((entry) => entry.title === path)
    if (row && tree) {
      tree.scrollTop +=
        row.getBoundingClientRect().top -
        tree.getBoundingClientRect().top -
        tree.clientTop -
        tree.clientHeight / 3
      if (fromSearch) {
        row.focus({ preventScroll: true })
      } else {
        focusInput()
      }

      return
    }

    await new Promise((resolve) => setTimeout(resolve, 30))
  }
  if (id === revealRequest) {
    if (fromSearch) {
      focusArchive()
    } else {
      focusInput()
    }
  }
}

function rememberArchiveFocus(event: FocusEvent) {
  const target = event.target instanceof Element ? event.target : null
  const row = target?.closest('.tree-row, .tree-root-row, .tree-file')
  const entry = row?.matches('[data-archive-entry]')
    ? row
    : row?.querySelector('[data-archive-entry]')
  if (entry) {
    lastArchivePath = entry.getAttribute('title') ?? ''
  }
}

function focusArchive() {
  const tree = archiveTree.value
  const previous = Array.from(
    tree?.querySelectorAll<HTMLElement>('[data-archive-entry]') ?? []
  ).find((entry) => entry.getAttribute('title') === lastArchivePath)
  focusEntry(
    previous ??
      tree?.querySelector<HTMLElement>('[data-archive-entry][aria-pressed="true"]') ??
      tree?.querySelector<HTMLElement>('[data-archive-entry]') ??
      tree
  )
}

async function columnShortcut(event: KeyboardEvent) {
  if (
    event.altKey ||
    event.metaKey ||
    renameEntry.value ||
    archiveAction.value ||
    inputDeleteEntry.value ||
    inputSimpleRenameEntry.value ||
    inputMenuPath.value
  ) {
    return
  }

  const target = event.target instanceof Element ? event.target : null
  if (target?.closest('input, textarea, select, [contenteditable="true"]')) {
    return
  }

  const column = target?.closest('.inbox-panel, .archive-panel')
  if (!column) {
    return
  }

  const inInput = column.classList.contains('inbox-panel')
  if (
    !event.ctrlKey &&
    (event.key === 'Tab' ||
      (event.shiftKey &&
        ((event.key === 'ArrowRight' && inInput) || (event.key === 'ArrowLeft' && !inInput))))
  ) {
    event.preventDefault()
    archiveTypePrefix = ''
    if (inInput) {
      focusArchive()
    } else {
      focusInput()
    }
  } else if (event.key === 'ArrowRight' && event.ctrlKey && event.shiftKey && inInput) {
    event.preventDefault()
    if (event.repeat || !canMove.value || !destination.value) {
      return
    }

    await moveTo(destination.value)
    await nextTick()
    focusInput()
  } else if (event.key === 'ArrowLeft' && event.ctrlKey && event.shiftKey && !inInput) {
    event.preventDefault()
    if (
      event.repeat ||
      moving.value ||
      editorLocked.value ||
      inboxLoading.value ||
      archiveLoading.value
    ) {
      return
    }

    const entry = target?.closest<HTMLElement>('[data-archive-entry="file"]')
    const source = entry?.getAttribute('title')
    const inputPath = inbox.value?.path
    const archivePath = archive.value?.path
    if (!source || !inputPath || !archivePath) {
      return
    }

    moving.value = true
    moveNotice.value = ''
    archiveError.value = ''
    let moveError = ''

    try {
      const path = await window.files.moveFile(source, inputPath)
      search.value = ''
      archivePreview.value = null
      selectedPath.value = path
      moveNotice.value = `Returned ${entry?.textContent?.trim()} to ${inputPath}`
    } catch (cause) {
      moveError = message(cause)
    } finally {
      await Promise.all([loadInbox(inputPath), loadArchive(archivePath)])
      if (moveError) {
        archiveError.value = moveError
      }

      moving.value = false
      await nextTick()
      if (moveError) {
        focusArchive()
      } else {
        focusInput()
      }
    }
  }
}

async function navigateInput(event: KeyboardEvent) {
  if (
    event.key === 'Delete' &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey &&
    !event.shiftKey &&
    !event.isComposing
  ) {
    event.preventDefault()
    const row =
      event.target instanceof Element
        ? event.target.closest('.input-file-row')?.querySelector('.document-row')
        : null
    const entry = row
      ? visibleFiles.value.find((file) => file.name === row.getAttribute('title'))
      : selected.value
    if (!event.repeat && entry) {
      requestInputDelete(entry)
    }

    return
  }
  if (
    !['ArrowUp', 'ArrowDown'].includes(event.key) ||
    event.ctrlKey ||
    event.altKey ||
    event.metaKey ||
    event.shiftKey
  ) {
    return
  }

  event.preventDefault()
  if (
    editorLocked.value ||
    moving.value ||
    inboxLoading.value ||
    renameEntry.value ||
    inputDeleteEntry.value ||
    inputSimpleRenameEntry.value ||
    inputMenuPath.value ||
    !visibleFiles.value.length
  ) {
    return
  }

  const focused =
    event.target instanceof Element
      ? event.target.closest('.input-file-row')?.querySelector('.document-row')
      : null
  const focusedIndex =
    focused && inputList.value
      ? Array.from(inputList.value.querySelectorAll('.document-row')).indexOf(focused)
      : -1
  const start = focusedIndex >= 0 ? focusedIndex : selectedIndex.value
  const index =
    start < 0
      ? 0
      : Math.max(
          0,
          Math.min(visibleFiles.value.length - 1, start + (event.key === 'ArrowDown' ? 1 : -1))
        )
  archivePreview.value = null
  selectedPath.value = visibleFiles.value[index]!.path
  await nextTick()
  const row = inputList.value?.querySelector<HTMLButtonElement>(
    '.document-row[aria-pressed="true"]'
  )
  row?.focus({ preventScroll: true })
  row?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

function navigateArchive(event: KeyboardEvent) {
  if (event.ctrlKey || event.altKey || event.metaKey || event.isComposing) {
    return
  }
  if (/^[\p{L}\p{N}]$/u.test(event.key)) {
    event.preventDefault()
    const tree = event.currentTarget as HTMLElement
    const now = Date.now()
    const letter = event.key.toLocaleLowerCase()
    archiveTypePrefix = now - archiveTypeTime > 1000 ? letter : archiveTypePrefix + letter
    archiveTypeTime = now
    const folders = Array.from(
      tree.querySelectorAll<HTMLElement>('.tree-name[data-archive-entry="folder"]')
    )
    const current =
      event.target instanceof Element ? event.target.closest('[data-archive-entry]') : null
    const index = folders.indexOf(current as HTMLElement)
    const repeated = Array.from(archiveTypePrefix).every((character) => character === letter)
    const prefix = repeated ? letter : archiveTypePrefix
    if (repeated) {
      archiveTypePrefix = letter
    }

    const start = prefix.length === 1 ? index + 1 : Math.max(0, index)
    const ordered = [...folders.slice(start), ...folders.slice(0, start)]
    const match = ordered.find((folder) =>
      folder.textContent?.trim().toLocaleLowerCase().startsWith(prefix)
    )
    if (match) {
      match.click()
      match.focus({ preventScroll: true })
      tree.scrollTop +=
        match.getBoundingClientRect().top -
        tree.getBoundingClientRect().top -
        tree.clientTop -
        tree.clientHeight / 3
    }

    return
  }
  if (
    !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(event.key) ||
    event.ctrlKey ||
    event.altKey ||
    event.metaKey ||
    event.shiftKey
  ) {
    return
  }

  archiveTypePrefix = ''
  const tree = event.currentTarget as HTMLElement
  const target = event.target instanceof Element ? event.target : null
  if ((event.key === 'Enter' || event.key === ' ') && target?.closest('.tree-toggle')) {
    return
  }

  const row = target?.closest('.tree-row, .tree-root-row, .tree-file')
  const entry = row?.matches('[data-archive-entry]')
    ? (row as HTMLElement)
    : row?.querySelector<HTMLElement>('[data-archive-entry]')
  if (!entry || !tree.contains(entry)) {
    return
  }

  event.preventDefault()
  if (event.key === 'Enter' || event.key === ' ') {
    if (event.repeat) {
      return
    }
    if (entry.dataset.archiveEntry === 'file') {
      entry.click()
    } else {
      const toggle = row?.querySelector<HTMLButtonElement>('.tree-toggle')
      if (event.key === 'Enter' && toggle?.getAttribute('aria-expanded') === 'false') {
        toggle.click()
      }

      entry.click()
    }

    return
  }

  const entries = Array.from(tree.querySelectorAll<HTMLElement>('[data-archive-entry]'))
  let next: HTMLElement | null | undefined = entry
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    const index = entries.indexOf(entry)
    next =
      entries[
        Math.max(0, Math.min(entries.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))
      ]
  } else {
    const toggle = row?.querySelector<HTMLButtonElement>('.tree-toggle')
    const expanded = toggle?.getAttribute('aria-expanded') === 'true'
    if (event.key === 'ArrowRight') {
      if (toggle && !expanded) {
        toggle.click()
      } else if (expanded) {
        next = entry.classList.contains('tree-root')
          ? tree.querySelector<HTMLElement>(':scope > .folder-list [data-archive-entry]')
          : entry
              .closest('.folder-node')
              ?.querySelector<HTMLElement>('.tree-children [data-archive-entry]')
      }
    } else if (toggle && expanded) {
      toggle.click()
    } else {
      next =
        entry
          .closest('.folder-node')
          ?.parentElement?.closest('.folder-node')
          ?.querySelector<HTMLElement>(':scope > .tree-row [data-archive-entry]') ??
        tree.querySelector<HTMLElement>('.tree-root[data-archive-entry]')
    }
  }
  if (!next) {
    return
  }
  if (next.dataset.archiveEntry === 'folder') {
    next.click()
  }

  next.focus({ preventScroll: true })
  next.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

function pdfSaved(metadata: { size: number; modified: number }) {
  if (selected.value) {
    Object.assign(selected.value, metadata)
  }
}

function renameShortcut(event: KeyboardEvent) {
  if (event.key !== 'F2') {
    return
  }
  if (event.target instanceof Element && event.target.closest('.archive-panel')) {
    return
  }

  event.preventDefault()
  if (
    event.repeat ||
    renameEntry.value ||
    folderSearchOpen.value ||
    moveMenuOpen.value ||
    archiveAction.value ||
    inputDeleteEntry.value ||
    inputSimpleRenameEntry.value ||
    inputMenuPath.value ||
    moving.value ||
    inboxLoading.value ||
    archiveLoading.value ||
    archivePreview.value ||
    !selected.value
  ) {
    return
  }
  if (documentBusy(selected.value.path)) {
    inboxError.value =
      'Wait for this document’s transfer, OCR, or rename preparation to finish before renaming it.'
    return
  }
  if (editorLocked.value) {
    inboxError.value = 'Save or discard your PDF edits before renaming this document.'
    return
  }

  inboxError.value = ''
  renameEntry.value = selected.value
}

async function cancelRename() {
  renameEntry.value = null
  inputSimpleRenameEntry.value = undefined
  await nextTick()
  focusInput()
}

async function renamed(path: string) {
  const entry = renameEntry.value ?? inputSimpleRenameEntry.value
  if (entry) {
    await ocr.carryRename(entry, path)
  }

  search.value = ''
  selectedPath.value = path
  await Promise.all([
    inbox.value ? loadInbox(inbox.value.path) : undefined,
    archive.value ? loadArchive(archive.value.path) : undefined
  ])
  renameEntry.value = null
  inputSimpleRenameEntry.value = undefined
  await nextTick()
  focusInput()
}

watch(
  () => (moving.value ? undefined : viewed.value),
  async (entry) => {
    const id = ++previewRequest
    preview.value = null
    previewError.value = ''
    previewLoading.value = !!entry
    if (!entry) {
      return
    }

    try {
      const result = await window.files.previewFile(entry.path)
      if (id === previewRequest) {
        preview.value = result
      }
    } catch (cause) {
      if (id === previewRequest) {
        previewError.value = message(cause)
      }
    } finally {
      if (id === previewRequest) {
        previewLoading.value = false
      }
    }
  }
)

onMounted(async () => {
  window.addEventListener('keydown', renameShortcut)
  window.addEventListener('keydown', folderSearchShortcut)
  inputPoll = setInterval(() => {
    void pollInbox()
  }, 1000)
  if (!available) {
    inboxError.value = 'Launch with npm run dev to access your local documents in Electron.'
    return
  }

  try {
    startup = await window.files.startupDirectories()
  } catch (cause) {
    inboxError.value = archiveError.value = message(cause)
    return
  }

  let savedInbox: string | null = null
  let savedArchive: string | null = null

  try {
    savedInbox = localStorage.getItem('document-organizer.inbox')
    savedArchive = localStorage.getItem('document-organizer.archive')
  } catch {
    /* Folder pickers work when preferences cannot be read. */
  }

  const inputPath = startup.input ?? savedInbox
  const archivePath = startup.archive ?? savedArchive
  await Promise.all([
    inputPath ? loadInbox(inputPath) : undefined,
    archivePath ? loadArchive(archivePath) : undefined
  ])
})

onBeforeUnmount(() => {
  revealRequest++
  if (inputPoll) {
    clearInterval(inputPoll)
  }

  inboxRequest++
  window.removeEventListener('keydown', renameShortcut)
  window.removeEventListener('keydown', folderSearchShortcut)
})

function clearFilenameFilter() {
  search.value = ''
  filenameFilter.value?.focus()
}
</script>

<template>
  <div class="organizer">
    <FolderSearch
      v-if="folderSearchOpen"
      :folders="targets.folders.value"
      :loading="targets.loading.value"
      :error="targets.error.value"
      @cancel="cancelFolderSearch"
      @select="openTarget($event, true)"
    />
    <MoveMenu
      v-if="moveMenuOpen && selected && moveMenuAnchor"
      :key="moveMenuPath"
      :anchor="moveMenuAnchor"
      :filename="selected.name"
      :recommendations="targets.recommendations.value"
      :loading="targets.loading.value || targets.textLoading.value || targets.matchingLoading.value"
      @cancel="cancelMoveMenu"
      @move="moveFromMenu"
    />
    <ArchiveActionDialog
      v-if="inputSimpleRenameEntry && inbox"
      :root="inbox.path"
      :entry="inputSimpleRenameEntry"
      action="rename"
      scope="input"
      @cancel="cancelRename"
      @done="renamed"
      @busy="renaming = $event"
    />
    <ArchiveActionDialog
      v-if="inputDeleteEntry && inbox"
      :root="inbox.path"
      :entry="inputDeleteEntry"
      action="delete"
      scope="input"
      @cancel="cancelInputDelete"
      @done="inputDeleted"
      @busy="deleting = $event"
    />
    <ArchiveActionDialog
      v-if="archiveAction && archive"
      :root="archive.path"
      :entry="archiveAction.entry"
      :action="archiveAction.action"
      @cancel="cancelArchiveAction"
      @done="archiveActionDone"
    />
    <header class="app-header">
      <div class="brand">
        <span class="brand-icon"
          ><i
            class="bi bi-files"
            aria-hidden="true"
        /></span>
        <div><h1>Document Organizer</h1></div>
      </div>
      <button
        type="button"
        class="theme-toggle"
        role="switch"
        :aria-checked="darkMode"
        aria-label="Dark mode"
        :title="darkMode ? 'Switch to light mode' : 'Switch to dark mode'"
        @click="toggleDarkMode"
      >
        <i
          class="bi bi-moon-stars"
          aria-hidden="true"
        /><span>Dark mode</span
        ><span
          class="theme-switch-track"
          aria-hidden="true"
          ><span class="theme-switch-thumb"
        /></span>
      </button>
    </header>
    <main
      class="workspace"
      @keydown="columnShortcut"
    >
      <section
        ref="inputPanel"
        class="panel inbox-panel"
        tabindex="-1"
        aria-labelledby="inbox-title"
      >
        <div class="column-header">
          <header class="panel-heading">
            <div class="heading-label">
              <span class="step-number">1</span>
              <h2 id="inbox-title">Input documents</h2>
              <span class="count">{{ files.length }}</span>
            </div>
            <p>Select a scan to review.</p>
          </header>
          <div class="folder-controls">
            <button
              class="choose-folder"
              :disabled="
                !!inputMenuPath ||
                !!inputDeleteEntry ||
                !!renameEntry ||
                editorLocked ||
                moving ||
                inboxLoading ||
                !available
              "
              @click="choose('inbox')"
            >
              <i
                class="bi bi-folder2-open"
                aria-hidden="true"
              />{{ inbox ? 'Change input folder' : 'Choose input folder' }}
            </button>
            <button
              class="icon-button"
              title="Refresh input folder"
              aria-label="Refresh input folder"
              :disabled="editorLocked || moving || !inbox || inboxLoading"
              @click="inbox && loadInbox(inbox.path)"
            >
              <i
                class="bi bi-arrow-clockwise"
                aria-hidden="true"
              />
            </button>
          </div>
          <p
            class="folder-path"
            :title="inbox?.path"
          >
            {{ inbox?.path || 'No input folder selected' }}
          </p>
          <div class="search-box filename-filter">
            <i
              class="bi bi-search"
              aria-hidden="true"
            />
            <input
              ref="filenameFilter"
              v-model="search"
              :disabled="!inbox"
              type="search"
              placeholder="Filter filenames…"
              aria-label="Filter input files by filename"
              @keydown.esc.prevent.stop="search = ''"
            />
            <button
              v-if="search"
              class="filter-clear"
              type="button"
              aria-label="Clear filename filter"
              title="Clear filter (Esc)"
              @click="clearFilenameFilter"
            >
              <i
                class="bi bi-x-lg"
                aria-hidden="true"
              />
            </button>
          </div>
        </div>
        <div
          class="panel-content"
          :aria-busy="inboxLoading"
        >
          <div
            v-if="inboxLoading"
            class="empty-state"
            role="status"
          >
            <span class="spinner-border spinner-border-sm" />
            <p>Reading input folder…</p>
          </div>
          <ul
            v-else-if="visibleFiles.length"
            ref="inputList"
            class="document-list"
            aria-label="Input files"
            @keydown="navigateInput"
          >
            <li
              v-for="(entry, index) in visibleFiles"
              :key="entry.path"
              class="input-file-row"
              @contextmenu.prevent.stop="inputContext(entry)"
              :class="{
                selected: entry.path === selectedPath,
                dragging: entry.path === draggedPath
              }"
            >
              <button
                class="document-row"
                :tabindex="
                  entry.path === selectedPath || (selectedIndex < 0 && index === 0) ? 0 : -1
                "
                :disabled="!!renameEntry || editorLocked || moving"
                :draggable="canMoveFile(entry.path)"
                :class="{
                  selected: entry.path === selectedPath,
                  dragging: entry.path === draggedPath,
                  'has-destination': !!archive
                }"
                @dragstart="startDrag($event, entry.path)"
                @dragend="endDrag"
                :aria-pressed="entry.path === selectedPath"
                :title="entry.name"
                @click="selectDocument(entry.path)"
              >
                <InputThumbnail
                  v-if="/\.pdf$/i.test(entry.name)"
                  :entry="entry"
                /><span
                  v-else
                  class="file-icon"
                  ><i
                    class="bi bi-file-earmark-text"
                    aria-hidden="true"
                /></span>
                <span class="file-heading"
                  ><span class="file-title">{{ entry.name }}</span
                  ><span
                    v-if="entry.transferPending"
                    class="ocr-status checking"
                    title="Waiting for stable file size and modification time, and a complete PDF end marker."
                    >Waiting for transfer…</span
                  ><span
                    v-else-if="/\.pdf$/i.test(entry.name)"
                    class="ocr-status"
                    :class="ocr.statuses.value[entry.path]?.phase"
                    :title="ocr.statuses.value[entry.path]?.detail"
                    >{{ ocr.statuses.value[entry.path]?.label ?? 'Text check queued' }}</span
                  ></span
                >
                <span class="file-details"
                  ><span
                    v-if="
                      matchingPreparation(entry, ocr.prepared.value[entry.path])?.keywords.length
                    "
                    class="input-keywords"
                    aria-label="Document keywords"
                    ><span
                      v-for="keyword in matchingPreparation(entry, ocr.prepared.value[entry.path])!
                        .keywords"
                      :key="keyword"
                      >{{ keyword }}</span
                    ></span
                  ><span class="file-meta"
                    ><template v-if="ocr.pageCount(entry)"
                      >{{ ocr.pageCount(entry) }}
                      {{ ocr.pageCount(entry) === 1 ? 'page' : 'pages' }} · </template
                    >{{ size(entry.size) }} · {{ date.format(entry.modified) }}</span
                  ></span
                >
              </button>
              <div
                v-if="archive"
                class="input-move-actions"
              >
                <button
                  class="input-top-destination"
                  type="button"
                  :disabled="!canMoveFile(entry.path) || !targets.topDestination(entry)"
                  :title="targets.topDestination(entry)?.path"
                  :aria-label="
                    targets.topDestination(entry)
                      ? `Move ${entry.name} to ${targets.topDestination(entry)!.relative}`
                      : `No destination suggestion for ${entry.name}`
                  "
                  @click="moveToTopSuggestion(entry)"
                  @contextmenu.prevent.stop="inspectSuggestedDestination(entry)"
                >
                  <i
                    class="bi bi-folder2"
                    aria-hidden="true"
                  /><span>{{
                    targets.topDestination(entry)?.relative ||
                    (targets.destinationPending(entry)
                      ? 'Finding destination…'
                      : 'No suggested destination')
                  }}</span
                  ><i
                    v-if="targets.topDestination(entry)"
                    class="bi bi-arrow-right"
                    aria-hidden="true"
                  />
                </button>
                <button
                  class="input-move-button"
                  type="button"
                  :disabled="!canMoveFile(entry.path)"
                  :aria-label="`Show destination suggestions for ${entry.name}`"
                  title="Show destination suggestions"
                  @click="showMoveMenu(entry.path, $event)"
                  aria-haspopup="menu"
                  :aria-expanded="moveMenuOpen && moveMenuPath === entry.path"
                  :aria-controls="
                    moveMenuOpen && moveMenuPath === entry.path ? 'quick-move-menu' : undefined
                  "
                >
                  <i
                    class="bi bi-chevron-down"
                    aria-hidden="true"
                  />
                </button>
              </div>
            </li>
          </ul>
          <div
            v-else
            class="empty-state"
          >
            <i
              class="bi bi-inbox"
              aria-hidden="true"
            />
            <h3>
              {{
                !inbox
                  ? 'Start with your scans'
                  : search
                    ? 'No matching documents'
                    : 'Input folder is empty'
              }}
            </h3>
            <p>
              {{
                !inbox
                  ? 'Choose the folder where your new scans arrive.'
                  : search
                    ? 'Try a different filename.'
                    : 'New scans will appear here when you refresh.'
              }}
            </p>
          </div>
        </div>
        <footer class="panel-footer input-footer">
          <p
            v-if="ocr.activePath.value"
            class="tree-hint"
            role="status"
          >
            Adding searchable text to {{ folderName(ocr.activePath.value) }}…
          </p>
          <p
            v-if="inboxError"
            class="error-message"
            role="alert"
          >
            {{ inboxError }}
          </p>
          <p
            v-if="inbox?.skipped"
            class="warning-message"
          >
            {{ inbox.skipped }} unavailable item(s) could not be read.
          </p>
          <span>{{
            search
              ? `${visibleFiles.length} of ${files.length} documents`
              : 'F2 to rename the selected document'
          }}</span>
        </footer>
      </section>
      <section
        class="panel archive-panel"
        aria-labelledby="archive-title"
      >
        <div class="column-header">
          <header class="panel-heading">
            <div class="heading-label">
              <span class="step-number">2</span>
              <h2 id="archive-title">Archive</h2>
            </div>
            <p>Drop a scan onto a folder to file it.</p>
          </header>
          <div class="folder-controls">
            <button
              class="choose-folder"
              :disabled="editorLocked || moving || archiveLoading || !available"
              @click="choose('archive')"
            >
              <i
                class="bi bi-folder2-open"
                aria-hidden="true"
              />{{ archive ? 'Change archive folder' : 'Choose archive folder' }}</button
            ><button
              class="icon-button"
              title="Refresh archive tree"
              aria-label="Refresh archive tree"
              :disabled="editorLocked || moving || !archive || archiveLoading"
              @click="archive && loadArchive(archive.path)"
            >
              <i
                class="bi bi-arrow-clockwise"
                aria-hidden="true"
              />
            </button>
          </div>
          <p
            class="folder-path"
            :title="archive?.path"
          >
            {{ archive?.path || 'No archive folder selected' }}
          </p>
          <button
            class="archive-search-button"
            type="button"
            :disabled="!archive"
            @click="showFolderSearch"
          >
            <i
              class="bi bi-search"
              aria-hidden="true"
            />
            Find folder <kbd>Ctrl+F</kbd>
          </button>
        </div>
        <nav
          ref="archiveTree"
          @contextmenu.self.prevent="archiveRootContext"
          class="panel-content archive-tree"
          tabindex="-1"
          aria-label="Archive folders"
          :aria-busy="archiveLoading"
          @keydown="navigateArchive"
          @focusin="rememberArchiveFocus"
        >
          <div
            v-if="archiveLoading && !archive"
            class="empty-state"
            role="status"
          >
            <span class="spinner-border spinner-border-sm" />
            <p>Reading archive…</p>
          </div>
          <template v-else-if="archive">
            <div
              class="tree-root-row"
              @contextmenu.prevent="archiveRootContext"
              :class="{
                selected: destination === archive.path,
                'drop-active': rootDrop.dropActive.value
              }"
              @dragenter="rootDrop.dragOver"
              @dragover="rootDrop.dragOver"
              @dragleave="rootDrop.dragLeave"
              @drop.stop="rootDrop.drop"
            >
              <button
                class="tree-toggle"
                :aria-expanded="archiveExpanded"
                :aria-label="`${archiveExpanded ? 'Collapse' : 'Expand'} archive root`"
                @click="archiveExpanded = !archiveExpanded"
              >
                <i
                  :class="['bi', archiveExpanded ? 'bi-chevron-down' : 'bi-chevron-right']"
                  aria-hidden="true"
                /></button
              ><button
                class="tree-root"
                data-archive-entry="folder"
                :title="archive.path"
                :aria-pressed="destination === archive.path"
                @click="destination = archive.path"
              >
                <i
                  :class="['bi', archiveExpanded ? 'bi-folder2-open' : 'bi-folder2']"
                  aria-hidden="true"
                /><span>{{ folderName(archive.path) }}</span>
              </button>
            </div>
            <ul
              v-if="archiveExpanded"
              class="folder-list"
            >
              <ArchiveFolder
                v-for="entry in archiveEntries"
                :key="entry.path"
                :entry="entry"
                :selected="destination"
                :viewed-path="archivePreview?.path"
                :reveal-path="revealPath"
                :collapse-version="archiveCollapseVersion"
                :can-drop="canDrop"
                :can-drag="canDragArchive"
                :refresh-version="treeVersion"
                @select="destination = $event"
                @open="previewArchive"
                @context="archiveContext"
                @rename="simpleArchiveRename"
                @drag="startArchiveDrag"
                @dragend="endDrag"
                @drop="dropTo"
              />
            </ul>
            <p
              v-if="archiveExpanded && !archiveEntries.length"
              class="tree-hint"
            >
              Archive folder is empty.
            </p>
          </template>
          <div
            v-else
            class="empty-state"
          >
            <i
              class="bi bi-diagram-3"
              aria-hidden="true"
            />
            <h3>Your digital filing cabinet</h3>
            <p>Choose your archive root to browse its folders.</p>
          </div>
        </nav>
        <footer class="panel-footer destination-footer">
          <p
            v-if="targets.matchingError.value"
            class="error-message"
            role="alert"
          >
            Archive matching unavailable: {{ targets.matchingError.value }}
          </p>
          <p
            v-if="moving"
            class="tree-hint"
            role="status"
          >
            Moving document…
          </p>
          <p
            v-if="moveNotice"
            class="success-message"
            role="status"
          >
            {{ moveNotice }}
          </p>
          <p
            v-if="archiveError"
            class="error-message"
            role="alert"
          >
            {{ archiveError }}
          </p>
          <p
            v-if="archive?.skipped"
            class="warning-message"
          >
            {{ archive.skipped }} unavailable item(s) could not be read.
          </p>

          <span>Selected folder</span
          ><strong :title="destination">{{ destination || 'Choose a folder in the tree' }}</strong>
          <div
            v-if="archive"
            class="archive-index-footer"
          >
            <div
              v-if="targets.indexLoading.value"
              class="index-progress-control"
            >
              <progress
                :value="
                  !targets.indexProgress.value || targets.indexProgress.value.phase === 'scanning'
                    ? undefined
                    : targets.indexProgress.value.processed
                "
                :max="Math.max(1, targets.indexProgress.value?.total ?? 1)"
                :aria-label="textIndexProgressLabel"
                :title="targets.indexProgress.value?.currentFile"
              />
              <span aria-hidden="true">{{ textIndexProgressLabel }}</span>
            </div>
            <button
              v-else
              class="choose-folder archive-index-button"
              type="button"
              @click="targets.refreshIndex()"
            >
              {{ targets.index.value ? 'Refresh text index' : 'Build text index' }}
            </button>
            <p
              v-if="targets.indexLoading.value && targets.indexProgress.value"
              class="archive-index-state"
            >
              {{ targets.indexProgress.value.reused }} unchanged ·
              {{ targets.indexProgress.value.errors }} errors
            </p>
            <p
              v-else-if="targets.index.value"
              class="archive-index-state"
            >
              {{ targets.index.value.documents.length }} indexed PDFs ·
              {{ targets.index.value.errors.length }} errors ·
              {{ targets.index.value.documents.filter((doc) => doc.missingPages.length).length }}
              PDFs with pages without text. Refresh after archive changes.
            </p>
            <p
              v-if="targets.indexError.value"
              class="error-message"
              role="alert"
            >
              {{ targets.indexError.value }}
            </p>
          </div>
        </footer>
      </section>
      <section
        class="panel preview-panel"
        aria-labelledby="preview-title"
      >
        <header class="panel-heading">
          <div class="heading-label">
            <span class="step-number">3</span>
            <h2 id="preview-title">{{ renameEntry ? 'Rename document' : 'Document preview' }}</h2>
          </div>
          <p>
            {{
              renameEntry
                ? 'Browse the archive while choosing a filename.'
                : 'Read the date, sender, and subject.'
            }}
          </p>
        </header>
        <RenameDialog
          v-if="renameEntry"
          :key="renameEntry.path"
          :entry="renameEntry"
          :prepared="matchingPreparation(renameEntry, ocr.prepared.value[renameEntry.path])"
          :suggestions="targets.suggestions.value"
          :suggestions-loading="targets.matchingLoading.value"
          :suggestions-error="targets.matchingError.value"
          :preview="preview"
          @cancel="cancelRename"
          @renamed="renamed"
          @busy="renaming = $event"
        />
        <template v-else>
          <div class="preview-toolbar">
            <span
              class="preview-name"
              :title="viewed?.name"
              >{{ viewed?.name || 'No document selected' }}</span
            ><button
              class="icon-button"
              title="Previous document"
              aria-label="Previous document"
              :disabled="
                !!archivePreview || editorLocked || moving || selectedIndex <= 0 || inboxLoading
              "
              @click="step(-1)"
            >
              <i
                class="bi bi-chevron-left"
                aria-hidden="true"
              /></button
            ><button
              class="icon-button"
              title="Next document"
              aria-label="Next document"
              :disabled="
                !!archivePreview ||
                editorLocked ||
                moving ||
                selectedIndex < 0 ||
                selectedIndex >= visibleFiles.length - 1 ||
                inboxLoading
              "
              @click="step(1)"
            >
              <i
                class="bi bi-chevron-right"
                aria-hidden="true"
              /></button
            ><button
              class="icon-button"
              title="Open in default application"
              aria-label="Open document in default application"
              :disabled="editorLocked || moving || !viewed || documentBusy(viewed.path)"
              @click="openOriginal"
            >
              <i
                class="bi bi-box-arrow-up-right"
                aria-hidden="true"
              />
            </button>
          </div>
          <p
            v-if="previewError"
            class="error-message"
            role="alert"
          >
            {{ previewError }}
          </p>
          <div
            class="preview-canvas"
            :aria-busy="previewLoading"
          >
            <div
              v-if="previewLoading"
              class="empty-state"
              role="status"
            >
              <span class="spinner-border spinner-border-sm" />
              <p>Loading document…</p>
            </div>
            <PdfEditor
              v-else-if="preview?.kind === 'pdf' && viewed"
              :key="`${preview.url}-${previewRevision}`"
              :path="viewed.path"
              :read-only="!!archivePreview"
              :external-busy="documentBusy(viewed.path)"
              @state="editorState = $event"
              @saved="pdfSaved"
            />
            <div
              v-else-if="preview?.kind === 'image'"
              class="image-viewer"
            >
              <img
                :src="preview.url"
                :alt="viewed?.name"
                @error="
                  previewError =
                    'This image could not be displayed. Try opening it in its default application.'
                "
              />
            </div>
            <div
              v-else
              class="empty-state"
            >
              <span class="preview-placeholder"
                ><i
                  class="bi bi-file-earmark-text"
                  aria-hidden="true"
              /></span>
              <h3>{{ viewed ? 'Preview unavailable' : 'Take a closer look' }}</h3>
              <p>
                {{
                  viewed
                    ? 'Use the open button above to view this document in its default application.'
                    : 'Select an input document to view it here. PDFs and scanned images are supported.'
                }}
              </p>
              <span
                v-if="!viewed"
                class="format-label"
                >PDF · PNG · JPEG · GIF · WebP · BMP</span
              >
            </div>
          </div>
          <footer class="panel-footer preview-footer">
            <span>{{
              viewed
                ? `${size(viewed.size)} · Modified ${date.format(viewed.modified)}`
                : 'Your documents stay on your computer'
            }}</span
            ><span v-if="archivePreview">Archive preview</span
            ><span v-else-if="selectedIndex >= 0"
              >{{ selectedIndex + 1 }} / {{ visibleFiles.length }}</span
            >
          </footer>
        </template>
      </section>
    </main>
  </div>
</template>
