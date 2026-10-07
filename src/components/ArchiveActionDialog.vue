<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import type { FileEntry } from '../../shared/types'
const props = defineProps<{ root: string; entry: FileEntry; action: 'create' | 'rename' | 'delete'; scope?: 'input' | 'archive' }>()
const emit = defineEmits<{ cancel: []; done: [path: string]; busy: [value: boolean] }>()
const dialog = ref<HTMLDialogElement>()
const input = ref<HTMLInputElement>()
const name = ref(props.action === 'rename' ? props.entry.name : '')
const saving = ref(false)
const error = ref('')
async function apply() {
  if (saving.value) return
  saving.value = true
  emit('busy', true)
  error.value = ''
  try {
    let path = props.entry.path
    if (props.action === 'create') path = await window.files.createArchiveFolder(props.root, path, name.value)
    else if (props.action === 'rename') path = props.scope === 'input'
      ? await window.files.renameFile(path, name.value)
      : await window.files.renameArchiveEntry(props.root, path, name.value)
    else if (props.scope === 'input') await window.files.deleteInputFile(props.root, path)
    else await window.files.deleteArchiveEntry(props.root, path)
    emit('done', path)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(cause)
    saving.value = false
    emit('busy', false)
  }
}
function cancel() { if (!saving.value) emit('cancel') }
onMounted(async () => {
  dialog.value?.showModal()
  await nextTick()
  if (input.value) {
    input.value.focus()
    const dot = name.value.lastIndexOf('.')
    input.value.setSelectionRange(0, props.action === 'rename' && !props.entry.isDirectory && dot > 0 ? dot : name.value.length)
  } else dialog.value?.querySelector<HTMLButtonElement>('.rename-cancel')?.focus()
})
onBeforeUnmount(() => { emit('busy', false); dialog.value?.close() })
</script>
<template>
  <dialog ref="dialog" class="rename-dialog archive-action-dialog" aria-labelledby="archive-action-title" @cancel.prevent="cancel">
    <form @submit.prevent="apply">
      <h2 id="archive-action-title">{{ scope === 'input' ? (action === 'rename' ? 'Rename simple' : 'Delete input file') : action === 'create' ? 'New folder' : action === 'rename' ? 'Rename archive entry' : 'Delete archive entry' }}</h2>
      <p class="rename-current" :title="entry.path">{{ entry.path }}</p>
      <template v-if="action !== 'delete'"><label for="archive-entry-name">{{ action === 'create' ? 'Folder name' : 'New name' }}</label><input id="archive-entry-name" ref="input" v-model="name" :class="{ 'archive-filename': !entry.isDirectory }" required :disabled="saving" autocomplete="off" /></template>
      <p v-else class="rename-hint">Move “{{ entry.name }}”{{ entry.isDirectory ? ' and all its contents' : '' }} to the system trash?</p>
      <p v-if="error" class="error-message" role="alert">{{ error }}</p>
      <div class="rename-actions"><button class="rename-cancel" type="button" :disabled="saving" @click="cancel">Cancel</button><button class="pdf-save" :class="{ 'archive-delete-button': action === 'delete' }" type="submit" :disabled="saving || (action !== 'delete' && !name.trim())">{{ saving ? 'Applying…' : action === 'create' ? 'Create' : action === 'rename' ? 'Rename' : 'Delete' }}</button></div>
    </form>
  </dialog>
</template>
