import { onScopeDispose, ref, watch, type Ref } from 'vue'
import type { FileEntry, PdfDocumentData } from '../shared/types'
import { extractPdfText } from './pdfText'

interface TextStatus {
  key: string
  version?: string
  phase: 'checking' | 'queued' | 'ocr' | 'ready' | 'partial' | 'empty' | 'error'
  label: string
  detail: string
}

const keyOf = (file: FileEntry) => `${file.path}\0${file.size}\0${file.modified}`

export function useInputOcr(files: Ref<FileEntry[]>, paused: Ref<boolean>, blockedPaths: Ref<Set<string>>, saved: (path: string, data: PdfDocumentData) => void) {
  const statuses = ref<Record<string, TextStatus>>({})
  const activePath = ref('')
  const renamedStatuses = new Map<string, TextStatus>()
  let running = false
  let disposed = false
  let cancelCheck: (() => void) | undefined

  async function inspect(data: PdfDocumentData) {
    try {
      return await extractPdfText(data, task => { cancelCheck = () => { void task.destroy() } })
    } finally { cancelCheck = undefined }
  }

  async function pump() {
    if (running || disposed) return
    running = true
    try {
      while (!disposed && !paused.value) {
        const entry = files.value.find(file => /\.pdf$/i.test(file.name) && !file.transferPending && !blockedPaths.value.has(file.path) &&
          (statuses.value[file.path]?.key !== keyOf(file) || statuses.value[file.path]?.phase === 'queued'))
        if (!entry) break
        const key = keyOf(entry)
        let statusKey = key
        let version: string | undefined
        const current = () => files.value.find(file => file.path === entry.path && !file.transferPending && keyOf(file) === statusKey)
        const set = (phase: TextStatus['phase'], label: string, detail: string) => {
          statuses.value[entry.path] = { key: statusKey, version, phase, label, detail }
        }
        set('checking', 'Checking text…', 'Checking every PDF page for embedded text.')
        activePath.value = entry.path
        try {
          const source = await window.files.readPdf(entry.path)
          version = source.version
          let coverage = await inspect(source)
          if (disposed || !current()) continue
          let result = source
          if (coverage.missing.length) {
            if (paused.value || blockedPaths.value.has(entry.path)) {
              set('queued', 'OCR queued', 'OCR will start after the current edit or file operation finishes.')
              if (paused.value) break
              continue
            }
            set('ocr', 'Running OCR…', 'Adding searchable German and English text to pages without embedded text.')
            activePath.value = entry.path
            result = await window.files.ocrPdf(entry.path, source.version)
            version = result.version
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
  watch([() => files.value.map(file => `${keyOf(file)}\0${!!file.transferPending}`).join('\n'), paused, () => [...blockedPaths.value].join('\n')], () => {
    for (const file of files.value) {
      const transferred = renamedStatuses.get(file.path)
      if (!transferred) continue
      if (transferred.key === keyOf(file)) statuses.value[file.path] = transferred
      renamedStatuses.delete(file.path)
    }
    const paths = new Set(files.value.map(file => file.path))
    for (const path of Object.keys(statuses.value)) if (!paths.has(path)) delete statuses.value[path]
    void pump()
  }, { immediate: true })
  onScopeDispose(() => { disposed = true; cancelCheck?.() })
  function retryErrors() {
    for (const [path, status] of Object.entries(statuses.value)) if (status.phase === 'error') delete statuses.value[path]
    void pump()
  }
  async function carryRename(source: FileEntry, path: string) {
    const status = statuses.value[source.path]
    if (!/\.pdf$/i.test(path) || status?.key !== keyOf(source) || !status.version ||
        !['ready', 'partial', 'empty'].includes(status.phase)) return
    try {
      // Renaming uses a copy and changes the modification time. Retain completed
      // recognition only when the renamed PDF still has the same contents.
      const data = await window.files.readPdf(path)
      if (data.version === status.version) {
        renamedStatuses.set(path, { ...status, key: keyOf({ ...source, path, size: data.size, modified: data.modified }) })
      }
    } catch { /* The normal input refresh will report or recheck an unreadable file. */ }
  }
  return { statuses, activePath, retryErrors, carryRename }
}
