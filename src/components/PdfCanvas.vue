<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'

const props = withDefaults(defineProps<{
  document: PDFDocumentProxy; page: number; rotation: number; thumbnail?: boolean; zoom?: number
}>(), { thumbnail: false, zoom: 1 })
const emit = defineEmits<{ error: [message: string] }>()
const canvas = ref<HTMLCanvasElement>()
const surface = ref<HTMLElement>()
const rendering = ref(true)
let task: RenderTask | undefined
let observer: ResizeObserver | undefined
let resizeFrame = 0
let request = 0
let disposed = false

async function render() {
  const id = ++request
  const previous = task
  previous?.cancel()
  if (previous) await previous.promise.catch(() => {})
  if (disposed || id !== request || !canvas.value || !surface.value) return
  rendering.value = true
  try {
    const page = await props.document.getPage(props.page + 1)
    if (disposed || id !== request) return
    const base = page.getViewport({ scale: 1, rotation: (page.rotate + props.rotation) % 360 })
    const parent = surface.value.parentElement!
    const width = props.thumbnail ? 92 : Math.max(100, parent.clientWidth - 48)
    const height = props.thumbnail ? 112 : Math.max(100, parent.clientHeight - 48)
    const scale = Math.min(width / base.width, height / base.height) * props.zoom
    const viewport = page.getViewport({ scale, rotation: base.rotation })
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    const output = canvas.value
    output.width = Math.ceil(viewport.width * ratio)
    output.height = Math.ceil(viewport.height * ratio)
    output.style.width = `${viewport.width}px`
    output.style.height = `${viewport.height}px`
    task = page.render({ canvas: output, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] })
    await task.promise
  } catch (cause) {
    if (disposed || id !== request || (cause instanceof Error && cause.name === 'RenderingCancelledException')) return
    emit('error', cause instanceof Error ? cause.message : String(cause))
  } finally { if (id === request) rendering.value = false }
}
watch(() => [props.document, props.page, props.rotation, props.zoom], () => void render())
onMounted(async () => {
  await nextTick()
  if (disposed || !surface.value) return
  observer = new ResizeObserver(() => {
    cancelAnimationFrame(resizeFrame)
    resizeFrame = requestAnimationFrame(() => void render())
  })
  observer.observe(surface.value.parentElement!)
  void render()
})
onBeforeUnmount(() => { disposed = true; request++; task?.cancel(); observer?.disconnect(); cancelAnimationFrame(resizeFrame) })
</script>

<template>
  <div ref="surface" class="pdf-page-surface" :class="{ 'pdf-thumbnail-surface': thumbnail }" :aria-busy="rendering">
    <canvas ref="canvas" :aria-label="`PDF page ${page + 1}`" role="img" />
  </div>
</template>
