import { parseArgs } from 'node:util'
import { readFile, realpath } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import {
  archiveIndexPath,
  buildArchiveIndex,
  extractArchiveText,
  loadArchiveIndex
} from '../electron/archiveIndex'
import { ArchiveSimilarity } from '../shared/archiveSimilarity'
import { evaluateArchive, type EvaluationLabel } from '../shared/archiveEvaluation'
import { generateSyntheticArchive } from './syntheticArchive'

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      archive: { type: 'string' },
      index: { type: 'string' },
      input: { type: 'string' },
      labels: { type: 'string' },
      output: { type: 'string' },
      help: { type: 'boolean' }
    }
  })
  if (values.help) {
    console.log(`Usage: npm run archive:similarity -- generate --output /tmp/fictional-archive
       npm run archive:similarity -- index --archive /tmp/fictional-archive/archive
       npm run archive:similarity -- suggest --archive /tmp/fictional-archive/archive --input /path/new.pdf
       npm run archive:similarity -- evaluate --archive /tmp/fictional-archive/archive --labels /tmp/fictional-archive/labels.json
The default index is ARCHIVE/.document-organizer-text-index.json; --index overrides it. Index and labels are local JSON. The index parent must exist. Indexing never runs OCR or modifies PDFs. Suggestions only print evidence; confirm changes in the application.`)

    return
  }
  if (positionals.length !== 1) {
    throw new Error('Choose generate, index, suggest, or evaluate. Use --help.')
  }

  const command = positionals[0]
  if (command === 'generate') {
    if (!values.output) {
      throw new Error('Supply --output (a directory that does not exist).')
    }

    console.log(JSON.stringify(await generateSyntheticArchive(resolve(values.output)), null, 2))
    return
  }
  if (!['index', 'suggest', 'evaluate'].includes(command!)) {
    throw new Error('Unknown command. Use --help.')
  }
  if (!values.archive) {
    throw new Error('Supply --archive explicitly.')
  }

  const archive = resolve(values.archive)
  const indexPath = values.index ? resolve(values.index) : archiveIndexPath(archive)
  if (command === 'index') {
    const index = await buildArchiveIndex(archive, indexPath, console.log)
    console.log(
      `${index.documents.length} indexed PDFs, ${index.errors.length} errors, ${index.documents.filter((document) => document.missingPages.length).length} PDFs with pages without text.`
    )
    if (index.errors.length) {
      console.error(JSON.stringify(index.errors, null, 2))
      process.exitCode = 1
    }

    return
  }

  const index = await loadArchiveIndex(archive, indexPath)
  if (!index) {
    throw new Error('Build an index first.')
  }
  if (command === 'suggest') {
    if (!values.input) {
      throw new Error('Supply --input.')
    }

    const text = await extractArchiveText(resolve(values.input))
    const suggestion = new ArchiveSimilarity(index.documents).suggest(text.pages, [
      relative(index.archive, await realpath(resolve(values.input)))
        .split(sep)
        .join('/')
    ])
    // Avoid dumping the full stored archive text to the terminal.
    const result = JSON.parse(
      JSON.stringify(suggestion, (key, value) =>
        key === 'document'
          ? { relativePath: value.relativePath, filename: value.filename, folder: value.folder }
          : value
      )
    )
    console.log(
      JSON.stringify(
        {
          ...result,
          missingPages: text.missingPages,
          warning:
            'Similarity is not a probability. Manually confirm the date, filename, and folder.'
        },
        null,
        2
      )
    )
  } else {
    if (!values.labels) {
      throw new Error('Supply --labels with explicit train/holdout labels.')
    }

    const manifest = JSON.parse(await readFile(values.labels, 'utf8')) as {
      synthetic?: boolean
      documents: EvaluationLabel[]
    }
    if (
      !Array.isArray(manifest.documents) ||
      manifest.documents.some((label) => !['train', 'holdout'].includes(label.split)) ||
      new Set(manifest.documents.map((label) => label.relativePath)).size !==
        manifest.documents.length
    ) {
      throw new Error('Labels must have unique relative paths and explicit train/holdout splits.')
    }

    console.log(
      JSON.stringify(
        evaluateArchive(index.documents, manifest.documents, manifest.synthetic === true),
        null,
        2
      )
    )
  }
}

main().catch((cause) => {
  console.error(cause instanceof Error ? cause.message : String(cause))
  process.exitCode = 1
})
