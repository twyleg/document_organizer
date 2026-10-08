import { prepareRenameText } from './renamePreparation'
self.onmessage = (event: MessageEvent<string[]>) => {
  try {
    self.postMessage({ result: prepareRenameText(event.data) })
  } catch (cause) {
    self.postMessage({ error: cause instanceof Error ? cause.message : String(cause) })
  }
}
