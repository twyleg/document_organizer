import type { MatchingReply, MatchingRequest } from '../shared/archiveMatching'
import type { ArchiveDocument, ArchiveSuggestion } from '../shared/archiveSimilarity'

export interface MatchingPort {
  postMessage(message: MatchingRequest): void
  terminate(): void
  onmessage: ((event: MessageEvent<MatchingReply>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
}
export function createArchiveMatcher(port: MatchingPort) {
  let id = 0, closed = false
  const pending = new Map<number, { resolve: (result?: ArchiveSuggestion) => void; reject: (error: Error) => void }>()
  function close(error = new Error('Archive matching cancelled.')) {
    closed = true
    port.terminate()
    for (const request of pending.values()) request.reject(error)
    pending.clear()
  }
  port.onmessage = ({ data }) => {
    const request = pending.get(data.id)
    if (!request) return
    pending.delete(data.id)
    if (data.error) request.reject(new Error(data.error))
    else request.resolve(data.result)
  }
  port.onerror = event => close(new Error(event.message || 'Archive matching failed.'))
  function send(request: Omit<Extract<MatchingRequest, { type: 'fit' }>, 'id'> | Omit<Extract<MatchingRequest, { type: 'suggest' }>, 'id'>) {
    return new Promise<ArchiveSuggestion | undefined>((resolve, reject) => {
      if (closed) { reject(new Error('Archive matching cancelled.')); return }
      const requestId = ++id
      pending.set(requestId, { resolve, reject })
      try { port.postMessage({ ...request, id: requestId }) }
      catch (cause) { pending.delete(requestId); reject(cause) }
    })
  }
  return {
    fit: (documents: ArchiveDocument[]) => send({ type: 'fit', documents }),
    suggest: async (pages: string[], cacheKey: string) => (await send({ type: 'suggest', pages: [...pages], cacheKey }))!,
    dispose: close
  }
}
