<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import ArchiveFolder from './components/ArchiveFolder.vue'
import PdfEditor from './components/PdfEditor.vue'
import { documentDragType, useFolderDrop } from './folderDrop'
import type { DirectoryListing } from '../shared/types'

const inbox = ref<DirectoryListing | null>(null)
const archive = ref<DirectoryListing | null>(null)
const inboxLoading = ref(false)
const archiveLoading = ref(false)
const inboxError = ref('')
const archiveError = ref('')
const search = ref('')
const selectedPath = ref('')
const destination = ref('')
const treeVersion = ref(0)
const moving = ref(false)
const moveNotice = ref('')
const draggedPath = ref('')
let dragToken = ''
const preview = ref<{ url: string; kind: 'pdf' | 'image' } | null>(null)
const previewLoading = ref(false)
const previewError = ref('')
const editorState = ref({ dirty: false, saving: false })
const editorLocked = computed(() => editorState.value.dirty || editorState.value.saving)
const available = !!window.files
let inboxRequest = 0
let archiveRequest = 0
let previewRequest = 0

const files = computed(() => (inbox.value?.entries ?? [])
  .filter(entry => !entry.isDirectory && !entry.name.startsWith('.'))
  .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })))
const visibleFiles = computed(() => files.value.filter(entry => entry.name.toLocaleLowerCase().includes(search.value.toLocaleLowerCase())))
const archiveEntries = computed(() => (archive.value?.entries ?? []).filter(entry => !entry.name.startsWith('.'))
  .sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })))
