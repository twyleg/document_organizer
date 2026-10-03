import { computed, onScopeDispose, ref, watch, type Ref } from 'vue'
import type { DirectoryListing, FileEntry } from '../shared/types'
import { extractPdfText } from './pdfText'
import { recommendFolders, type ArchiveTarget } from './folderTargets'

export function useArchiveTargets(archive: Ref<DirectoryListing | null>, revision: Ref<number>, selected: Ref<FileEntry | undefined>, textReady: Ref<boolean>) {
  const folders = ref<ArchiveTarget[]>([])
  const loading = ref(false)
  const error = ref('')
  const text = ref('')
  const textLoading = ref(false)
  const textError = ref('')
  let generation = 0
  let textGeneration = 0
  let cancelText: (() => void) | undefined
  const explain = (cause: unknown) => cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(cause)
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
  watch([() => selected.value ? `${selected.value.path}\0${selected.value.size}\0${selected.value.modified}` : '', textReady], async () => {
    const id = ++textGeneration
    cancelText?.()
    cancelText = undefined
    text.value = ''
    textError.value = ''
    textLoading.value = false
    const file = selected.value
    if (!file || !/\.pdf$/i.test(file.name) || !textReady.value) return
    textLoading.value = true
    try {
      const data = await window.files.readPdf(file.path)
      if (id !== textGeneration) return
      const result = await extractPdfText(data, task => { cancelText = () => { void task.destroy() } })
      if (id === textGeneration) text.value = result.pages.join('\n')
    } catch (cause) { if (id === textGeneration) textError.value = explain(cause) }
    finally { if (id === textGeneration) { textLoading.value = false; cancelText = undefined } }
  }, { immediate: true })
  onScopeDispose(() => { generation++; textGeneration++; cancelText?.() })
  const recommendations = computed(() => selected.value ? recommendFolders(folders.value, text.value, selected.value.name) : [])
  return { folders, loading, error, textLoading, textError, recommendations }
}
