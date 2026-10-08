import type { ArchiveSuggestion } from '../shared/archiveSimilarity'

export interface ArchiveTarget {
  path: string
  relative: string
}

export interface FolderRecommendation extends ArchiveTarget {
  score: number
  keywords: string[]
  examples?: { filename: string; folder: string }[]
}

export function normalizeFolderText(value: string) {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase().replace(/ß/g, 'ss')
}

const ignored = new Set([
  'der',
  'die',
  'das',
  'und',
  'von',
  'fur',
  'mit',
  'the',
  'and',
  'for',
  'archive',
  'archiv'
])

function words(value: string) {
  return (
    normalizeFolderText(value.replace(/([a-zäöü])([A-ZÄÖÜ])/g, '$1 $2')).match(/[\p{L}\p{N}]+/gu) ??
    []
  )
}

export function searchFolders(folders: ArchiveTarget[], query: string) {
  const terms = words(query)

  return folders
    .filter((folder) => terms.every((term) => normalizeFolderText(folder.relative).includes(term)))
    .sort((a, b) => {
      const leaf = (folder: ArchiveTarget) =>
        normalizeFolderText(folder.relative.split('/').at(-1) ?? '')
      const prefix = normalizeFolderText(query.trim())

      return (
        Number(leaf(b).startsWith(prefix)) - Number(leaf(a).startsWith(prefix)) ||
        a.relative.localeCompare(b.relative)
      )
    })
}

export function recommendFolders(
  folders: ArchiveTarget[],
  text: string,
  filename: string
): FolderRecommendation[] {
  const documentWords = new Set(words(text))
  const filenameWords = new Set(words(filename.replace(/\.[^.]+$/, '')))
  const tokens = folders.map((folder) => [
    ...new Set(words(folder.relative).filter((word) => word.length >= 2 && !ignored.has(word)))
  ])
  const frequency = new Map<string, number>()

  for (const list of tokens) {
    for (const word of list) {
      frequency.set(word, (frequency.get(word) ?? 0) + 1)
    }
  }

  function matches(word: string, source: Set<string>) {
    if (source.has(word)) {
      return true
    }

    // German plural folder names often differ from the singular printed on a bill.
    const stem = word.length >= 6 ? word.replace(/(?:en|e|n|s)$/, '') : word
    return stem.length >= 5 && [...source].some((candidate) => candidate.startsWith(stem))
  }

  return folders
    .map((folder, index) => {
      const leafWords = new Set(words(folder.relative.split('/').at(-1) ?? ''))
      const keywords = tokens[index]!.filter(
        (word) => matches(word, documentWords) || matches(word, filenameWords)
      )
      const score = keywords.reduce(
        (total, word) =>
          total +
          (leafWords.has(word) ? 2 : 1) *
            (matches(word, filenameWords) ? 1.5 : 1) *
            (1 + Math.log(1 + folders.length / frequency.get(word)!)),
        0
      )
      return { ...folder, score, keywords }
    })
    .filter((folder) => folder.score > 0)
    .sort((a, b) => b.score - a.score || a.relative.localeCompare(b.relative))
    .slice(0, 5)
}

/** Map archive labels only to destinations that still exist in the active tree. */
export function destinationsFromSimilarity(
  suggestion: ArchiveSuggestion | null,
  folders: ArchiveTarget[],
  root?: string
): FolderRecommendation[] {
  const byRelative = new Map(folders.map((folder) => [folder.relative, folder]))

  return (suggestion?.folders ?? []).flatMap((folder) => {
    const target = folder.value
      ? byRelative.get(folder.value)
      : folders.find((item) => item.path === root)

    return target
      ? [
          {
            ...target,
            score: folder.score,
            keywords: folder.examples[0]?.keywords ?? [],
            examples: folder.examples.map((match) => ({
              filename: match.document.filename,
              folder: match.document.folder
            }))
          }
        ]
      : []
  })
}
