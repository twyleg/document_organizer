import { onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue'
import type { FileEntry, PdfDocumentData } from '../shared/types'
import { prepareRename } from './prepareRename'
import { inputContentKey as keyOf, matchingPreparation, type RenamePreparation } from './renamePreparation'
import { extractPdfText } from './pdfText'

interface TextStatus {
  key: string
  version?: string
  pageCount?: number
  phase: 'checking' | 'queued' | 'ocr' | 'preparing' | 'ready' | 'partial' | 'empty' | 'error'
  label: string
  detail: string
}


export function useInputOcr(files: Ref<FileEntry[]>, paused: Ref<boolean>, blockedPaths: Ref<Set<string>>, saved: (path: string, data: PdfDocumentData) => void) {
  const statuses = ref<Record<string, TextStatus>>({})
  const activePath = ref('')
  const prepared = shallowRef<Record<string, RenamePreparation>>({})
  const renamedPrepared = new Map<string, RenamePreparation>()
  let cancelPreparation: (() => void) | undefined
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
        let pageCount: number | undefined
        let version: string | undefined
        const current = () => files.value.find(file => file.path === entry.path && !file.transferPending && keyOf(file) === statusKey)
        const set = (phase: TextStatus['phase'], label: string, detail: string) => {
          statuses.value[entry.path] = { key: statusKey, version, pageCount, phase, label, detail }
        }
        set('checking', 'Checking text…', 'Checking every PDF page for embedded text.')
        activePath.value = entry.path
        try {
          const source = await window.files.readPdf(entry.path)
          version = source.version
          let coverage = await inspect(source)
          if (disposed || !current()) continue
          pageCount = coverage.total
          statuses.value[entry.path]!.pageCount = pageCount
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
            pageCount = coverage.total
          }
          if (disposed || !current()) continue
          set('preparing', 'Preparing rename…', 'Detecting dates and preparing filename autocomplete from the completed text check.')
          const preparation = prepareRename(coverage.pages)
          cancelPreparation = preparation.cancel
          const ready = await preparation.promise
          cancelPreparation = undefined
          if (disposed || !current()) continue
          prepared.value = { ...prepared.value, [entry.path]: { ...ready, pages: coverage.pages, version: result.version, key: statusKey } }
          const textPages = coverage.total - coverage.missing.length
          if (!coverage.missing.length) set('ready', 'Ready to rename', `Dates and autocomplete prepared. Embedded text found on all ${coverage.total} page(s).`)
          else set(textPages ? 'partial' : 'empty', textPages ? `Ready to rename · text on ${textPages}/${coverage.total} pages` : 'No text recognized',
            `OCR finished. No embedded text found on page(s) ${coverage.missing.join(', ')}. These may be blank pages or scans with unreadable text.`)
        } catch (cause) {
          if (!disposed && current()) {
            const detail = cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(cause)
            set('error', /not installed|could not find program|not found on the PATH/i.test(detail) ? 'OCR unavailable' : statuses.value[entry.path]?.phase === 'preparing' ? 'Rename preparation failed' : 'OCR check failed', detail)
          }
        } finally { cancelPreparation = undefined; activePath.value = '' }
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
    const validPrepared: Record<string, RenamePreparation> = {}
    for (const file of files.value) {
      const cached = renamedPrepared.get(file.path) ?? prepared.value[file.path]
      if (matchingPreparation(file, cached)) validPrepared[file.path] = cached!
      renamedPrepared.delete(file.path)
    }
    prepared.value = validPrepared
    const paths = new Set(files.value.map(file => file.path))
    for (const path of Object.keys(statuses.value)) if (!paths.has(path)) delete statuses.value[path]
    void pump()
  }, { immediate: true })
  onScopeDispose(() => { disposed = true; cancelCheck?.(); cancelPreparation?.() })
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
        const cached = matchingPreparation(source, prepared.value[source.path])
        if (cached) renamedPrepared.set(path, { ...cached, key: keyOf({ ...source, path, size: data.size, modified: data.modified }) })
        renamedStatuses.set(path, { ...status, key: keyOf({ ...source, path, size: data.size, modified: data.modified }) })
      }
    } catch { /* The normal input refresh will report or recheck an unreadable file. */ }
  }
  function pageCount(file: FileEntry) {
    const ready = matchingPreparation(file, prepared.value[file.path])
    if (ready) return ready.pages.length
    const status = statuses.value[file.path]
    return !file.transferPending && status?.key === keyOf(file) ? status.pageCount : undefined
  }
  return { statuses, prepared, activePath, retryErrors, carryRename, pageCount }
}
