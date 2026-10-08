import { computed, onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue'
import type { ArchiveIndexProgress, DirectoryListing, FileEntry } from '../shared/types'
import { createArchiveMatcher } from './archiveMatcher'
import { type ArchiveSuggestion, type ArchiveIndex } from '../shared/archiveSimilarity'
import { inputContentKey, matchingPreparation, type RenamePreparation } from './renamePreparation'
import { extractPdfText } from './pdfText'
import { destinationsFromSimilarity, recommendFolders, type ArchiveTarget } from './folderTargets'

export function useArchiveTargets(archive: Ref<DirectoryListing | null>, revision: Ref<number>, selected: Ref<FileEntry | undefined>, textReady: Ref<boolean>, prepared: Ref<Record<string, RenamePreparation>>, inputFiles: Ref<FileEntry[]>) {
  const explain = (cause: unknown) => cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(cause)
  const folders = ref<ArchiveTarget[]>([])
  const loading = ref(false)
  const error = ref('')
  const text = ref('')
  const pages = ref<string[]>([])
  const index = shallowRef<ArchiveIndex | null>(null)
  const indexLoading = ref(false)
  const indexError = ref('')
  const indexProgress = ref<ArchiveIndexProgress | null>(null)
  let activeIndexRequest = ''
  const unsubscribeProgress = window.files?.onArchiveIndexProgress(event => {
    if (event.requestId === activeIndexRequest) indexProgress.value = event
  })
  let indexGeneration = 0
  async function refreshIndex(rebuild = true) {
    const id = ++indexGeneration, root = archive.value?.path
    activeIndexRequest = crypto.randomUUID()
    indexProgress.value = null
    indexLoading.value = !!root; indexError.value = ''
    if (!root) { index.value = null; indexLoading.value = false; return }
    try {
      const result = await window.files.archiveIndex(root, rebuild, activeIndexRequest)
      if (id === indexGeneration) index.value = result
    } catch (cause) { if (id === indexGeneration) indexError.value = explain(cause) }
    finally { if (id === indexGeneration) indexLoading.value = false }
  }
  watch(() => archive.value?.path, () => { index.value = null; void refreshIndex(false) }, { immediate: true })
  const selectedSuggestion = shallowRef<{ key: string; result: ArchiveSuggestion } | null>(null)
  const inputSuggestions = shallowRef<Record<string, { key: string; result: ArchiveSuggestion }>>({})
  let inputMatchingGeneration = 0
  const suggestions = computed(() => {
    const file = selected.value
    const cached = file ? inputSuggestions.value[file.path] : undefined
    return file && cached?.key === inputContentKey(file) && !file.transferPending ? cached.result : file && selectedSuggestion.value?.key === inputContentKey(file) ? selectedSuggestion.value.result : null
  })
  const matchingLoading = ref(false)
  const matchingError = ref('')
  let matchingGeneration = 0
  let matcher: ReturnType<typeof createArchiveMatcher> | undefined
  let fitReady: Promise<unknown> = Promise.resolve()
  watch(index, value => {
    matcher?.dispose()
    inputMatchingGeneration++
    inputSuggestions.value = {}
    matcher = undefined
    selectedSuggestion.value = null
    if (!value) return
    try {
      matcher = createArchiveMatcher(new Worker(new URL('./archiveMatching.worker.ts', import.meta.url), { type: 'module' }))
      fitReady = matcher.fit(value.documents)
      // Queries report failures; attach a handler even if no input is selected.
      void fitReady.catch(cause => { if (index.value === value) matchingError.value = explain(cause) })
    } catch (cause) { matchingError.value = explain(cause) }
  }, { flush: 'sync' })
  watch([index, pages], async () => {
    const id = ++matchingGeneration, activeMatcher = matcher
    selectedSuggestion.value = null
    matchingError.value = ''
    matchingLoading.value = false
    const file = selected.value
    if (!activeMatcher || !file || !pages.value.length) return
    const queryPages = pages.value, cacheKey = inputContentKey(file)
    matchingLoading.value = true
    try {
      await fitReady
      if (id !== matchingGeneration) return
      const result = await activeMatcher.suggest(queryPages, cacheKey)
      if (id === matchingGeneration) selectedSuggestion.value = { key: cacheKey, result }
    } catch (cause) { if (id === matchingGeneration) matchingError.value = explain(cause) }
    finally { if (id === matchingGeneration) matchingLoading.value = false }
  })
  // Prepare destinations for every completed input, so a row need not be selected first.
  watch([index, prepared, () => inputFiles.value.map(file => `${inputContentKey(file)}:${!!file.transferPending}`).join('\n')], async () => {
    const id = ++inputMatchingGeneration, activeMatcher = matcher
    const retained: typeof inputSuggestions.value = {}
    for (const file of inputFiles.value) {
      const old = inputSuggestions.value[file.path]
      if (old?.key === inputContentKey(file) && !file.transferPending) retained[file.path] = old
    }
    inputSuggestions.value = retained
    if (!activeMatcher) return
    const candidates = [...inputFiles.value].sort((a, b) => Number(b.path === selected.value?.path) - Number(a.path === selected.value?.path))
    try {
      await fitReady
      for (const file of candidates) {
        if (id !== inputMatchingGeneration) return
        const ready = matchingPreparation(file, prepared.value[file.path])
        if (!ready || inputSuggestions.value[file.path]?.key === ready.key) continue
        const result = await activeMatcher.suggest(ready.pages, ready.key)
        if (id !== inputMatchingGeneration) return
        const current = inputFiles.value.find(entry => entry.path === file.path)
        if (current && matchingPreparation(current, ready)) {
          inputSuggestions.value = { ...inputSuggestions.value, [file.path]: { key: ready.key, result } }
        }
      }
    } catch (cause) { if (id === inputMatchingGeneration) matchingError.value = explain(cause) }
  })
  const textLoading = ref(false)
  const textError = ref('')
  let generation = 0
  let textGeneration = 0
  let cancelText: (() => void) | undefined

  watch([() => archive.value?.path, revision], async () => {
    const id = ++generation
    const root = archive.value?.path
    folders.value = []
    error.value = ''
    loading.value = !!root
    if (!root) return
    const found: ArchiveTarget[] = [{ path: root, relative: archive.value!.path.split(/[\\/]/).filter(Boolean).at(-1) ?? root }]
    const queue = [{ path: root, relative: '' }]
    let unavailable = 0
    try {
      // Do not follow directory symlinks: they can escape the archive or form cycles.
      for (let cursor = 0; cursor < queue.length && id === generation; cursor++) {
        const parent = queue[cursor]!
        try {
          const listing = await window.files.listDirectory(parent.path)
          if (id !== generation) return
          unavailable += listing.skipped
          for (const entry of listing.entries) {
            if (!entry.isDirectory || entry.isSymbolicLink || entry.name.startsWith('.')) continue
            const target = { path: entry.path, relative: parent.relative ? `${parent.relative}/${entry.name}` : entry.name }
            found.push(target)
            queue.push(target)
          }
        } catch { unavailable++ }
        if (id !== generation) return
        if (cursor % 32 === 0) folders.value = [...found]
      }
      if (id === generation) {
        folders.value = found
        if (unavailable) error.value = `${unavailable} unavailable archive item(s) could not be indexed.`
      }
    } finally { if (id === generation) loading.value = false }
  }, { immediate: true })
  watch([() => selected.value ? `${selected.value.path}\0${selected.value.size}\0${selected.value.modified}` : '', textReady, () => selected.value ? prepared.value[selected.value.path] : undefined], async () => {
    const id = ++textGeneration
    cancelText?.()
    cancelText = undefined
    text.value = ''; pages.value = []
    textError.value = ''
    textLoading.value = false
    const file = selected.value
    if (!file || !/\.pdf$/i.test(file.name) || !textReady.value) return
    const cached = matchingPreparation(file, prepared.value[file.path])
    if (cached) { pages.value = cached.pages; text.value = cached.pages.join('\n'); return }
    textLoading.value = true
    try {
      const data = await window.files.readPdf(file.path)
      if (id !== textGeneration) return
      const result = await extractPdfText(data, task => { cancelText = () => { void task.destroy() } })
      if (id === textGeneration) { pages.value = result.pages; text.value = result.pages.join('\n') }
    } catch (cause) { if (id === textGeneration) textError.value = explain(cause) }
    finally { if (id === textGeneration) { textLoading.value = false; cancelText = undefined } }
  }, { immediate: true })
  onScopeDispose(() => { generation++; textGeneration++; indexGeneration++; matchingGeneration++; inputMatchingGeneration++; matcher?.dispose(); unsubscribeProgress?.(); cancelText?.() })
  const inputRecommendations = computed(() => {
    const result: Record<string, ReturnType<typeof recommendFolders>> = {}
    for (const file of inputFiles.value) {
      if (file.transferPending) continue
      const cached = inputSuggestions.value[file.path]
      if (index.value) {
        if (cached?.key === inputContentKey(file)) result[file.path] = destinationsFromSimilarity(cached.result, folders.value, archive.value?.path)
      } else {
        const ready = matchingPreparation(file, prepared.value[file.path])
        if (ready) result[file.path] = recommendFolders(folders.value, ready.pages.join('\n'), file.name)
      }
    }
    return result
  })
  const recommendations = computed(() => {
    if (selected.value && inputRecommendations.value[selected.value.path]) return inputRecommendations.value[selected.value.path]!
    if (index.value) return destinationsFromSimilarity(suggestions.value, folders.value, archive.value?.path)
    return selected.value ? recommendFolders(folders.value, text.value, selected.value.name) : []
  })
  function destinationPending(file: FileEntry) {
    return loading.value || indexLoading.value || (!!index.value && !!matchingPreparation(file, prepared.value[file.path]) && !inputRecommendations.value[file.path] && !matchingError.value)
  }
  function topDestination(file: FileEntry) {
    return inputRecommendations.value[file.path]?.[0]
  }

  return { folders, loading, error, textLoading, textError, recommendations, topDestination, destinationPending, suggestions, matchingLoading, matchingError, index, indexLoading, indexProgress, indexError, refreshIndex }
}