const selected = computed(() => files.value.find(entry => entry.path === selectedPath.value))
const canMove = computed(() => !!selected.value && !editorLocked.value && !moving.value && !inboxLoading.value && !archiveLoading.value)
const canDrop = computed(() => !!draggedPath.value && canMove.value)
const rootDrop = useFolderDrop(() => canDrop.value, event => { if (archive.value) dropTo(archive.value.path, event) })
const selectedIndex = computed(() => visibleFiles.value.findIndex(entry => entry.path === selectedPath.value))
const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })
function message(cause: unknown) {
  return cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(cause)
}
function folderName(path: string) { return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path }
function size(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 4)
  return `${(bytes / 1024 ** exponent).toFixed(1)} ${['B', 'KB', 'MB', 'GB', 'TB'][exponent]}`
}
function remember(key: string, path: string) {
  try { localStorage.setItem(`document-organizer.${key}`, path) } catch { /* Folder access works without storage. */ }
}
async function loadInbox(path: string) {
  const id = ++inboxRequest
  inboxLoading.value = true
  inboxError.value = ''
  try {
    const result = await window.files.listDirectory(path)
    if (id !== inboxRequest) return
    const changed = inbox.value?.path !== result.path
    inbox.value = result
    if (changed) search.value = ''
    if (changed || !files.value.some(entry => entry.path === selectedPath.value)) selectedPath.value = visibleFiles.value[0]?.path ?? ''
    remember('inbox', result.path)
  } catch (cause) { if (id === inboxRequest) inboxError.value = message(cause) }
  finally { if (id === inboxRequest) inboxLoading.value = false }
}
async function loadArchive(path: string) {
  const id = ++archiveRequest
  archiveLoading.value = true
  archiveError.value = ''
  try {
    const result = await window.files.listDirectory(path)
    if (id !== archiveRequest) return
    if (archive.value?.path !== result.path) destination.value = result.path
    archive.value = result
    treeVersion.value++
    remember('archive', result.path)
  } catch (cause) { if (id === archiveRequest) archiveError.value = message(cause) }
  finally { if (id === archiveRequest) archiveLoading.value = false }
}
async function choose(kind: 'inbox' | 'archive') {
  if (editorLocked.value) return
  try {
    const path = await window.files.chooseDirectory()
    if (path) await (kind === 'inbox' ? loadInbox(path) : loadArchive(path))
  } catch (cause) { (kind === 'inbox' ? inboxError : archiveError).value = message(cause) }
}
function startDrag(event: DragEvent, path: string) {
  if (editorLocked.value || moving.value || inboxLoading.value || archiveLoading.value || !event.dataTransfer) { event.preventDefault(); return }
  selectedPath.value = path
  draggedPath.value = path
  dragToken = crypto.randomUUID()
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData(documentDragType, dragToken)
}
function endDrag() { draggedPath.value = ''; dragToken = '' }
function dropTo(folder: string, event: DragEvent) {
  if (!canDrop.value || !dragToken || event.dataTransfer?.getData(documentDragType) !== dragToken) return
  const source = draggedPath.value
  endDrag()
  void moveTo(folder, source)
}
async function moveTo(folder: string, sourcePath = selectedPath.value) {
  const source = files.value.find(entry => entry.path === sourcePath)
  const inputPath = inbox.value?.path
  const archivePath = archive.value?.path
  if (!canMove.value || !source || !inputPath || !archivePath) return
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
  } catch (cause) { moveError = message(cause) }
  finally {
    await Promise.all([loadInbox(inputPath), loadArchive(archivePath)])
    if (moveError) archiveError.value = moveError
    moving.value = false
  }
}
async function openOriginal() {
  if (!selected.value || editorLocked.value) return
  try { await window.files.openFile(selected.value.path) }
  catch (cause) { previewError.value = message(cause) }
}
function step(offset: number) {
  if (editorLocked.value) return
  const entry = visibleFiles.value[selectedIndex.value + offset]
  if (entry) selectedPath.value = entry.path
}
function selectDocument(path: string) { if (!editorLocked.value && !moving.value) selectedPath.value = path }
function pdfSaved(metadata: { size: number; modified: number }) {
  if (selected.value) Object.assign(selected.value, metadata)
}
watch(selected, async entry => {
  const id = ++previewRequest
  preview.value = null
  previewError.value = ''
  previewLoading.value = !!entry
  if (!entry) return
  try {
    const result = await window.files.previewFile(entry.path)
    if (id === previewRequest) preview.value = result
  } catch (cause) { if (id === previewRequest) previewError.value = message(cause) }
  finally { if (id === previewRequest) previewLoading.value = false }
})
onMounted(async () => {
  if (!available) { inboxError.value = 'Launch with npm run dev to access your local documents in Electron.'; return }
  let savedInbox: string | null = null
  let savedArchive: string | null = null
  try {
    savedInbox = localStorage.getItem('document-organizer.inbox')
    savedArchive = localStorage.getItem('document-organizer.archive')
  } catch { /* Folder pickers work when preferences cannot be read. */ }
  await Promise.all([savedInbox ? loadInbox(savedInbox) : undefined, savedArchive ? loadArchive(savedArchive) : undefined])
})
</script>

