import { GlobalWorkerOptions } from 'pdfjs-dist'
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker'

// Bundle the worker locally so previews work without an internet connection.
GlobalWorkerOptions.workerPort = new PdfWorker()
export { getDocument } from 'pdfjs-dist'
