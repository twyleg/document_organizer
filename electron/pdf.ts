import { createHash, randomUUID } from 'node:crypto'
import { lstat, open, readFile, rename, unlink } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { degrees, PDFDocument, PDFName } from 'pdf-lib'
import { validatePath } from './filesystem'
import type { PdfDocumentData, PdfPageEdit } from '../shared/types'

const versionOf = (data: Uint8Array) => createHash('sha256').update(data).digest('hex')
const saves = new Map<string, Promise<unknown>>()

async function pdfPath(value: unknown) {
  const path = validatePath(value)
  if (extname(path).toLowerCase() !== '.pdf' || !(await lstat(path)).isFile()) {
    throw new Error('Choose a regular PDF file. Editing symbolic links is not supported.')
  }
  return path
}

export async function readPdf(value: unknown): Promise<PdfDocumentData> {
  const path = await pdfPath(value)
  const data = await readFile(path)
  const info = await lstat(path)
  return { data: new Uint8Array(data), version: versionOf(data), size: data.length, modified: info.mtimeMs }
}

function validatePages(value: unknown, count: number): PdfPageEdit[] {
  if (!Array.isArray(value) || !value.length || value.length > count) throw new Error('A PDF must keep at least one page.')
  const seen = new Set<number>()
  return value.map(page => {
    if (!page || !Number.isInteger(page.index) || page.index < 0 || page.index >= count ||
        seen.has(page.index) || ![0, 90, 180, 270].includes(page.rotation)) {
      throw new Error('Invalid page order or rotation.')
    }
    seen.add(page.index)
    return { index: page.index, rotation: page.rotation }
  })
}

async function writePdf(path: string, version: unknown, edits: unknown): Promise<PdfDocumentData> {
  const source = await readPdf(path)
  if (typeof version !== 'string' || source.version !== version) {
    throw new Error('This PDF changed on disk. Discard your edits and reload before saving.')
  }
  let pdf: PDFDocument
  try { pdf = await PDFDocument.load(source.data, { updateMetadata: false }) }
  catch { throw new Error('This PDF cannot be edited. It may be encrypted or damaged. The original has been kept.') }
  const editsList = validatePages(edits, pdf.getPageCount())
  const originals = pdf.getPages()
  for (const page of originals) {
    // Nested page trees may keep sizes, resources, and rotation on ancestor nodes.
    for (const name of ['Resources', 'MediaBox', 'CropBox', 'Rotate']) {
      const key = PDFName.of(name)
      const inherited = page.node.getInheritableAttribute(key)
      if (inherited) page.node.set(key, inherited)
    }
  }
  // Reuse the original page objects and resources; do not rasterize scanned pages.
  for (let i = originals.length - 1; i >= 0; i--) pdf.removePage(i)
  for (const edit of editsList) {
    const page = originals[edit.index]!
    page.setRotation(degrees((page.getRotation().angle + edit.rotation) % 360))
    pdf.addPage(page)
  }
  const bytes = await pdf.save({ addDefaultPage: false, updateFieldAppearances: false })
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`)
  let created = false
  try {
    const info = await lstat(path)
    const file = await open(temporary, 'wx', info.mode & 0o777)
    created = true
    try { await file.chmod(info.mode & 0o777); await file.writeFile(bytes); await file.sync() }
    finally { await file.close() }
    // Never replace a file changed by another application while editing or saving.
    const current = await readPdf(path)
    if (current.version !== source.version) throw new Error('This PDF changed on disk. The original has been kept. Discard your edits and reload.')
    await rename(temporary, path)
    created = false
    const saved = await lstat(path)
    return { data: bytes, version: versionOf(bytes), size: bytes.length, modified: saved.mtimeMs }
  } finally {
    if (created) await unlink(temporary).catch(() => {})
  }
}

export async function savePdf(value: unknown, version: unknown, pages: unknown): Promise<PdfDocumentData> {
  const path = await pdfPath(value)
  const prior = saves.get(path) ?? Promise.resolve()
  const task = prior.catch(() => {}).then(() => writePdf(path, version, pages))
  saves.set(path, task)
  try { return await task }
  finally { if (saves.get(path) === task) saves.delete(path) }
}
