<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { searchFolders, type ArchiveTarget } from '../folderTargets'
const props = defineProps<{ folders: ArchiveTarget[]; loading: boolean; error: string }>()
const emit = defineEmits<{ select: [path: string]; cancel: [] }>()
const dialog = ref<HTMLDialogElement>()
const input = ref<HTMLInputElement>()
const query = ref('')
const index = ref(0)
const matches = computed(() => searchFolders(props.folders, query.value))
const results = computed(() => matches.value.slice(0, 100))

watch(results, () => {
  index.value = 0
})

function choose() {
  const target = results.value[index.value]
  if (target) {
    emit('select', target.path)
  }
}

function key(event: KeyboardEvent) {
  if (!['ArrowUp', 'ArrowDown', 'Enter', 'Escape'].includes(event.key)) {
    return
  }

  event.preventDefault()
  if (event.key === 'Escape') {
    event.stopPropagation()
    emit('cancel')
    return
  }
  if (event.key === 'Enter') {
    choose()
    return
  }

  index.value = Math.max(
    0,
    Math.min(results.value.length - 1, index.value + (event.key === 'ArrowDown' ? 1 : -1))
  )
  void nextTick(() =>
    dialog.value?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  )
}

onMounted(async () => {
  dialog.value?.showModal()
  await nextTick()
  input.value?.focus()
})

onBeforeUnmount(() => dialog.value?.close())
</script>
<template>
  <dialog
    ref="dialog"
    class="folder-search-dialog"
    aria-labelledby="folder-search-title"
    @cancel.prevent="emit('cancel')"
  >
    <h2 id="folder-search-title">Find archive folder</h2>
    <input
      ref="input"
      v-model="query"
      type="search"
      placeholder="Folder name or path…"
      aria-label="Search archive folders"
      role="combobox"
      aria-expanded="true"
      aria-controls="folder-search-results"
      :aria-activedescendant="results.length ? `folder-result-${index}` : undefined"
      @keydown="key"
    />
    <p class="rename-hint">↑/↓ to choose · Enter to open · Esc to cancel</p>
    <p
      v-if="loading"
      role="status"
    >
      Indexing archive folders…
    </p>
    <p
      v-if="error"
      class="error-message"
      role="alert"
    >
      {{ error }}
    </p>
    <ul
      id="folder-search-results"
      class="folder-search-results"
      role="listbox"
      aria-label="Matching folders"
    >
      <li
        v-for="(folder, i) in results"
        :id="`folder-result-${i}`"
        :key="folder.path"
        role="option"
        :aria-selected="i === index"
        @mouseenter="index = i"
      >
        <button
          type="button"
          :title="folder.path"
          @click="emit('select', folder.path)"
        >
          <i
            class="bi bi-folder2"
            aria-hidden="true"
          />
          {{ folder.relative }}
        </button>
      </li>
    </ul>
    <p v-if="!loading && !results.length">No matching folders.</p>
    <p
      v-if="matches.length > 100"
      class="rename-hint"
    >
      Showing 100 of {{ matches.length }} folders. Type more to narrow the results.
    </p>
    <button
      type="button"
      class="rename-cancel"
      @click="emit('cancel')"
    >
      Cancel
    </button>
  </dialog>
</template>
