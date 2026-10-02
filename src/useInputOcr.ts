import { onScopeDispose, ref, watch, type Ref } from 'vue'
import type { FileEntry, PdfDocumentData } from '../shared/types'
import { getDocument } from './pdfRendering'

interface TextStatus {
  key: string
  phase: 'checking' | 'queued' | 'ocr' | 'ready' | 'partial' | 'empty' | 'error'
  label: string
  detail: string
}

const keyOf = (file: FileEntry) => `${file.path}\0${file.size}\0${file.modified}`

export function useInputOcr(files: Ref<FileEntry[]>, paused: Ref<boolean>, saved: (path: string, data: PdfDocumentData) => void) {
  const statuses = ref<Record<string, TextStatus>>({})
  const activePath = ref('')
  let running = false
  let disposed = false
  let cancelCheck: (() => void) | undefined

  async function inspect(data: PdfDocumentData) {
    const base = new URL('./pdf-assets/', window.location.href).href
    const task = getDocument({ data: new Uint8Array(data.data), cMapUrl: `${base}cmaps/`, cMapPacked: true,
      standardFontDataUrl: `${base}standard_fonts/`, wasmUrl: `${base}wasm/`, iccUrl: `${base}iccs/`, stopAtErrors: true })
    let protectedPdf = false
    task.onPassword = () => { protectedPdf = true; void task.destroy() }
    cancelCheck = () => { void task.destroy() }
    try {
      const pdf = await task.promise
      const missing: number[] = []
      for (let index = 1; index <= pdf.numPages; index++) {
        const page = await pdf.getPage(index)
        const content = await page.getTextContent()
        if (!content.items.some(item => 'str' in item && /\S/u.test(item.str))) missing.push(index)
        page.cleanup()
      }
      return { total: pdf.numPages, missing }
    } catch (cause) {
      if (protectedPdf) throw new Error('Password-protected PDF: automatic OCR is unavailable.')
      throw cause
    } finally { cancelCheck = undefined; await task.destroy() }
  }

  async function pump() {
    if (running || disposed) return
    running = true
    try {
      while (!disposed && !paused.value) {
        const entry = files.value.find(file => /\.pdf$/i.test(file.name) &&
          (statuses.value[file.path]?.key !== keyOf(file) || statuses.value[file.path]?.phase === 'queued'))
        if (!entry) break
        const key = keyOf(entry)
        let statusKey = key
        const current = () => files.value.find(file => file.path === entry.path && keyOf(file) === statusKey)
        const set = (phase: TextStatus['phase'], label: string, detail: string) => {
          statuses.value[entry.path] = { key: statusKey, phase, label, detail }
        }
        set('checking', 'Checking text…', 'Checking every PDF page for embedded text.')
        try {
          const source = await window.files.readPdf(entry.path)
          let coverage = await inspect(source)
          if (disposed || !current()) continue
          let result = source
          if (coverage.missing.length) {
            if (paused.value) { set('queued', 'OCR queued', 'OCR will start after the current edit or file operation finishes.'); break }
            set('ocr', 'Running OCR…', 'Adding searchable German and English text to pages without embedded text.')
            activePath.value = entry.path
            result = await window.files.ocrPdf(entry.path, source.version)
            if (disposed) break
            saved(entry.path, result)
            statusKey = keyOf({ ...entry, size: result.size, modified: result.modified })
            coverage = await inspect(result)
          }
          const textPages = coverage.total - coverage.missing.length
          if (!coverage.missing.length) set('ready', 'Text available', `Embedded text found on all ${coverage.total} page(s). It may be original text or OCR text.`)
          else set(textPages ? 'partial' : 'empty', textPages ? `Text on ${textPages}/${coverage.total} pages` : 'No text recognized',
            `OCR finished. No embedded text found on page(s) ${coverage.missing.join(', ')}. These may be blank pages or scans with unreadable text.`)
        } catch (cause) {
          if (!disposed && current()) {
            const detail = cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(cause)
            set('error', /not installed|could not find program|not found on the PATH/i.test(detail) ? 'OCR unavailable' : 'OCR check failed', detail)
          }
        } finally { activePath.value = '' }
      }
    } finally { running = false }
  }
  watch([() => files.value.map(keyOf).join('\n'), paused], () => {
    const paths = new Set(files.value.map(file => file.path))
    for (const path of Object.keys(statuses.value)) if (!paths.has(path)) delete statuses.value[path]
    void pump()
  }, { immediate: true })
  onScopeDispose(() => { disposed = true; cancelCheck?.() })
  function retryErrors() {
    for (const [path, status] of Object.entries(statuses.value)) if (status.phase === 'error') delete statuses.value[path]
    void pump()
  }
  return { statuses, activePath, retryErrors }
}
