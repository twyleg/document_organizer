import type { prepareRenameText } from './renamePreparation'

/** Date detection and autocomplete vocabulary building run away from the UI thread. */
export function prepareRename(pages: string[]) {
  const worker = new Worker(new URL('./renamePreparation.worker.ts', import.meta.url), { type: 'module' })
  let rejectPending: (cause: Error) => void = () => {}
  const promise = new Promise<ReturnType<typeof prepareRenameText>>((resolve, reject) => {
    rejectPending = reject
    worker.onmessage = event => {
      worker.terminate()
      if (event.data.error) reject(new Error(event.data.error))
      else resolve(event.data.result)
    }
    worker.onerror = event => { worker.terminate(); reject(new Error(event.message || 'Rename preparation failed.')) }
    worker.postMessage(pages)
  })
  return { promise, cancel: () => { worker.terminate(); rejectPending(new Error('Rename preparation cancelled.')) } }
}
