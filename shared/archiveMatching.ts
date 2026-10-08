import {
  ArchiveSimilarity,
  type ArchiveDocument,
  type ArchiveSuggestion
} from './archiveSimilarity'

export type MatchingRequest =
  | { id: number; type: 'fit'; documents: ArchiveDocument[] }
  | { id: number; type: 'suggest'; pages: string[]; cacheKey: string }

export interface MatchingReply {
  id: number
  result?: ArchiveSuggestion
  error?: string
}

/** Runs in the matching worker. The cache belongs to one archive snapshot. */
export function createMatchingHandler() {
  let engine: ArchiveSimilarity | undefined
  const cache = new Map<string, ArchiveSuggestion>()

  return (request: MatchingRequest): MatchingReply => {
    try {
      if (request.type === 'fit') {
        cache.clear()
        engine = new ArchiveSimilarity(request.documents)
        return { id: request.id }
      }
      if (!engine) {
        throw new Error('Archive matching is not ready.')
      }

      const result = cache.get(request.cacheKey) ?? engine.suggest(request.pages)
      if (cache.size >= 100 && !cache.has(request.cacheKey)) {
        cache.delete(cache.keys().next().value!)
      }

      cache.set(request.cacheKey, result)
      return { id: request.id, result }
    } catch (cause) {
      return { id: request.id, error: cause instanceof Error ? cause.message : String(cause) }
    }
  }
}
