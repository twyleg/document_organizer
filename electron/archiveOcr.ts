import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { readPdf } from './pdf'
import { ocrPdf } from './ocr'

type Result = { hash: string; status: 'text' | 'ocr' | 'error'; missing?: number[]; error?: string }
interface State { schema: 2; archive: string; results: Record<string, Result> }
const overlaps = (a: string, b: string) => {
  const part = relative(a, b)
  return !isAbsolute(part) && part !== '..' && !part.startsWith(`..${sep}`)
}
export async function fileHash(path: string) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}
export async function textCoverage(path: string) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const assets = dirname(require.resolve('pdfjs-dist/package.json')) + sep
  const task = getDocument({ data: new Uint8Array(await readFile(path)), stopAtErrors: true,
    cMapUrl: `${assets}cmaps${sep}`, cMapPacked: true, standardFontDataUrl: `${assets}standard_fonts${sep}` })
  task.onPassword = () => { void task.destroy() }
  try {
    const pdf = await task.promise
    const missing: number[] = []
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number)
      const text = await page.getTextContent()
      if (!text.items.some(item => 'str' in item && /\S/u.test(item.str))) missing.push(number)
      page.cleanup()
    }
    return { total: pdf.numPages, missing }
  } finally { await task.destroy() }
}
async function saveState(path: string, state: State) {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify(state, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
    await rename(temporary, path)
  } finally { await rm(temporary, { force: true }) }
}
export async function runArchiveOcr(options: {
  archive: string; statePath?: string; dryRun?: boolean; retryErrors?: boolean; executable?: string;
  threads?: number; stopped?: () => boolean; log?: (line: string) => void
}) {
  const threads = options.threads ?? 1
  if (!Number.isSafeInteger(threads) || threads < 1) throw new Error('Threads must be a positive integer.')
  const root = await realpath(resolve(options.archive))
  if (!(await lstat(root)).isDirectory()) throw new Error('Archive must be a directory.')
  const log = options.log ?? console.log
  const files: string[] = []
  async function walk(path: string) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name)
      if (entry.isDirectory()) await walk(child)
      else if (entry.isFile()) files.push(relative(root, child))
      else if (options.dryRun) log(`SKIP special or linked entry: ${relative(root, child)}`)
    }
  }
  await walk(root)
  files.sort()
  let state: State = { schema: 2, archive: root, results: {} }
  const statePath = options.statePath ? resolve(options.statePath) : join(root, '.document-organizer-ocr-state.json')
  if (!options.dryRun) {
    const existing = await lstat(statePath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
      return undefined
    })
    if (existing) {
      if (!existing.isFile() || existing.isSymbolicLink()) throw new Error('Progress state must be a regular file, not a link.')
      state = JSON.parse(await readFile(statePath, 'utf8')) as State
      if (state.schema !== 2 || state.archive !== root || !state.results || typeof state.results !== 'object' || Array.isArray(state.results)) {
        throw new Error('Progress state does not match this archive.')
      }
    }
    // Check that progress can be saved before changing any PDFs.
    await saveState(statePath, state)
  }
  let failed = 0, processed = 0
  const pdfs = files.filter(name => /\.pdf$/i.test(name))
  let next = 0, aborted = false
  // Serialize progress writes so an older snapshot cannot overwrite newer results.
  let saving = Promise.resolve()
  async function processFile(name: string) {
    if (isAbsolute(name) || name.split(sep).includes('..')) throw new Error('Invalid relative filename.')
    const path = join(root, name)
    let hash = ''
    try {
      if (!(await lstat(path)).isFile() || !(overlaps(root, await realpath(path)))) throw new Error('File is missing, linked, or outside the archive.')
      hash = await fileHash(path)
      const previous = state.results[name]
      if (!options.dryRun && previous?.hash === hash && (previous.status !== 'error' || !options.retryErrors)) {
        log(`SKIP ${name}: ${previous.status}${previous.error ? ` (${previous.error})` : ''}`)
        if (previous.status === 'error') failed++
        return
      }
      const coverage = await textCoverage(path)
      if (options.dryRun) {
        log(`${coverage.missing.length ? 'NEEDS OCR' : 'TEXT AVAILABLE'} ${name}: ${coverage.total - coverage.missing.length}/${coverage.total} pages have text`)
        processed++
        return
      }
      if (coverage.missing.length) {
        log(`OCR ${name}: pages without text ${coverage.missing.join(', ')}`)
        const source = await readPdf(path)
        if (source.version !== hash) throw new Error('File changed during text checking. Retry when it is stable.')
        await ocrPdf(path, source.version, options.executable)
      }
      const after = coverage.missing.length ? await textCoverage(path) : coverage
      state.results[name] = { hash: await fileHash(path), status: coverage.missing.length ? 'ocr' : 'text', missing: after.missing }
      log(`DONE ${name}${after.missing.length ? `: pages still without text ${after.missing.join(', ')} (possibly blank)` : ''}`)
      processed++
    } catch (error) {
      failed++
      const detail = error instanceof Error ? error.message : String(error)
      log(`ERROR ${name}: ${detail}`)
      if (!options.dryRun) state.results[name] = { hash, status: 'error', error: detail }
    }
    if (!options.dryRun) {
      saving = saving.then(() => saveState(statePath, state))
      await saving
    }
  }
  async function worker() {
    try {
      while (!aborted && !options.stopped?.() && next < pdfs.length) {
        const name = pdfs[next++]!
        await processFile(name)
      }
    } catch (error) {
      aborted = true
      throw error
    }
  }
  // Finish active files even if another worker fails or a stop is requested.
  const workers = await Promise.allSettled(Array.from({ length: Math.min(threads, pdfs.length) }, () => worker()))
  const fatal = workers.find(result => result.status === 'rejected')
  if (fatal?.status === 'rejected') throw fatal.reason
  log(`Finished: ${processed} processed, ${failed} errors${options.stopped?.() ? ', stopped early' : ''}.`)
  return { processed, failed }
}
