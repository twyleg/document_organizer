<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import { TextLayer } from 'pdfjs-dist'
import type { PdfTextHighlight } from '../pdfHighlights'

const props = withDefaults(
  defineProps<{
    document: PDFDocumentProxy
    page: number
    rotation: number
    thumbnail?: boolean
    zoom?: number
    highlights?: PdfTextHighlight[]
  }>(),
  { thumbnail: false, zoom: 1, highlights: () => [] }
)
const emit = defineEmits<{ error: [message: string]; rendered: [] }>()
const highlightById = computed(
  () => new Map(props.highlights.map((highlight) => [highlight.id, highlight]))
)
const canvas = ref<HTMLCanvasElement>()
const surface = ref<HTMLElement>()
const textContainer = ref<HTMLElement>()
const frame = ref<HTMLElement>()
const dimensions = ref({ width: 0, height: 0 })
const boxes = ref<
  (PdfTextHighlight & { left: number; top: number; width: number; height: number; key: string })[]
>([])
const rendering = ref(true)
let task: RenderTask | undefined
let textLayer: TextLayer | undefined
let observer: ResizeObserver | undefined
let resizeFrame = 0
let request = 0
let disposed = false

async function render() {
  const id = ++request
  const previous = task
  textLayer?.cancel()
  previous?.cancel()
  if (previous) {
    await previous.promise.catch(() => {})
  }
  if (disposed || id !== request || !canvas.value || !surface.value) {
    return
  }

  rendering.value = true
  boxes.value = []

  try {
    const page = await props.document.getPage(props.page + 1)
    if (disposed || id !== request) {
      return
    }

    const base = page.getViewport({ scale: 1, rotation: (page.rotate + props.rotation) % 360 })
    const parent = surface.value.parentElement!
    // Use the stable viewport bounds: appearing scrollbars must not change the
    // fit scale halfway through a zoom and move the document under the cursor.
    const bounds = parent.getBoundingClientRect()
    const width = props.thumbnail ? 92 : Math.max(100, bounds.width - 48)
    const height = props.thumbnail ? 112 : Math.max(100, bounds.height - 48)
    const scale = Math.min(width / base.width, height / base.height) * props.zoom
    const viewport = page.getViewport({ scale, rotation: base.rotation })
    dimensions.value = { width: viewport.width, height: viewport.height }
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    const output = canvas.value
    output.width = Math.ceil(viewport.width * ratio)
    output.height = Math.ceil(viewport.height * ratio)
    output.style.width = `${viewport.width}px`
    output.style.height = `${viewport.height}px`
    task = page.render({
      canvas: output,
      viewport,
      transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0]
    })
    await task.promise
    if (
      disposed ||
      id !== request ||
      !props.highlights.length ||
      !textContainer.value ||
      !frame.value
    ) {
      return
    }

    const content = await page.getTextContent()
    if (disposed || id !== request) {
      return
    }

    const container = textContainer.value
    container.replaceChildren()
    container.style.setProperty('--total-scale-factor', String(scale))
    textLayer = new TextLayer({ textContentSource: content, container, viewport })
    await textLayer.render()
    if (disposed || id !== request) {
      return
    }

    await nextTick()
    const origin = frame.value.getBoundingClientRect()
    const mapped: { element: HTMLElement; start: number; end: number }[] = []
    let offset = 0
    let itemIndex = 0

    for (const item of content.items) {
      if (!('str' in item)) {
        continue
      }

      mapped.push({
        element: textLayer.textDivs[itemIndex++]!,
        start: offset,
        end: offset + item.str.length
      })
      offset += item.str.length + 1
    }

    const found: typeof boxes.value = []

    for (const highlight of props.highlights) {
      const rectangles: { left: number; top: number; right: number; bottom: number }[] = []

      for (const span of mapped) {
        const start = Math.max(highlight.start, span.start) - span.start
        const end = Math.min(highlight.end, span.end) - span.start
        const node = span.element.firstChild
        if (start >= end || !node) {
          continue
        }

        const range = document.createRange()
        range.setStart(node, start)
        range.setEnd(node, end)

        for (const rect of Array.from(range.getClientRects())) {
          if (!rect.width || !rect.height) {
            continue
          }

          const previous = rectangles.at(-1)
          if (
            previous &&
            ((Math.abs(previous.top - rect.top) < 3 && rect.left - previous.right < 10) ||
              (Math.abs(previous.left - rect.left) < 3 && rect.top - previous.bottom < 10))
          ) {
            previous.left = Math.min(previous.left, rect.left)
            previous.top = Math.min(previous.top, rect.top)
            previous.right = Math.max(previous.right, rect.right)
            previous.bottom = Math.max(previous.bottom, rect.bottom)
          } else {
            rectangles.push({
              left: rect.left,
              top: rect.top,
              right: rect.right,
              bottom: rect.bottom
            })
          }
        }
      }

      rectangles.forEach((rect, index) =>
        found.push({
          ...highlight,
          key: `${highlight.id}-${index}`,
          left: rect.left - origin.left - 2,
          top: rect.top - origin.top - 2,
          width: rect.right - rect.left + 4,
          height: rect.bottom - rect.top + 4
        })
      )
    }

    boxes.value = found
  } catch (cause) {
    if (
      disposed ||
      id !== request ||
      (cause instanceof Error && cause.name === 'RenderingCancelledException')
    ) {
      return
    }

    emit('error', cause instanceof Error ? cause.message : String(cause))
  } finally {
    await nextTick()
    if (!disposed && id === request) {
      rendering.value = false
      emit('rendered')
    }
  }
}

watch(
  () => [
    props.document,
    props.page,
    props.rotation,
    props.zoom,
    props.highlights.map((item) => `${item.id}:${item.start}:${item.end}:${item.color}`).join('|')
  ],
  () => void render()
)

onMounted(async () => {
  await nextTick()
  if (disposed || !surface.value) {
    return
  }

  observer = new ResizeObserver(() => {
    cancelAnimationFrame(resizeFrame)
    resizeFrame = requestAnimationFrame(() => void render())
  })
  observer.observe(surface.value.parentElement!)
  void render()
})

onBeforeUnmount(() => {
  disposed = true
  request++
  task?.cancel()
  textLayer?.cancel()
  observer?.disconnect()
  cancelAnimationFrame(resizeFrame)
})
</script>

<template>
  <div
    ref="surface"
    class="pdf-page-surface"
    :class="{ 'pdf-thumbnail-surface': thumbnail }"
    :aria-busy="rendering"
  >
    <div
      ref="frame"
      class="pdf-page-frame"
      :style="{ width: `${dimensions.width}px`, height: `${dimensions.height}px` }"
    >
      <canvas
        ref="canvas"
        :aria-label="`PDF page ${page + 1}`"
        role="img"
      />
      <div
        ref="textContainer"
        class="pdf-highlight-text-layer"
        aria-hidden="true"
      />
      <span
        v-for="box in boxes"
        :key="box.key"
        class="pdf-date-highlight"
        :class="{
          'is-selected': highlightById.get(box.id)?.selected,
          'is-hovered': highlightById.get(box.id)?.hovered
        }"
        :data-date-id="box.id"
        :title="box.label"
        role="img"
        :aria-label="box.label"
        :style="{
          left: `${box.left}px`,
          top: `${box.top}px`,
          width: `${box.width}px`,
          height: `${box.height}px`,
          '--date-color': box.color
        }"
      />
    </div>
  </div>
</template>
