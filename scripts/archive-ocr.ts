import { parseArgs } from 'node:util'
import { runArchiveOcr } from '../electron/archiveOcr'

async function main() {
  const { values } = parseArgs({
    options: {
      archive: { type: 'string' },
      state: { type: 'string' },
      'dry-run': { type: 'boolean' },
      'retry-errors': { type: 'boolean' },
      ocrmypdf: { type: 'string' },
      threads: { type: 'string' },
      help: { type: 'boolean' }
    }
  })
  if (values.help) {
    console.log(
      'Usage: npm run archive:ocr -- --archive /path/archive --dry-run\n       npm run archive:ocr -- --archive /path/archive [--threads 4] [--state /path/progress.json] [--retry-errors] [--ocrmypdf /path/ocrmypdf]\n--threads sets the number of PDFs processed concurrently (default: 1). Each OCRmyPDF process uses 2 page workers.\nProgress is stored in ARCHIVE/.document-organizer-ocr-state.json by default. Rerun to resume. The --state parent must exist. Close the application and pause scanner uploads before running.'
    )
    return
  }
  if (!values.archive) {
    throw new Error('Supply --archive. Use --help for usage.')
  }
  if (values.threads !== undefined && !/^[1-9]\d*$/.test(values.threads)) {
    throw new Error('--threads must be a positive integer.')
  }

  const threads = values.threads === undefined ? 1 : Number(values.threads)
  if (!Number.isSafeInteger(threads)) {
    throw new Error('--threads must be a positive integer.')
  }

  let stopped = false
  process.on('SIGINT', () => {
    stopped = true
    console.log('Stopping after active files finish. Progress will be saved.')
  })
  process.on('SIGTERM', () => {
    stopped = true
  })
  const result = await runArchiveOcr({
    archive: values.archive,
    statePath: values.state,
    dryRun: values['dry-run'],
    retryErrors: values['retry-errors'],
    executable: values.ocrmypdf,
    threads,
    stopped: () => stopped
  })
  if (result.failed || stopped) {
    process.exitCode = stopped ? 130 : 1
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
