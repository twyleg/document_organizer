<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import type { FileEntry } from '../../shared/types'

const props = defineProps<{ entry: FileEntry }>()
const emit = defineEmits<{ cancel: []; renamed: [path: string] }>()
const dialog = ref<HTMLDialogElement>()
const input = ref<HTMLInputElement>()
const name = ref(props.entry.name)
const saving = ref(false)
const error = ref('')
function cancel(event?: Event) {
  event?.preventDefault()
  if (!saving.value) emit('cancel')
}
async function apply() {
  if (saving.value) return
  saving.value = true
  error.value = ''
  try { emit('renamed', await window.files.renameFile(props.entry.path, name.value)) }
  catch (cause) {
    error.value = cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(cause)
    saving.value = false
    await nextTick()
    input.value?.focus()
  }
}
onMounted(async () => {
  dialog.value?.showModal()
  await nextTick()
  input.value?.focus()
  const extension = name.value.lastIndexOf('.')
  input.value?.setSelectionRange(0, extension > 0 ? extension : name.value.length)
})
onBeforeUnmount(() => dialog.value?.close())
</script>

<template>
  <dialog ref="dialog" class="rename-dialog" aria-labelledby="rename-title" @cancel="cancel">
    <form @submit.prevent="apply">
      <div class="rename-heading"><span class="rename-icon"><i class="bi bi-pencil" aria-hidden="true" /></span><h2 id="rename-title">Rename document</h2></div>
      <p class="rename-current" :title="entry.name">{{ entry.name }}</p>
      <label for="rename-name">New filename</label>
      <input id="rename-name" ref="input" v-model="name" type="text" :disabled="saving" required autocomplete="off" spellcheck="false" :aria-invalid="!!error" :aria-describedby="error ? 'rename-error' : 'rename-hint'" />
      <p id="rename-hint" class="rename-hint">Enter to rename · Esc to cancel</p>
      <p v-if="error" id="rename-error" class="error-message" role="alert">{{ error }}</p>
      <div class="rename-actions"><button class="rename-cancel" type="button" :disabled="saving" @click="cancel()">Cancel</button><button class="pdf-save" type="submit" :disabled="saving || !name.trim()">{{ saving ? 'Renaming…' : 'Rename' }}</button></div>
    </form>
  </dialog>
</template>
