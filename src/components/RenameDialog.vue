<script setup lang="ts">
import { computed, markRaw, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type { FileEntry } from '../../shared/types'
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist'
import { openTextPdf, readDocumentText } from '../pdfText'
import { findDocumentDates, type DateEvidence, type DateSuggestion } from '../documentDates'
import PdfCanvas from './PdfCanvas.vue'
import type { PdfTextHighlight } from '../pdfHighlights'
import { buildFilenameWords, filenameCompletions, type FilenameWord } from '../filenameCompletion'

const props = defineProps<{ entry: FileEntry; preview?: { url: string; kind: 'pdf' | 'image' } | null }>()
const emit = defineEmits<{ cancel: []; renamed: [path: string]; busy: [value: boolean] }>()
const panel = ref<HTMLElement>()
const input = ref<HTMLInputElement>()
const name = ref(props.entry.name)
const saving = ref(false)
const error = ref('')
const dates = ref<DateSuggestion[]>([])
const datesLoading = ref(/\.pdf$/i.test(props.entry.name))
const dateStage = ref<'loading' | 'dates' | 'filename'>(datesLoading.value ? 'loading' : 'filename')
const dateIndex = ref(0)
const extension = props.entry.name.lastIndexOf('.')
const fileExtension = extension > 0 ? props.entry.name.slice(extension) : ''
const datesError = ref('')
const pdf = shallowRef<PDFDocumentProxy>()
const page = ref(0)
const zoom = ref(1)
const previewError = ref('')
const selectedOccurrence = ref('')
const hoveredOccurrence = ref('')
const previewPane = ref<HTMLElement>()
let zoomAnchor: { x: number; y: number; page: number; zoom: number } | undefined
let wheelFocus: { x: number; y: number; page: number; time: number; cursorX: number; cursorY: number } | undefined
const words = shallowRef<FilenameWord[]>([])
const caret = ref({ start: 0, end: 0 })
const completionFocused = ref(false)
const completionDismissed = ref(false)
const completionIndex = ref(0)
const completions = computed(() => filenameCompletions(name.value, caret.value.start, caret.value.end, words.value))
const completionOpen = computed(() => completionFocused.value && !completionDismissed.value && !saving.value && completions.value.length > 0)
watch(completions, () => { completionIndex.value = 0 })
watch(page, () => { zoomAnchor = undefined; wheelFocus = undefined })
function updateCaret(reopen = false) {
  if (input.value) {
    const start = input.value.selectionStart ?? 0, end = input.value.selectionEnd ?? 0
    if (caret.value.start !== start || caret.value.end !== end) caret.value = { start, end }
  }
  if (reopen) completionDismissed.value = false
}
async function acceptCompletion(index = completionIndex.value) {
  const completion = completions.value[index]
  if (!completion) return
  name.value = completion.filename
  completionDismissed.value = true
  await nextTick()
  input.value?.focus()
  const position = completion.start + completion.value.length
  input.value?.setSelectionRange(position, position)
  updateCaret()
}
function completionKey(event: KeyboardEvent) {
  if (event.key === 'Enter' && (event.repeat || event.isComposing)) { event.preventDefault(); return }
  updateCaret()
  if (!completionOpen.value || event.ctrlKey || event.altKey || event.metaKey) return
  if ((event.key === 'Tab' && !event.shiftKey) || event.key === 'Enter') {
    event.preventDefault()
    void acceptCompletion()
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    completionIndex.value = (completionIndex.value + (event.key === 'ArrowDown' ? 1 : -1) + completions.value.length) % completions.value.length
    void nextTick(() => panel.value?.querySelector('.filename-completion[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }))
  } else if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    completionDismissed.value = true
  }
}
const isPdf = /\.pdf$/i.test(props.entry.name)
const occurrenceId = (evidence: DateEvidence) => `${evidence.page}:${evidence.start}:${evidence.end}`
const dateColors = computed(() => {
  const parents = new Map(dates.value.map(date => [date.prefix, date.prefix]))
  const root = (prefix: string): string => parents.get(prefix) === prefix ? prefix : root(parents.get(prefix)!)
  const occurrences = new Map<string, string>()
  for (const date of dates.value) for (const evidence of date.evidence) {
    const id = occurrenceId(evidence)
    const previous = occurrences.get(id)
    if (previous) parents.set(root(date.prefix), root(previous))
    else occurrences.set(id, date.prefix)
  }
  const palette = ['#b45309', '#7c3aed', '#007f73', '#c03966', '#2563eb', '#be4b0a', '#627408', '#a13782']
  const groups = new Map<string, string>()
  return new Map(dates.value.map(date => {
    const group = root(date.prefix)
    if (!groups.has(group)) groups.set(group, palette[groups.size] ?? `hsl(${(groups.size * 137.508) % 360} 65% 38%)`)
    return [date.prefix, groups.get(group)!]
  }))
})
const highlights = computed(() => {
  const regions = new Map<string, PdfTextHighlight>()
  for (const date of dates.value) for (const evidence of date.evidence) {
    if (evidence.page !== page.value + 1) continue
    const id = occurrenceId(evidence)
    const previous = regions.get(id)
    if (previous) { if (!previous.label.includes(date.prefix)) previous.label += ` / ${date.prefix}`; continue }
    regions.set(id, { id, start: evidence.start, end: evidence.end, color: dateColors.value.get(date.prefix)!,
      label: `${evidence.text} → ${date.prefix}`, selected: selectedOccurrence.value === id, hovered: hoveredOccurrence.value === id })
  }
  return [...regions.values()]
})
let disposed = false
let textTask: PDFDocumentLoadingTask | undefined
async function loadDates() {
  if (!datesLoading.value) return
  try {
    const data = await window.files.readPdf(props.entry.path)
    if (disposed) return
    const loaded = await openTextPdf(data, task => { textTask = task })
    if (disposed) { await loaded.task.destroy(); return }
    pdf.value = markRaw(loaded.pdf)
    const text = await readDocumentText(loaded.pdf)
    if (!disposed) {
      dates.value = findDocumentDates(text.pages)
      words.value = buildFilenameWords(text.pages)
      const first = dates.value[0]?.evidence[0]
      if (first) {
        name.value = dates.value[0]!.prefix + fileExtension
        dateStage.value = 'dates'
        datesLoading.value = false
        page.value = first.page - 1
        selectedOccurrence.value = occurrenceId(first)
        if (dates.value.length === 1) await usePrefix(dates.value[0]!.prefix)
        else {
          await nextTick()
          if (!disposed) panel.value?.querySelector<HTMLButtonElement>('.rename-date-option')?.focus()
        }
      }
    }
  } catch (cause) {
    if (!disposed) datesError.value = cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(cause)
  } finally {
    datesLoading.value = false
    if (!disposed && dateStage.value === 'loading') {
      dateStage.value = 'filename'
      await focusFilename(true)
    }
  }
}
async function focusFilename(selectStem = false) {
  await nextTick()
  if (disposed) return
  input.value?.focus()
  if (selectStem) {
    const end = name.value.lastIndexOf('.')
    input.value?.setSelectionRange(0, end > 0 ? end : name.value.length)
  }
  updateCaret()
}
function dateKey(event: KeyboardEvent) {
  if (!['ArrowUp', 'ArrowDown', 'Enter'].includes(event.key) || event.ctrlKey || event.altKey || event.metaKey) return
  if (!(event.target instanceof Element) || !event.target.closest('.rename-date-option')) return
  event.preventDefault()
  if (event.key === 'Enter') {
    if (!event.repeat) void usePrefix(dates.value[dateIndex.value]!.prefix)
    return
  }
  dateIndex.value = (dateIndex.value + (event.key === 'ArrowDown' ? 1 : -1) + dates.value.length) % dates.value.length
  const date = dates.value[dateIndex.value]!
  name.value = date.prefix + name.value.replace(/^\d{8}_/, '')
  const evidence = date.evidence[0]!
  page.value = evidence.page - 1
  selectedOccurrence.value = occurrenceId(evidence)
  void nextTick(() => {
    const button = panel.value?.querySelectorAll<HTMLButtonElement>('.rename-date-option')[dateIndex.value]
    button?.focus({ preventScroll: true })
    button?.scrollIntoView({ block: 'nearest' })
  })
}
async function usePrefix(prefix: string, evidence = dates.value.find(date => date.prefix === prefix)?.evidence[0]) {
  if (evidence) { page.value = evidence.page - 1; selectedOccurrence.value = occurrenceId(evidence) }
  name.value = prefix + name.value.replace(/^\d{8}_/, '')
  dateStage.value = 'filename'
  await nextTick()
  input.value?.focus()
  const extension = name.value.lastIndexOf('.')
  input.value?.setSelectionRange(prefix.length, extension >= prefix.length ? extension : name.value.length)
  completionDismissed.value = true
  updateCaret()
}
async function hoverDate(date: DateSuggestion, evidence = date.evidence.find(item => item.page === page.value + 1) ?? date.evidence[0]) {
  if (!evidence) return
  page.value = evidence.page - 1
  hoveredOccurrence.value = occurrenceId(evidence)
  await nextTick()
  revealHovered()
}
function revealHovered() {
  const pane = previewPane.value
  const marker = pane?.querySelector<HTMLElement>('.pdf-date-highlight.is-hovered')
  if (!pane || !marker) return
  const box = marker.getBoundingClientRect(), view = pane.getBoundingClientRect()
  if (box.top < view.top || box.bottom > view.top + pane.clientHeight) pane.scrollTop += box.top - view.top - pane.clientHeight / 2 + box.height / 2
  if (box.left < view.left || box.right > view.left + pane.clientWidth) pane.scrollLeft += box.left - view.left - pane.clientWidth / 2 + box.width / 2
}
function setZoom(value: number, cursor?: { x: number; y: number }) {
  const next = Math.min(3, Math.max(.5, value))
  if (next === zoom.value) return
  if (cursor) hoveredOccurrence.value = ''
  const pane = previewPane.value
  const frame = pane?.querySelector('.pdf-page-frame')?.getBoundingClientRect()
  if (pane && frame?.width && frame.height) {
    const view = pane.getBoundingClientRect()
    const point = cursor ?? { x: view.left + pane.clientWidth / 2, y: view.top + pane.clientHeight / 2 }
    const now = performance.now()
    const continuing = cursor && wheelFocus && wheelFocus.page === page.value && now - wheelFocus.time < 250 &&
      Math.hypot(cursor.x - wheelFocus.cursorX, cursor.y - wheelFocus.cursorY) < 8
    const focus = continuing ? wheelFocus! : {
      x: Math.min(1, Math.max(0, (point.x - frame.left) / frame.width)),
      y: Math.min(1, Math.max(0, (point.y - frame.top) / frame.height)) }
    zoomAnchor = { x: focus.x, y: focus.y, page: page.value, zoom: next }
    wheelFocus = cursor ? { ...focus, page: page.value, time: now, cursorX: cursor.x, cursorY: cursor.y } : undefined
    pane.style.setProperty('--zoom-pad-x', `${pane.clientWidth / 2}px`)
    pane.style.setProperty('--zoom-pad-y', `${pane.clientHeight / 2}px`)
  }
  zoom.value = next
}
function previewRendered() {
  const pane = previewPane.value
  const frame = pane?.querySelector('.pdf-page-frame')?.getBoundingClientRect()
  if (pane && frame && zoomAnchor?.page === page.value && zoomAnchor.zoom === zoom.value) {
    const view = pane.getBoundingClientRect()
    pane.scrollLeft += frame.left - view.left - pane.clientLeft + frame.width * zoomAnchor.x - pane.clientWidth / 2
    pane.scrollTop += frame.top - view.top - pane.clientTop + frame.height * zoomAnchor.y - pane.clientHeight / 2
    zoomAnchor = undefined
  }
  revealHovered()
}
function wheelZoom(event: WheelEvent) {
  if (!event.ctrlKey) return
  event.preventDefault()
  if (event.deltaY) setZoom(zoom.value + (event.deltaY < 0 ? .25 : -.25), { x: event.clientX, y: event.clientY })
}
function cancel(event?: Event) {
  event?.preventDefault()
  if (!saving.value) emit('cancel')
}
async function apply() {
  if (saving.value || dateStage.value === 'loading') return
  if (dateStage.value === 'dates') { await usePrefix(dates.value[dateIndex.value]!.prefix); return }
  if (completionOpen.value) { await acceptCompletion(); return }
  saving.value = true
  emit('busy', true)
  error.value = ''
  try { emit('renamed', await window.files.renameFile(props.entry.path, name.value)) }
  catch (cause) {
    error.value = cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(cause)
    saving.value = false
    emit('busy', false)
    await nextTick()
    input.value?.focus()
  }
}
onMounted(async () => {
  if (isPdf) { panel.value?.focus(); void loadDates() }
  else await focusFilename(true)
})
onBeforeUnmount(() => {
  emit('busy', false)
  disposed = true
  void textTask?.destroy()
})
</script>

<template>
  <div ref="panel" class="rename-panel" tabindex="-1" aria-labelledby="rename-title" @keydown.esc="cancel" @keydown.stop>
    <form class="rename-layout" @submit.prevent="apply">
      <div class="rename-fields">
      <div class="rename-heading"><span class="rename-icon"><i class="bi bi-pencil" aria-hidden="true" /></span><h2 id="rename-title">Rename document</h2></div>
      <p class="rename-current" :title="entry.name">{{ entry.name }}</p>
      <label for="rename-name">New filename</label>
      <div class="filename-input-wrap">
        <input id="rename-name" ref="input" v-model="name" type="text" :disabled="saving || dateStage === 'loading'" required autocomplete="off" spellcheck="false" role="combobox" aria-autocomplete="list" :aria-expanded="completionOpen" aria-controls="filename-completions" :aria-activedescendant="completionOpen ? `filename-completion-${completionIndex}` : undefined" :aria-invalid="!!error" :aria-describedby="error ? 'rename-error' : 'rename-hint'" @input="updateCaret(true)" @select="updateCaret()" @click="updateCaret(true)" @keyup="updateCaret()" @focus="completionFocused = true; dateStage = 'filename'" @blur="completionFocused = false" @keydown="completionKey" />
        <ul v-if="completionOpen" id="filename-completions" class="filename-completions" role="listbox" aria-label="Completions from document text">
          <li v-for="(completion, index) in completions" :id="`filename-completion-${index}`" :key="completion.value" class="filename-completion" role="option" :aria-selected="index === completionIndex" @mousedown.prevent @mouseenter="completionIndex = index" @click="acceptCompletion(index)"><span>{{ completion.label }}</span><small>{{ completion.filename }}</small></li>
        </ul>
      </div>
      <p id="rename-hint" class="rename-hint">↑/↓ to choose · Enter to accept suggestion or rename · Tab also completes · Esc to dismiss or cancel</p>
      <section v-if="isPdf" class="rename-dates" aria-labelledby="rename-dates-title">
        <h3 id="rename-dates-title">Date prefixes from this document</h3>
        <p v-if="datesLoading" class="rename-date-message" role="status">Finding dates…</p>
        <p v-else-if="datesError" class="rename-date-message">Date suggestions unavailable: {{ datesError }}</p>
        <p v-else-if="!dates.length" class="rename-date-message">No complete dates found in the embedded text.</p>
        <template v-else>
          <p class="rename-date-message">↑/↓ to choose a date · Enter to confirm and edit the filename. The extension is kept. Ambiguous dates show both interpretations.</p>
          <ul class="rename-date-list" aria-label="Recommended date prefixes" @keydown="dateKey">
            <li v-for="(date, index) in dates" :key="date.prefix" :style="{ '--date-color': dateColors.get(date.prefix) }">
              <button type="button" class="rename-date-option" :disabled="saving" :aria-pressed="name.startsWith(date.prefix)" :title="date.evidence.map(item => `Page ${item.page}: ${item.context}`).join('\n')" @mouseenter="hoverDate(date)" @mouseleave="hoveredOccurrence = ''" @focus="dateIndex = index; dateStage = 'dates'; hoverDate(date)" @blur="hoveredOccurrence = ''" @click="usePrefix(date.prefix)">
                <code>{{ date.prefix }}</code>
                <span>{{ date.evidence[0]!.text }} · page {{ date.evidence[0]!.page }}<span v-if="date.evidence.some(item => item.ambiguous)"> · ambiguous</span></span>
              </button>
              <div v-if="date.evidence.length > 1" class="rename-date-occurrences" aria-label="Date occurrences">
                <button v-for="(evidence, index) in date.evidence" :key="occurrenceId(evidence)" type="button" :disabled="saving" :aria-pressed="selectedOccurrence === occurrenceId(evidence)" :title="evidence.context" @mouseenter="hoverDate(date, evidence)" @mouseleave="hoveredOccurrence = ''" @focus="hoverDate(date, evidence)" @blur="hoveredOccurrence = ''" @click="usePrefix(date.prefix, evidence)">Page {{ evidence.page }} · {{ index + 1 }}</button>
              </div>
            </li>
          </ul>
        </template>
      </section>
      <p v-if="error" id="rename-error" class="error-message" role="alert">{{ error }}</p>
      <div class="rename-actions"><button class="rename-cancel" type="button" :disabled="saving" @click="cancel()">Cancel</button><button class="pdf-save" type="submit" :disabled="saving || !name.trim()">{{ saving ? 'Renaming…' : 'Rename' }}</button></div>
      </div>
      <section class="rename-preview" aria-label="Document with highlighted dates">
        <div v-if="isPdf" class="rename-preview-toolbar">
          <button type="button" class="icon-button" :disabled="!pdf || page === 0" aria-label="Previous rename preview page" @click="page--"><i class="bi bi-chevron-left" aria-hidden="true" /></button>
          <span>Page {{ pdf ? page + 1 : '–' }} / {{ pdf?.numPages ?? '–' }}</span>
          <button type="button" class="icon-button" :disabled="!pdf || page === (pdf?.numPages ?? 0) - 1" aria-label="Next rename preview page" @click="page++"><i class="bi bi-chevron-right" aria-hidden="true" /></button>
          <span class="rename-preview-spacer" />
          <button type="button" class="icon-button" :disabled="!pdf || zoom <= .5" aria-label="Zoom out rename preview" @click="setZoom(zoom - .25)"><i class="bi bi-dash" aria-hidden="true" /></button>
          <button type="button" class="pdf-fit-button" :disabled="!pdf" title="Fit page" @click="setZoom(1)">{{ Math.round(zoom * 100) }}%</button>
          <button type="button" class="icon-button" :disabled="!pdf || zoom >= 3" aria-label="Zoom in rename preview" @click="setZoom(zoom + .25)"><i class="bi bi-plus" aria-hidden="true" /></button>
        </div>
        <p v-if="previewError" class="error-message" role="alert">{{ previewError }}</p>
        <div ref="previewPane" class="rename-preview-page" :class="{ 'is-zoomed': zoom > 1 }" @wheel="wheelZoom">
          <PdfCanvas v-if="pdf" :document="pdf" :page="page" :rotation="0" :zoom="zoom" :highlights="highlights" @error="previewError = $event" @rendered="previewRendered" />
          <div v-else-if="preview?.kind === 'image'" class="image-viewer"><img :src="preview.url" :alt="entry.name" /></div>
          <div v-else class="empty-state"><p>{{ datesLoading ? 'Loading PDF…' : 'PDF preview unavailable.' }}</p></div>
        </div>
        <p v-if="isPdf" class="rename-preview-hint">Matching colors mark the dates on this page. Choose a date to show its location. Ctrl + scroll to zoom.</p>
      </section>
    </form>
  </div>
</template>
