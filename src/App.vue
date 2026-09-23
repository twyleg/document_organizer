5<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { DirectoryListing, FileEntry, Location } from '../shared/types'

const locations = ref<Location[]>([])
const listing = ref<DirectoryListing | null>(null)
const pathInput = ref('')
const search = ref('')
const showHidden = ref(false)
const loading = ref(false)
const error = ref('')
const selected = ref<string | null>(null)
const history = ref<string[]>([])
const historyIndex = ref(-1)
const sort = ref<'name' | 'size' | 'modified'>('name')
const descending = ref(false)
let request = 0

const visibleEntries = computed(() => (listing.value?.entries ?? [])
  .filter(entry => (showHidden.value || !entry.name.startsWith('.')) && entry.name.toLocaleLowerCase().includes(search.value.toLocaleLowerCase()))
  .sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    const result = sort.value === 'name'
      ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
      : a[sort.value] - b[sort.value]
    return descending.value ? -result : result
  }))
const currentName = computed(() => listing.value?.path.split(/[\\/]/).filter(Boolean).at(-1) ?? 'File system')
const selectedEntry = computed(() => listing.value?.entries.find(entry => entry.path === selected.value))

function message(cause: unknown) {
  return cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(cause)
}
async function navigate(path: string, targetIndex?: number) {
  const id = ++request
  loading.value = true
  error.value = ''
  try {
    const result = await window.files.listDirectory(path)
    if (id !== request) return
    listing.value = result
    pathInput.value = result.path
    search.value = ''
    selected.value = null
    if (targetIndex !== undefined) historyIndex.value = targetIndex
    else if (history.value[historyIndex.value] !== result.path) {
      history.value = [...history.value.slice(0, historyIndex.value + 1), result.path]
      historyIndex.value = history.value.length - 1
    }
  } catch (cause) {
    if (id === request) error.value = message(cause)
  } finally {
    if (id === request) loading.value = false
  }
}
async function chooseFolder() {
  try {
    const path = await window.files.chooseDirectory()
    if (path) await navigate(path)
  } catch (cause) { error.value = message(cause) }
}
async function open(entry: FileEntry) {
  if (entry.isDirectory) return navigate(entry.path)
  try { await window.files.openFile(entry.path) }
  catch (cause) { error.value = message(cause) }
}
function changeSort(column: typeof sort.value) {
  if (sort.value === column) descending.value = !descending.value
  else { sort.value = column; descending.value = false }
}
function size(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 4)
  return `${(bytes / 1024 ** exponent).toFixed(1)} ${['B', 'KB', 'MB', 'GB', 'TB'][exponent]}`
}
const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
function icon(entry: FileEntry) {
  if (entry.isDirectory) return 'folder-fill'
  if (/\.(png|jpg|jpeg|gif|svg|webp)$/i.test(entry.name)) return 'file-earmark-image'
  if (/\.(zip|gz|tar|7z)$/i.test(entry.name)) return 'file-earmark-zip'
  if (/\.(ts|js|json|html|css|vue|py)$/i.test(entry.name)) return 'file-earmark-code'
  return 'file-earmark-text'
}
onMounted(async () => {
  if (!window.files) { error.value = 'Start this app with npm run dev to browse files in Electron.'; return }
  try {
    locations.value = await window.files.locations()
    if (locations.value[0]) await navigate(locations.value[0].path)
  } catch (cause) { error.value = message(cause) }
})
</script>

