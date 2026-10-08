import { getDocument as loadDocument, PDFWorker } from 'pdfjs-dist'
import type { DocumentInitParameters } from 'pdfjs-dist/types/src/display/api'
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker'

export function getDocument(options: DocumentInitParameters) {
  // Each preview owns a locally bundled worker, so switching documents can
  // start immediately while the previous preview finishes shutting down.
  const port = new PdfWorker()
  const worker = PDFWorker.create({ port })
  const task = loadDocument({ ...options, worker })
  const destroy = task.destroy.bind(task)
  let destruction: Promise<void> | undefined
  task.destroy = () =>
    (destruction ??= (async () => {
      try {
        await destroy()
      } finally {
        worker.destroy()
        port.terminate()
      }
    })())

  return task
}
