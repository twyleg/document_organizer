<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { FileEntry } from '../../shared/types'
import { isRevealBranch } from '../archiveReveal'
import { useFolderDrop } from '../folderDrop'
const props = defineProps<{
  entry: FileEntry
  selected: string
  viewedPath?: string
  revealPath?: string
  collapseVersion: number
  canDrop: boolean
  canDrag: boolean
  refreshVersion: number
}>()
const emit = defineEmits<{
  select: [path: string]
  open: [entry: FileEntry]
  context: [entry: FileEntry]
  rename: [entry: FileEntry]
  drag: [entry: FileEntry, event: DragEvent]
  dragend: []
  drop: [path: string, event: DragEvent]
}>()
const { dropActive, dragOver, dragLeave, drop } = useFolderDrop(
  () => props.canDrop,
  (event) => emit('drop', props.entry.path, event)
)
const expanded = ref(false)
const loaded = ref(false)
const loading = ref(false)
const error = ref('')
const skipped = ref(0)
const children = ref<FileEntry[]>([])
const selected = computed(() => props.entry.path === props.selected)
let request = 0

async function toggle() {
  expanded.value = !expanded.value
  if (!expanded.value || loaded.value || loading.value) {
    return
  }

  await load()
}

async function load() {
  const id = ++request
  loading.value = true
  error.value = ''

  try {
    const listing = await window.files.listDirectory(props.entry.path)
    if (id !== request) {
      return
    }

    children.value = listing.entries
      .filter((entry) => !entry.name.startsWith('.'))
      .sort(
        (a, b) =>
          Number(b.isDirectory) - Number(a.isDirectory) ||
          a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
      )
    skipped.value = listing.skipped
    loaded.value = true
  } catch (cause) {
    if (id === request) {
      error.value =
        cause instanceof Error
          ? cause.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
          : String(cause)
    }
  } finally {
    if (id === request) {
      loading.value = false
    }
  }
}

function retry() {
  expanded.value = false
  void toggle()
}

watch(
  () => props.refreshVersion,
  () => {
    if (loaded.value || expanded.value) {
      void load()
    }
  }
)

watch(
  [() => props.revealPath, () => props.collapseVersion],
  ([path, version], previous) => {
    if (previous && version !== previous[1]) {
      expanded.value = false
    }
    if (!path || !props.entry.isDirectory || !isRevealBranch(props.entry.path, path)) {
      return
    }

    expanded.value = true
    if (!loaded.value && !loading.value) {
      void load()
    }
  },
  { immediate: true }
)
</script>
<template>
  <li
    class="folder-node"
    @contextmenu.prevent.stop="emit('context', entry)"
  >
    <div
      v-if="entry.isDirectory"
      class="tree-row"
      :class="{ selected, 'drop-active': dropActive }"
      @dragenter="dragOver"
      @dragover="dragOver"
      @dragleave="dragLeave"
      @drop.stop="drop"
    >
      <button
        class="tree-toggle"
        :aria-expanded="expanded"
        :aria-label="`${expanded ? 'Collapse' : 'Expand'} ${entry.name}`"
        @click="toggle"
      >
        <i
          :class="['bi', expanded ? 'bi-chevron-down' : 'bi-chevron-right']"
          aria-hidden="true"
        />
      </button>
      <button
        class="tree-name"
        data-archive-entry="folder"
        :aria-pressed="selected"
        :title="entry.path"
        @keydown.f2.prevent.stop="emit('rename', entry)"
        @click="emit('select', entry.path)"
      >
        <i
          :class="['bi', expanded ? 'bi-folder2-open' : 'bi-folder2']"
          aria-hidden="true"
        /><span>{{ entry.name }}</span
        ><i
          v-if="entry.isSymbolicLink"
          class="bi bi-link-45deg"
          aria-hidden="true"
        />
      </button>
    </div>
    <div
      v-else
      class="tree-file"
      :class="{ selected: viewedPath === entry.path }"
      :draggable="canDrag && !entry.isSymbolicLink"
      @dragstart.stop="emit('drag', entry, $event)"
      @dragend="emit('dragend')"
      @keydown.f2.prevent.stop="emit('rename', entry)"
      data-archive-entry="file"
      role="button"
      :aria-pressed="viewedPath === entry.path"
      tabindex="0"
      :title="entry.path"
      @click="emit('open', entry)"
    >
      <i
        :class="['bi', /\.pdf$/i.test(entry.name) ? 'bi-file-earmark-pdf' : 'bi-file-earmark-text']"
        aria-hidden="true"
      /><span>{{ entry.name }}</span
      ><i
        v-if="entry.isSymbolicLink"
        class="bi bi-link-45deg"
        aria-hidden="true"
      />
    </div>
    <div
      v-if="expanded"
      class="tree-children"
    >
      <p
        v-if="loading && !loaded"
        class="tree-hint"
        role="status"
      >
        Loading folders…
      </p>
      <p
        v-else-if="error"
        class="tree-error"
        role="alert"
      >
        {{ error }} <button @click="retry">Retry</button>
      </p>
      <template v-else
        ><p
          v-if="skipped"
          class="tree-hint"
        >
          {{ skipped }} unavailable item(s).
        </p>
        <ul
          v-if="children.length"
          class="folder-list"
        >
          <ArchiveFolder
            v-for="child in children"
            :key="child.path"
            :entry="child"
            :selected="props.selected"
            :viewed-path="viewedPath"
            :reveal-path="revealPath"
            :collapse-version="collapseVersion"
            :can-drop="canDrop"
            :can-drag="canDrag"
            :refresh-version="refreshVersion"
            @select="emit('select', $event)"
            @open="emit('open', $event)"
            @context="emit('context', $event)"
            @rename="emit('rename', $event)"
            @drag="(entry, event) => emit('drag', entry, event)"
            @dragend="emit('dragend')"
            @drop="(path, event) => emit('drop', path, event)"
          />
        </ul>
        <p
          v-else
          class="tree-hint"
        >
          Empty folder
        </p></template
      >
    </div>
  </li>
</template>