<template>
  <div class="browser-shell">
    <aside class="sidebar">
      <div class="brand"><span class="brand-icon"><i aria-hidden="true" class="bi bi-folder2-open" /></span> File Browser</div>
      <div class="section-label">PLACES</div>
      <nav aria-label="Favorite folders" class="nav flex-column gap-1">
        <button v-for="location in locations" :key="location.name" class="nav-link text-start" :class="{ active: listing?.path === location.path }" @click="navigate(location.path)">
          <i aria-hidden="true" :class="`bi bi-${location.icon}`" />{{ location.name }}
        </button>
      </nav>
      <button class="btn btn-outline-secondary choose-button" @click="chooseFolder"><i aria-hidden="true" class="bi bi-folder-plus me-2" />Choose folder</button>
      <div class="sidebar-footer"><i aria-hidden="true" class="bi bi-pc-display me-2" />Your files, on your computer</div>
    </aside>

    <main class="main-panel">
      <header class="toolbar">
        <div class="d-flex gap-1">
          <button class="btn icon-button" aria-label="Back" title="Back" :disabled="historyIndex <= 0 || loading" @click="navigate(history[historyIndex - 1]!, historyIndex - 1)"><i aria-hidden="true" class="bi bi-arrow-left" /></button>
          <button class="btn icon-button" aria-label="Forward" title="Forward" :disabled="historyIndex >= history.length - 1 || loading" @click="navigate(history[historyIndex + 1]!, historyIndex + 1)"><i aria-hidden="true" class="bi bi-arrow-right" /></button>
          <button class="btn icon-button" aria-label="Parent folder" title="Parent folder" :disabled="!listing || listing.path === listing.parent || loading" @click="listing && navigate(listing.parent)"><i aria-hidden="true" class="bi bi-arrow-up" /></button>
        </div>
        <form class="path-form" @submit.prevent="navigate(pathInput)">
          <i aria-hidden="true" class="bi bi-folder2 text-secondary" />
          <input v-model="pathInput" class="form-control" aria-label="Folder path" placeholder="Enter an absolute folder path" spellcheck="false" />
        </form>
        <button class="btn icon-button" aria-label="Refresh folder" title="Refresh folder" :disabled="!listing || loading" @click="listing && navigate(listing.path)"><i aria-hidden="true" class="bi bi-arrow-clockwise" /></button>
      </header>

      <section class="folder-heading">
        <div><div class="section-label mb-1">EXPLORER</div><h1>{{ listing ? currentName : 'Your files' }}</h1><p class="text-secondary mb-0">Browse and open your local files.</p></div>
        <div class="search-box"><i aria-hidden="true" class="bi bi-search" /><input v-model="search" class="form-control" aria-label="Search this folder" placeholder="Search this folder…" /></div>
      </section>
      <div class="view-options">
        <span><i aria-hidden="true" class="bi bi-list-ul me-2" />All files <span class="badge rounded-pill ms-2">{{ visibleEntries.length }}</span></span>
        <label class="form-check form-switch mb-0"><input v-model="showHidden" class="form-check-input" type="checkbox" role="switch" /> <span class="form-check-label">Show hidden files</span></label>
      </div>
      <div v-if="error" class="alert alert-danger mx-4 mt-3 mb-0" role="alert">{{ error }}</div>
      <div v-if="listing?.skipped" class="alert alert-warning mx-4 mt-3 mb-0">{{ listing.skipped }} unavailable item(s) could not be read.</div>

      <div class="file-area" :aria-busy="loading">
        <div v-if="loading" class="empty-state" role="status"><span class="spinner-border text-primary" /><p>Reading folder…</p></div>
        <table v-else-if="visibleEntries.length" class="table file-table align-middle mb-0">
          <thead><tr>
            <th :aria-sort="sort === 'name' ? (descending ? 'descending' : 'ascending') : 'none'"><button @click="changeSort('name')">Name <i aria-hidden="true" v-if="sort === 'name'" :class="`bi bi-arrow-${descending ? 'down' : 'up'}`" /></button></th>
            <th>Kind</th>
            <th :aria-sort="sort === 'size' ? (descending ? 'descending' : 'ascending') : 'none'"><button @click="changeSort('size')">Size <i aria-hidden="true" v-if="sort === 'size'" :class="`bi bi-arrow-${descending ? 'down' : 'up'}`" /></button></th>
            <th :aria-sort="sort === 'modified' ? (descending ? 'descending' : 'ascending') : 'none'"><button @click="changeSort('modified')">Modified <i aria-hidden="true" v-if="sort === 'modified'" :class="`bi bi-arrow-${descending ? 'down' : 'up'}`" /></button></th>
          </tr></thead>
          <tbody><tr v-for="entry in visibleEntries" :key="entry.path" :class="{ selected: selected === entry.path }" @click="selected = entry.path" @dblclick="open(entry)">
            <td><button class="file-name" :title="entry.name" @click.stop="selected = entry.path" @dblclick.stop="open(entry)" @keydown.enter.prevent="open(entry)"><i aria-hidden="true" :class="['bi', `bi-${icon(entry)}`, entry.isDirectory ? 'folder-icon' : 'document-icon']" /><span>{{ entry.name }}</span><i aria-hidden="true" v-if="entry.isSymbolicLink" class="bi bi-link-45deg text-secondary" /></button></td>
            <td>{{ entry.isDirectory ? 'Folder' : 'File' }}</td><td>{{ entry.isDirectory ? '—' : size(entry.size) }}</td><td>{{ date.format(entry.modified) }}</td>
          </tr></tbody>
        </table>
        <div v-else class="empty-state"><i aria-hidden="true" class="bi bi-folder2-open" /><h2>{{ search ? 'No matching files' : 'Nothing here yet' }}</h2><p>{{ search ? 'Try a different search or show hidden files.' : 'Choose a folder or navigate to another location.' }}</p></div>
      </div>
      <footer class="status-bar"><span>{{ visibleEntries.length }} items<span v-if="selectedEntry"> · {{ selectedEntry.name }}</span></span><span>Double-click or press Enter to open</span></footer>
    </main>
  </div>
</template>
