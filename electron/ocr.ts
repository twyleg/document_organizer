import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { access, chmod, lstat, open, rename, rm, mkdtemp, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { PDFDocument } from 'pdf-lib'
import { readPdf, withPdfWrite } from './pdf'
import { validatePath } from './filesystem'

const run = promisify(execFile)

export async function ocrPdf(value: unknown, version: unknown, executable?: string) {
  const path = validatePath(value)
  return withPdfWrite(path, async () => {
    const source = await readPdf(path)
    if (typeof version !== 'string' || source.version !== version) {
      throw new Error('This PDF changed on disk. Refresh the input folder before retrying OCR.')
    }
    // Read an immutable snapshot, even if another program modifies the source.
    const work = await mkdtemp(join(tmpdir(), 'document-organizer-ocr-'))
    const output = join(dirname(path), `.${basename(path)}.${randomUUID()}.ocr.pdf`)
    try {
      const input = join(work, 'input.pdf')
      await writeFile(input, source.data)
      let command = executable ?? process.env.DOCUMENT_ORGANIZER_OCRMYPDF
      if (!command) {
        const local = join(__dirname, '../../.venv-ocr', process.platform === 'win32' ? 'Scripts/ocrmypdf.exe' : 'bin/ocrmypdf')
        try { await access(local); command = local } catch { command = 'ocrmypdf' }
      }
      try {
        await run(command, ['--skip-text', '--output-type', 'pdf', '--optimize', '0', '--jobs', '2',
          '--language', 'deu+eng', input, output], { timeout: 30 * 60 * 1000, maxBuffer: 2 * 1024 * 1024, windowsHide: true })
      } catch (cause) {
        const error = cause as NodeJS.ErrnoException & { stderr?: string }
        if (error.code === 'ENOENT') throw new Error('OCRmyPDF is not installed. See the OCR setup instructions in README.md, then refresh to retry.')
        const detail = error.stderr?.trim().slice(-1500) || error.message
        throw new Error(`OCR failed; the original PDF has been kept. ${detail}`)
      }
      const result = await readPdf(output)
      const original = await PDFDocument.load(source.data, { updateMetadata: false })
      const searchable = await PDFDocument.load(result.data, { updateMetadata: false })
      if (original.getPageCount() !== searchable.getPageCount()) throw new Error('OCR changed the page count. The original PDF has been kept.')
      const info = await lstat(path)
      await chmod(output, info.mode & 0o777)
      const file = await open(output, 'r+')
      try { await file.sync() } finally { await file.close() }
      if ((await readPdf(path)).version !== source.version) throw new Error('This PDF changed during OCR. The newer file has been kept. Refresh to retry.')
      await rename(output, path)
      return readPdf(path)
    } finally {
      await rm(output, { force: true }).catch(() => {})
      await rm(work, { recursive: true, force: true }).catch(() => {})
    }
  })
}
