<script setup lang="ts">
import { computed, markRaw, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist'
import { getDocument } from '../pdfRendering'
import type { PdfDocumentData, PdfPageEdit } from '../../shared/types'
import PdfCanvas from './PdfCanvas.vue'

const props = defineProps<{ path: string; externalBusy?: boolean }>()
const emit = defineEmits<{
  state: [state: { dirty: boolean; saving: boolean }]
  saved: [metadata: { size: number; modified: number }]
}>()
const document = shallowRef<PDFDocumentProxy>()
const pages = ref<PdfPageEdit[]>([])
const active = ref(0)
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const notice = ref('')
const zoom = ref(1)
const originalCount = ref(0)
const dragged = ref<number | null>(null)
const dropPosition = ref<number | null>(null)
let source: PdfDocumentData | undefined
let loadingTask: PDFDocumentLoadingTask | undefined
let disposed = false
let request = 0
const pageDragType = 'application/x-document-organizer-pdf-page'
const dirty = computed(() => pages.value.length !== originalCount.value || pages.value.some((page, index) => page.index !== index || page.rotation !== 0))
const current = computed(() => pages.value[active.value])
const busy = computed(() => loading.value || saving.value || props.externalBusy)
watch([dirty, saving], () => emit('state', { dirty: dirty.value, saving: saving.value }), { immediate: true })

function message(cause: unknown) {
  return cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(cause)
}
async function load(data?: PdfDocumentData, keepPage = 0) {
  const id = ++request
  loading.value = true
  error.value = ''
  try {
    const next = data ?? await window.files.readPdf(props.path)
    if (disposed || id !== request) return
    document.value = undefined
    await nextTick()
    await loadingTask?.destroy()
    if (disposed || id !== request) return
    source = next
    const assetBase = new URL('./pdf-assets/', window.location.href).href
    const task = getDocument({
      data: new Uint8Array(next.data), cMapUrl: `${assetBase}cmaps/`, cMapPacked: true,
      standardFontDataUrl: `${assetBase}standard_fonts/`, wasmUrl: `${assetBase}wasm/`, iccUrl: `${assetBase}iccs/`
    })
    loadingTask = task
    task.onPassword = () => {
      error.value = 'Password-protected PDFs cannot be edited here. Open this file in its default application.'
      void task.destroy()
    }
    const pdf = await task.promise
    if (disposed || id !== request) { await task.destroy(); return }
    document.value = markRaw(pdf)
    originalCount.value = pdf.numPages
    pages.value = Array.from({ length: pdf.numPages }, (_, index) => ({ index, rotation: 0 }))
    active.value = Math.min(keepPage, pdf.numPages - 1)
    zoom.value = 1
  } catch (cause) { if (!disposed && id === request && !error.value) error.value = message(cause) }
  finally { if (id === request) loading.value = false }
}
function rotate(delta: number) {
  if (!current.value || busy.value) return
  current.value.rotation = (current.value.rotation + delta + 360) % 360
  notice.value = ''
}
function wheelZoom(event: WheelEvent) {
  if (!event.ctrlKey) return
  event.preventDefault()
  if (busy.value || !current.value || event.deltaY === 0) return
  zoom.value = Math.min(3, Math.max(.5, zoom.value + (event.deltaY < 0 ? .25 : -.25)))
}
function removePage() {
  if (busy.value || pages.value.length < 2) return
  pages.value.splice(active.value, 1)
  active.value = Math.min(active.value, pages.value.length - 1)
  notice.value = ''
}
function reorder(from: number, insertion: number) {
  if (busy.value || from < 0 || from >= pages.value.length) return
  const selectedPage = current.value
  const [page] = pages.value.splice(from, 1)
  pages.value.splice(insertion > from ? insertion - 1 : insertion, 0, page!)
  active.value = pages.value.indexOf(selectedPage!)
  notice.value = ''
}
function startDrag(event: DragEvent, index: number) {
  if (busy.value || !event.dataTransfer) { event.preventDefault(); return }
  dragged.value = index
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData(pageDragType, String(index))
}
function endDrag() { dragged.value = null; dropPosition.value = null }
function dragOver(event: DragEvent, index: number) {
  if (busy.value || dragged.value === null || !event.dataTransfer?.types.includes(pageDragType)) return
  event.preventDefault()
  event.dataTransfer.dropEffect = 'move'
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect()
  dropPosition.value = index + (event.clientX > bounds.left + bounds.width / 2 ? 1 : 0)
}
function stripDragOver(event: DragEvent) {
  if (busy.value || dragged.value === null || !event.dataTransfer?.types.includes(pageDragType)) return
  event.preventDefault()
  event.dataTransfer.dropEffect = 'move'
  const strip = event.currentTarget as HTMLElement
  const thumbnails = Array.from(strip.children)
  const index = thumbnails.findIndex(thumbnail => {
    const bounds = thumbnail.getBoundingClientRect()
    return event.clientX < bounds.left + bounds.width / 2
  })
  dropPosition.value = index < 0 ? pages.value.length : index
}
function dragLeave(event: DragEvent) {
  if (event.currentTarget instanceof Node && event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
  dropPosition.value = null
}
function drop(event: DragEvent) {
  event.preventDefault()
  if (dragged.value !== null && dropPosition.value !== null && event.dataTransfer?.getData(pageDragType) === String(dragged.value)) {
    reorder(dragged.value, dropPosition.value)
  }
  endDrag()
}
async function save() {
  if (!source || !dirty.value || busy.value) return
  saving.value = true
  error.value = ''
  notice.value = ''
  try {
    const saved = await window.files.savePdf(props.path, source.version, pages.value.map(page => ({ ...page })))
    emit('saved', { size: saved.size, modified: saved.modified })
    originalCount.value = pages.value.length
    pages.value = pages.value.map((_, index) => ({ index, rotation: 0 }))
    await load(saved, active.value)
    notice.value = 'Changes saved to this PDF.'
  } catch (cause) { error.value = message(cause) }
  finally { saving.value = false }
}
function discard() {
  if (busy.value) return
  notice.value = ''
  pages.value = Array.from({ length: originalCount.value }, (_, index) => ({ index, rotation: 0 }))
  active.value = Math.min(active.value, pages.value.length - 1)
  void load()
}
function beforeUnload(event: BeforeUnloadEvent) {
  if (dirty.value || saving.value) { event.preventDefault(); event.returnValue = false }
}
onMounted(() => { window.addEventListener('beforeunload', beforeUnload); void load() })
onBeforeUnmount(() => {
  disposed = true
  request++
  window.removeEventListener('beforeunload', beforeUnload)
  void loadingTask?.destroy()
  emit('state', { dirty: false, saving: false })
})
</script>

<template>
  <div class="pdf-editor">
    <div class="pdf-edit-toolbar">
      <div class="pdf-toolbar-group"><button class="icon-button" aria-label="Previous PDF page" title="Previous page" :disabled="busy || active <= 0" @click="active--"><i class="bi bi-chevron-left" aria-hidden="true" /></button><span class="pdf-page-count">{{ pages.length ? active + 1 : 0 }} / {{ pages.length }}</span><button class="icon-button" aria-label="Next PDF page" title="Next page" :disabled="busy || active >= pages.length - 1" @click="active++"><i class="bi bi-chevron-right" aria-hidden="true" /></button></div>
      <div class="pdf-toolbar-group"><button class="icon-button" aria-label="Rotate page counterclockwise" title="Rotate left" :disabled="busy || !current" @click="rotate(-90)"><i class="bi bi-arrow-counterclockwise" aria-hidden="true" /></button><button class="icon-button" aria-label="Rotate page clockwise" title="Rotate right" :disabled="busy || !current" @click="rotate(90)"><i class="bi bi-arrow-clockwise" aria-hidden="true" /></button><button class="icon-button delete-page" aria-label="Delete current PDF page" :title="pages.length < 2 ? 'Keep at least one page' : 'Delete page'" :disabled="busy || pages.length < 2" @click="removePage"><i class="bi bi-trash3" aria-hidden="true" /></button></div>
      <div class="pdf-toolbar-group"><button class="icon-button" aria-label="Zoom out PDF page" :disabled="busy || zoom <= .5" @click="zoom = Math.max(.5, zoom - .25)"><i class="bi bi-dash" aria-hidden="true" /></button><button class="pdf-fit-button" title="Fit page" aria-label="Fit PDF page" :disabled="busy" @click="zoom = 1">{{ Math.round(zoom * 100) }}%</button><button class="icon-button" aria-label="Zoom in PDF page" :disabled="busy || zoom >= 3" @click="zoom = Math.min(3, zoom + .25)"><i class="bi bi-plus" aria-hidden="true" /></button></div>
      <div class="pdf-save-actions"><button class="pdf-discard" :disabled="busy || !dirty" @click="discard">Discard</button><button class="pdf-save" :disabled="busy || !dirty" @click="save"><i class="bi bi-check2" aria-hidden="true" /> {{ saving ? 'Saving…' : 'Save' }}</button></div>
    </div>
    <p v-if="error" class="error-message" role="alert">{{ error }}</p>
    <p v-if="notice" class="pdf-notice" role="status">{{ notice }}</p>
    <div class="pdf-main-page" :aria-busy="loading" title="Ctrl + mouse wheel to zoom" @wheel="wheelZoom">
      <div v-if="loading" class="empty-state" role="status"><span class="spinner-border spinner-border-sm" /><p>Loading PDF pages…</p></div>
      <PdfCanvas v-else-if="document && current" :document="document" :page="current.index" :rotation="current.rotation" :zoom="zoom" @error="error = $event" />
      <div v-else class="empty-state"><i class="bi bi-file-earmark-pdf" aria-hidden="true" /><h3>Unable to load this PDF</h3><p>Try opening it in its default application.</p></div>
    </div>
    <div class="pdf-filmstrip-heading"><span>{{ dirty ? 'Unsaved changes · Save or discard before switching or moving' : 'Drag thumbnails to reorder pages' }}</span><span>{{ pages.length }} {{ pages.length === 1 ? 'page' : 'pages' }}</span></div>
    <ol class="pdf-filmstrip" aria-label="PDF pages in document order" @dragover.stop="stripDragOver" @drop.stop="drop" @dragleave="dragLeave">
      <li v-for="(page, index) in pages" :key="page.index" class="pdf-thumbnail" :class="{ active: index === active, dragging: dragged === index, 'insert-before': dropPosition === index, 'insert-after': dropPosition === pages.length && index === pages.length - 1 }" :draggable="!busy" @dragstart.stop="startDrag($event, index)" @dragend="endDrag" @dragover.stop="dragOver($event, index)" @drop.stop="drop" @dragleave="dragLeave">
        <button class="pdf-thumbnail-select" :disabled="busy" :aria-pressed="index === active" :aria-label="`Show PDF page ${index + 1}, original page ${page.index + 1}`" @click="active = index"><span class="pdf-thumbnail-image"><PdfCanvas v-if="document" :document="document" :page="page.index" :rotation="page.rotation" thumbnail @error="error = $event" /></span><span class="pdf-thumbnail-label">{{ index + 1 }}<span v-if="page.rotation"> · {{ page.rotation }}°</span></span></button>
        <span class="pdf-thumbnail-order"><button :disabled="busy || index === 0" :aria-label="`Move PDF page ${index + 1} earlier`" title="Move page earlier" @click="reorder(index, index - 1)"><i class="bi bi-chevron-left" aria-hidden="true" /></button><button :disabled="busy || index === pages.length - 1" :aria-label="`Move PDF page ${index + 1} later`" title="Move page later" @click="reorder(index, index + 2)"><i class="bi bi-chevron-right" aria-hidden="true" /></button></span>
      </li>
    </ol>
  </div>
</template>
