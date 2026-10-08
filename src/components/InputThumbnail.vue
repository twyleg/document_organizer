<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { FileEntry } from '../../shared/types'
import type { PDFDocumentLoadingTask, RenderTask } from 'pdfjs-dist'
import { openTextPdf } from '../pdfText'
import { inputContentKey } from '../renamePreparation'
import { queueThumbnail } from '../thumbnailQueue'

const props = defineProps<{ entry: FileEntry }>()
const container = ref<HTMLElement>()
const canvas = ref<HTMLCanvasElement>()
const visible = ref(false)
const ready = ref(false)
const error = ref('')
let observer: IntersectionObserver | undefined
let generation = 0, disposed = false
let pendingKey = ''
let cancel: (() => void) | undefined
async function load() {
  if (disposed || !visible.value || props.entry.transferPending || ready.value || error.value) return
  const key = inputContentKey(props.entry)
  if (pendingKey === key) return
  pendingKey = key
  const id = ++generation, path = props.entry.path
  const current = () => !disposed && id === generation && key === inputContentKey(props.entry) && !props.entry.transferPending
  try {
    await queueThumbnail(async () => {
      if (!current() || !visible.value) return
      let loadingTask: PDFDocumentLoadingTask | undefined, renderTask: RenderTask | undefined
      cancel = () => { renderTask?.cancel(); void loadingTask?.destroy() }
      try {
        const data = await window.files.readPdf(path)
        if (!current()) return
        const loaded = await openTextPdf(data, task => { loadingTask = task })
        if (!current() || !canvas.value) return
        const page = await loaded.pdf.getPage(1)
        if (!current() || !canvas.value) return
        const base = page.getViewport({ scale: 1 })
        const scale = Math.min(56 / base.width, 76 / base.height)
        const viewport = page.getViewport({ scale: scale * 2 })
        const output = canvas.value
        output.width = Math.ceil(viewport.width); output.height = Math.ceil(viewport.height)
        output.style.width = `${viewport.width / 2}px`; output.style.height = `${viewport.height / 2}px`
        renderTask = page.render({ canvas: output, viewport })
        await renderTask.promise
        if (current()) ready.value = true
      } finally {
        await loadingTask?.destroy()
        if (id === generation) cancel = undefined
      }
    })
  } catch (cause) {
    if (current()) error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    if (id === generation) {
      pendingKey = ''
      if (!ready.value && !error.value && visible.value && current()) void load()
    }
  }
}
watch(() => `${inputContentKey(props.entry)}:${!!props.entry.transferPending}`, () => {
  generation++; cancel?.(); cancel = undefined; pendingKey = ''; ready.value = false; error.value = ''
  void load()
})
watch(visible, value => { if (value) void load() })
onMounted(() => {
  observer = new IntersectionObserver(([entry]) => { visible.value = !!entry?.isIntersecting }, { rootMargin: '100px' })
  if (container.value) observer.observe(container.value)
})
onBeforeUnmount(() => { disposed = true; generation++; observer?.disconnect(); cancel?.() })
</script>

<template>
  <span ref="container" class="input-thumbnail" :aria-busy="!ready && !error" :title="error ? `Preview unavailable: ${error}` : `First page of ${entry.name}`">
    <canvas v-show="ready" ref="canvas" role="img" :aria-label="`First page of ${entry.name}`" />
    <span v-if="!ready" class="input-thumbnail-placeholder" aria-hidden="true"><i :class="error ? 'bi bi-file-earmark-x' : 'bi bi-image'" /></span>
  </span>
</template>
