import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist'
import type { PdfDocumentData } from '../shared/types'
import { getDocument } from './pdfRendering'

export async function openTextPdf(data: PdfDocumentData, onTask?: (task: PDFDocumentLoadingTask) => void) {
  const base = new URL('./pdf-assets/', window.location.href).href
  const task = getDocument({ data: new Uint8Array(data.data), cMapUrl: `${base}cmaps/`, cMapPacked: true,
    standardFontDataUrl: `${base}standard_fonts/`, wasmUrl: `${base}wasm/`, iccUrl: `${base}iccs/`, stopAtErrors: true })
  let protectedPdf = false
  task.onPassword = () => { protectedPdf = true; void task.destroy() }
  onTask?.(task)
  try {
    const pdf = await task.promise
    return { pdf, task }
  } catch (cause) {
    await task.destroy()
    if (protectedPdf) throw new Error('Password-protected PDF: embedded text is unavailable.')
    throw cause
  }
}

export async function readDocumentText(pdf: PDFDocumentProxy) {
  const pages: string[] = []
  const missing: number[] = []
  for (let index = 1; index <= pdf.numPages; index++) {
    const page = await pdf.getPage(index)
    const content = await page.getTextContent()
    const text = content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('')
    pages.push(text)
    if (!/\S/u.test(text)) missing.push(index)
    page.cleanup()
  }
  return { pages, total: pdf.numPages, missing }
}

export async function extractPdfText(data: PdfDocumentData, onTask?: (task: PDFDocumentLoadingTask) => void) {
  const { pdf, task } = await openTextPdf(data, onTask)
  try { return await readDocumentText(pdf) }
  finally { await task.destroy() }
}
