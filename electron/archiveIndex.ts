import type { ArchiveIndexProgress } from '../shared/types'
import { createRequire } from 'node:module'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileHash } from './archiveOcr'
import { archiveEntry } from './archive'
import {
  parseArchiveFilename,
  type ArchiveDocument,
  type ArchiveIndex
} from '../shared/archiveSimilarity'

export async function extractArchiveText(path: string) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const require = createRequire(import.meta.url)
  const assets = dirname(require.resolve('pdfjs-dist/package.json')) + sep
  const task = getDocument({
    data: new Uint8Array(await readFile(path)),
    stopAtErrors: true,
    cMapUrl: `${assets}cmaps${sep}`,
    cMapPacked: true,
    standardFontDataUrl: `${assets}standard_fonts${sep}`
  })
  task.onPassword = () => {
    void task.destroy()
  }

  try {
    const pdf = await task.promise
    const pages: string[] = []
    const missingPages: number[] = []

    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number)
      const content = await page.getTextContent()
      const text = content.items
        .map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : ''))
        .join('')
      pages.push(text)
      if (!/\S/u.test(text)) {
        missingPages.push(number)
      }

      page.cleanup()
    }

    return { pages, missingPages }
  } finally {
    await task.destroy()
  }
}

export async function loadArchiveIndex(
  archive: string,
  indexPath: string,
  rebuildInvalid = false
): Promise<ArchiveIndex | null> {
  try {
    const info = await lstat(indexPath)
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error('Index must be a regular file.')
    }

    const index = JSON.parse(await readFile(indexPath, 'utf8')) as ArchiveIndex
    if (
      !index ||
      index.schema !== 1 ||
      !Array.isArray(index.documents) ||
      !Array.isArray(index.errors) ||
      index.documents.some(
        (document) =>
          !document ||
          typeof document.relativePath !== 'string' ||
          typeof document.folder !== 'string' ||
          typeof document.filename !== 'string' ||
          typeof document.text !== 'string' ||
          typeof document.hash !== 'string' ||
          !Array.isArray(document.pages) ||
          document.pages.some((page) => typeof page !== 'string') ||
          !Array.isArray(document.missingPages)
      )
    ) {
      if (rebuildInvalid) {
        return null
      }

      throw new Error('Invalid text index. Rebuild it.')
    }
    if (index.archive !== (await realpath(resolve(archive)))) {
      throw new Error('Index belongs to another archive. Choose another index path.')
    }

    return index
  } catch (cause) {
    if (
      (cause as NodeJS.ErrnoException).code === 'ENOENT' ||
      (rebuildInvalid && cause instanceof SyntaxError)
    ) {
      return null
    }

    throw cause
  }
}

export async function buildArchiveIndex(
  archive: string,
  indexPath: string,
  log: (line: string) => void = () => {},
  onProgress: (progress: ArchiveIndexProgress) => void = () => {}
) {
  const root = await realpath(resolve(archive))
  if (!(await lstat(root)).isDirectory()) {
    throw new Error('Archive must be a directory.')
  }
  if (/\.pdf$/i.test(indexPath)) {
    throw new Error('Index path must not be a PDF.')
  }

  const previous = await loadArchiveIndex(root, indexPath, true)
  const cached = new Map(previous?.documents.map((document) => [document.relativePath, document]))
  const index: ArchiveIndex = {
    schema: 1,
    archive: root,
    builtAt: new Date().toISOString(),
    documents: [],
    errors: []
  }
  const paths: string[] = []
  let processed = 0
  let reused = 0
  const report = (phase: ArchiveIndexProgress['phase'], currentFile?: string) =>
    onProgress({
      phase,
      total: paths.length,
      processed,
      reused,
      errors: index.errors.length,
      currentFile
    })
  report('scanning')

  async function walk(folder: string) {
    for (const entry of (await readdir(folder, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name)
    )) {
      if (entry.isSymbolicLink()) {
        continue
      }

      const path = join(folder, entry.name)
      if (entry.isDirectory()) {
        await archiveEntry(root, path)
        await walk(path)
      } else if (entry.isFile() && /\.pdf$/i.test(entry.name)) {
        paths.push(path)
      }
    }

    report('scanning')
  }

  await walk(root)
  report('indexing')

  for (const path of paths) {
    const relativePath = relative(root, path).split(sep).join('/')
    report('indexing', relativePath)

    try {
      await archiveEntry(root, path)
      const hash = await fileHash(path)
      const old = cached.get(relativePath)
      if (old?.hash === hash) {
        index.documents.push(old)
        reused++
      } else {
        const text = await extractArchiveText(path)
        if ((await fileHash(path)) !== hash) {
          throw new Error('PDF changed during indexing; retry when stable.')
        }

        const filename = basename(path)
        const document: ArchiveDocument = {
          relativePath,
          folder: relative(root, dirname(path)).split(sep).join('/'),
          filename,
          text: text.pages.join('\n'),
          ...text,
          hash,
          ...parseArchiveFilename(filename)
        }
        index.documents.push(document)
        log(
          `INDEX ${relativePath}: ${text.pages.length - text.missingPages.length}/${text.pages.length} pages with text`
        )
      }
    } catch (cause) {
      index.errors.push({
        relativePath,
        error: cause instanceof Error ? cause.message : String(cause)
      })
    }

    processed++
    report('indexing', relativePath)
  }

  report('saving')
  await saveArchiveIndex(indexPath, index)
  report('complete')
  return index
}

export const archiveIndexFilename = '.document-organizer-text-index.json'

export function archiveIndexPath(archive: string) {
  return join(archive, archiveIndexFilename)
}

/** Move a validated legacy desktop cache inside its archive before deleting the old copy. */
export async function migrateArchiveIndex(
  archive: string,
  legacyRoot: string,
  userData: string,
  rebuildInvalid = false
) {
  const target = archiveIndexPath(archive)
  const current = await loadArchiveIndex(archive, target, rebuildInvalid)
  const legacyPath = join(
    userData,
    `archive-index-${createHash('sha256').update(legacyRoot).digest('hex')}.json`
  )
  const legacy = await loadArchiveIndex(archive, legacyPath)
  if (!legacy) {
    return current
  }
  if (!current) {
    await saveArchiveIndex(target, legacy)
  }

  await rm(legacyPath)
  return current ?? legacy
}

async function saveArchiveIndex(indexPath: string, index: ArchiveIndex) {
  const temporary = `${indexPath}.${randomUUID()}.tmp`

  try {
    await writeFile(temporary, JSON.stringify(index, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
    await rename(temporary, indexPath)
  } finally {
    await rm(temporary, { force: true })
  }
}