<template>
  <div class="organizer">
    <header class="app-header">
      <div class="brand"><span class="brand-icon"><i class="bi bi-files" aria-hidden="true" /></span><div><h1>Document Organizer</h1><p>A place for every document.</p></div></div>
      <span class="local-label"><i class="bi bi-pc-display" aria-hidden="true" /> Local workspace</span>
    </header>
    <main class="workspace">
      <section class="panel inbox-panel" aria-labelledby="inbox-title">
        <header class="panel-heading"><div class="heading-label"><span class="step-number">1</span><h2 id="inbox-title">Input documents</h2><span class="count">{{ files.length }}</span></div><p>Select a scan to review.</p></header>
        <div class="folder-controls">
          <button class="choose-folder" :disabled="editorLocked || moving || inboxLoading || !available" @click="choose('inbox')"><i class="bi bi-folder2-open" aria-hidden="true" />{{ inbox ? 'Change input folder' : 'Choose input folder' }}</button>
          <button class="icon-button" title="Refresh input folder" aria-label="Refresh input folder" :disabled="editorLocked || moving || !inbox || inboxLoading" @click="inbox && loadInbox(inbox.path)"><i class="bi bi-arrow-clockwise" aria-hidden="true" /></button>
        </div>
        <p v-if="inbox" class="folder-path" :title="inbox.path">{{ inbox.path }}</p>
        <label v-if="inbox" class="search-box"><i class="bi bi-search" aria-hidden="true" /><input v-model="search" type="search" placeholder="Find a document…" aria-label="Filter input documents" /></label>
        <p v-if="inboxError" class="error-message" role="alert">{{ inboxError }}</p>
        <p v-if="inbox?.skipped" class="warning-message">{{ inbox.skipped }} unavailable item(s) could not be read.</p>
        <div class="panel-content" :aria-busy="inboxLoading">
          <div v-if="inboxLoading" class="empty-state" role="status"><span class="spinner-border spinner-border-sm" /><p>Reading input folder…</p></div>
          <ul v-else-if="visibleFiles.length" class="document-list" aria-label="Input files">
            <li v-for="entry in visibleFiles" :key="entry.path"><button class="document-row" :disabled="editorLocked || moving" :draggable="!editorLocked && !moving && !inboxLoading && !archiveLoading" :class="{ selected: entry.path === selectedPath, dragging: entry.path === draggedPath }" @dragstart="startDrag($event, entry.path)" @dragend="endDrag" :aria-pressed="entry.path === selectedPath" :title="entry.name" @click="selectDocument(entry.path)"><span class="file-icon"><i :class="['bi', /\.pdf$/i.test(entry.name) ? 'bi-file-earmark-pdf' : 'bi-file-earmark-text']" aria-hidden="true" /></span><span class="file-details"><span class="file-title">{{ entry.name }}</span><span class="file-meta">{{ size(entry.size) }} · {{ date.format(entry.modified) }}</span></span></button></li>
          </ul>
          <div v-else class="empty-state"><i class="bi bi-inbox" aria-hidden="true" /><h3>{{ !inbox ? 'Start with your scans' : search ? 'No matching documents' : 'Input folder is empty' }}</h3><p>{{ !inbox ? 'Choose the folder where your new scans arrive.' : search ? 'Try a different filename.' : 'New scans will appear here when you refresh.' }}</p></div>
        </div>
        <footer class="panel-footer">{{ search ? `${visibleFiles.length} of ${files.length} documents` : 'Files directly in your input folder' }}</footer>
      </section>
      <section class="panel archive-panel" aria-labelledby="archive-title">
        <header class="panel-heading"><div class="heading-label"><span class="step-number">2</span><h2 id="archive-title">Archive</h2></div><p>Drop a scan onto a folder to file it.</p></header>
        <div class="folder-controls"><button class="choose-folder" :disabled="editorLocked || moving || archiveLoading || !available" @click="choose('archive')"><i class="bi bi-folder2-open" aria-hidden="true" />{{ archive ? 'Change archive folder' : 'Choose archive folder' }}</button><button class="icon-button" title="Refresh archive tree" aria-label="Refresh archive tree" :disabled="editorLocked || moving || !archive || archiveLoading" @click="archive && loadArchive(archive.path)"><i class="bi bi-arrow-clockwise" aria-hidden="true" /></button></div>
        <p v-if="archive" class="folder-path" :title="archive.path">{{ archive.path }}</p>
        <p v-if="moving" class="tree-hint" role="status">Moving document…</p>
        <p v-if="moveNotice" class="success-message" role="status">{{ moveNotice }}</p>
        <p v-if="archiveError" class="error-message" role="alert">{{ archiveError }}</p>
        <p v-if="archive?.skipped" class="warning-message">{{ archive.skipped }} unavailable item(s) could not be read.</p>
        <nav class="panel-content archive-tree" aria-label="Archive folders" :aria-busy="archiveLoading">
          <div v-if="archiveLoading && !archive" class="empty-state" role="status"><span class="spinner-border spinner-border-sm" /><p>Reading archive…</p></div>
          <template v-else-if="archive">
            <div class="tree-root-row" :class="{ selected: destination === archive.path, 'drop-active': rootDrop.dropActive.value }" @dragenter="rootDrop.dragOver" @dragover="rootDrop.dragOver" @dragleave="rootDrop.dragLeave" @drop.stop="rootDrop.drop"><button class="tree-root" :aria-pressed="destination === archive.path" @click="destination = archive.path"><i class="bi bi-folder2-open" aria-hidden="true" /><span>{{ folderName(archive.path) }}</span></button><button class="move-button" :disabled="!canMove" :aria-label="`Move current document to ${archive.path}`" :title="`Move current document to ${archive.path}`" @click="moveTo(archive.path)">Move</button></div>
            <ul class="folder-list"><ArchiveFolder v-for="entry in archiveEntries" :key="entry.path" :entry="entry" :selected="destination" :can-move="canMove" :can-drop="canDrop" :refresh-version="treeVersion" @select="destination = $event" @move="moveTo" @drop="dropTo" /></ul>
            <p v-if="!archiveEntries.length" class="tree-hint">Archive folder is empty.</p>
          </template>
          <div v-else class="empty-state"><i class="bi bi-diagram-3" aria-hidden="true" /><h3>Your digital filing cabinet</h3><p>Choose your archive root to browse its folders.</p></div>
        </nav>
        <footer class="panel-footer destination-footer"><span>Selected folder</span><strong :title="destination">{{ destination || 'Choose a folder in the tree' }}</strong></footer>
      </section>
      <section class="panel preview-panel" aria-labelledby="preview-title">
        <header class="panel-heading"><div class="heading-label"><span class="step-number">3</span><h2 id="preview-title">Document preview</h2></div><p>Read the date, sender, and subject.</p></header>
        <div class="preview-toolbar"><span class="preview-name" :title="selected?.name">{{ selected?.name || 'No document selected' }}</span><button class="icon-button" title="Previous document" aria-label="Previous document" :disabled="editorLocked || moving || selectedIndex <= 0 || inboxLoading" @click="step(-1)"><i class="bi bi-chevron-left" aria-hidden="true" /></button><button class="icon-button" title="Next document" aria-label="Next document" :disabled="editorLocked || moving || selectedIndex < 0 || selectedIndex >= visibleFiles.length - 1 || inboxLoading" @click="step(1)"><i class="bi bi-chevron-right" aria-hidden="true" /></button><button class="icon-button" title="Open in default application" aria-label="Open document in default application" :disabled="editorLocked || moving || !selected" @click="openOriginal"><i class="bi bi-box-arrow-up-right" aria-hidden="true" /></button></div>
        <p v-if="previewError" class="error-message" role="alert">{{ previewError }}</p>
        <div class="preview-canvas" :aria-busy="previewLoading">
          <div v-if="previewLoading" class="empty-state" role="status"><span class="spinner-border spinner-border-sm" /><p>Loading document…</p></div>
          <PdfEditor v-else-if="preview?.kind === 'pdf' && selected" :key="preview.url" :path="selected.path" @state="editorState = $event" @saved="pdfSaved" />
          <div v-else-if="preview?.kind === 'image'" class="image-viewer"><img :src="preview.url" :alt="selected?.name" @error="previewError = 'This image could not be displayed. Try opening it in its default application.'" /></div>
          <div v-else class="empty-state"><span class="preview-placeholder"><i class="bi bi-file-earmark-text" aria-hidden="true" /></span><h3>{{ selected ? 'Preview unavailable' : 'Take a closer look' }}</h3><p>{{ selected ? 'Use the open button above to view this document in its default application.' : 'Select an input document to view it here. PDFs and scanned images are supported.' }}</p><span v-if="!selected" class="format-label">PDF · PNG · JPEG · GIF · WebP · BMP</span></div>
        </div>
        <footer class="panel-footer preview-footer"><span>{{ selected ? `${size(selected.size)} · Modified ${date.format(selected.modified)}` : 'Your documents stay on your computer' }}</span><span v-if="selectedIndex >= 0">{{ selectedIndex + 1 }} / {{ visibleFiles.length }}</span></footer>
      </section>
    </main>
    <footer class="app-footer"><span><i class="bi bi-shield-check" aria-hidden="true" /> Manual review workspace</span><span>Filename convention: <code>YYYYMMDD_SENDER-SUBJECT.pdf</code></span></footer>
  </div>
</template>
