import { documentKeywords } from './documentKeywords'
import { findDocumentDates, type DateSuggestion } from './documentDates'
import { buildFilenameWords, type FilenameWord } from './filenameCompletion'
import type { FileEntry } from '../shared/types'

export interface RenamePreparation {
  key: string
  version: string
  pages: string[]
  dates: DateSuggestion[]
  words: FilenameWord[]
  keywords: string[]
}

export const inputContentKey = (file: Pick<FileEntry, 'path' | 'size' | 'modified'>) =>
  `${file.path}\0${file.size}\0${file.modified}`

export function prepareRenameText(pages: string[]) {
  return {
    dates: findDocumentDates(pages),
    words: buildFilenameWords(pages),
    keywords: documentKeywords(pages)
  }
}

export function matchingPreparation(file: FileEntry, prepared?: RenamePreparation) {
  return !file.transferPending && prepared?.key === inputContentKey(file) ? prepared : undefined
}
