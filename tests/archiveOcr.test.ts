import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { fileHash, runArchiveOcr, textCoverage } from '../electron/archiveOcr'

async function fixture(trackConcurrency = false) {
  const base = await mkdtemp(join(tmpdir(), 'archive-ocr-'))
  const archive = join(base, 'archive')
  const engine = join(base, 'engine')
  await mkdir(join(archive, 'nested'), { recursive: true })
  const partial = await PDFDocument.create()
  partial.addPage()
  partial.addPage().drawText('Existing text')
  const digital = await PDFDocument.create()
  digital.addPage().drawText('Digital document')
  const scan = join(archive, 'nested/scan.pdf')
  const text = join(archive, 'digital.pdf')
  await writeFile(scan, await partial.save())
  await writeFile(text, await digital.save())
  await writeFile(join(archive, 'notes.txt'), 'Leave non-PDF files alone')
  await writeFile(
    engine,
    `#!/usr/bin/env node
const fs = require('node:fs/promises');
const {PDFDocument} = require(${JSON.stringify(join(process.cwd(), 'node_modules/pdf-lib'))});
(async()=>{const args=process.argv.slice(2); if(!args.includes('--skip-text'))process.exit(9);
${trackConcurrency ? `await fs.appendFile(${JSON.stringify(join(base, 'events'))}, 'start\\n'); await new Promise(resolve=>setTimeout(resolve, 200));` : ''}
const pdf=await PDFDocument.load(await fs.readFile(args.at(-2)));pdf.getPage(0).drawText('Recognized text');await fs.writeFile(args.at(-1),await pdf.save());
${trackConcurrency ? `await fs.appendFile(${JSON.stringify(join(base, 'events'))}, 'end\\n');` : ''}
})().catch(()=>process.exit(1));
`
  )
  await chmod(engine, 0o755)
  return { base, archive, engine, scan, text }
}

test('dry-run changes nothing; selective OCR runs without a backup and completed files resume', async () => {
  const f = await fixture()

  try {
    const scanHash = await fileHash(f.scan)
    const textHash = await fileHash(f.text)
    const lines: string[] = []
    await runArchiveOcr({ archive: f.archive, dryRun: true, log: (line) => lines.push(line) })
    assert.equal(await fileHash(f.scan), scanHash)
    assert.ok(lines.some((line) => line.includes('NEEDS OCR nested/scan.pdf')))
    assert.ok(lines.some((line) => line.includes('TEXT AVAILABLE digital.pdf')))
    assert.deepEqual((await readdir(f.base)).sort(), ['archive', 'engine'])
    const result = await runArchiveOcr({ archive: f.archive, executable: f.engine, log: () => {} })
    assert.equal(result.failed, 0)
    assert.equal(await readFile(join(f.archive, 'notes.txt'), 'utf8'), 'Leave non-PDF files alone')
    assert.deepEqual((await readdir(f.base)).sort(), ['archive', 'engine'])
    const state = JSON.parse(
      await readFile(join(f.archive, '.document-organizer-ocr-state.json'), 'utf8')
    )
    assert.equal(state.results['nested/scan.pdf'].status, 'ocr')
    assert.equal(await fileHash(f.text), textHash)
    assert.deepEqual((await textCoverage(f.scan)).missing, [])
    const resume = await runArchiveOcr({
      archive: f.archive,
      executable: '/missing-engine',
      log: () => {}
    })
    assert.equal(resume.processed, 0)
    assert.equal(resume.failed, 0)
  } finally {
    await rm(f.base, { recursive: true, force: true })
  }
})

test('failed OCR preserves originals and can be retried; changed and new PDFs are processed', async () => {
  const f = await fixture()

  try {
    const hash = await fileHash(f.scan)
    const failed = await runArchiveOcr({
      archive: f.archive,
      executable: '/missing-engine',
      log: () => {}
    })
    assert.equal(failed.failed, 1)
    assert.equal(await fileHash(f.scan), hash)
    const retried = await runArchiveOcr({
      archive: f.archive,
      executable: f.engine,
      retryErrors: true,
      log: () => {}
    })
    assert.equal(retried.failed, 0)
    const changedPdf = await PDFDocument.create()
    changedPdf.addPage()
    await writeFile(f.text, await changedPdf.save())
    await writeFile(join(f.archive, 'new.pdf'), await changedPdf.save())
    const changed = await runArchiveOcr({ archive: f.archive, executable: f.engine, log: () => {} })
    assert.equal(changed.failed, 0)
    assert.equal(changed.processed, 2)
    assert.deepEqual((await textCoverage(f.text)).missing, [])
  } finally {
    await rm(f.base, { recursive: true, force: true })
  }
})

test('invalid progress state stops before modifying PDFs; custom progress path supports resuming', async () => {
  const f = await fixture()

  try {
    const hash = await fileHash(f.scan)
    const statePath = join(f.base, 'progress.json')
    await writeFile(
      statePath,
      JSON.stringify({ schema: 2, archive: '/another/archive', results: {} })
    )
    await assert.rejects(
      runArchiveOcr({ archive: f.archive, statePath, executable: f.engine }),
      /does not match/
    )
    assert.equal(await fileHash(f.scan), hash)
    await rm(statePath)
    const result = await runArchiveOcr({
      archive: f.archive,
      statePath,
      executable: f.engine,
      log: () => {}
    })
    assert.equal(result.failed, 0)
    assert.ok(JSON.parse(await readFile(statePath, 'utf8')).results['nested/scan.pdf'])
    assert.ok(!(await readdir(f.archive)).includes('.document-organizer-ocr-state.json'))
    const resumed = await runArchiveOcr({
      archive: f.archive,
      statePath,
      executable: '/missing',
      log: () => {}
    })
    assert.equal(resumed.processed, 0)
  } finally {
    await rm(f.base, { recursive: true, force: true })
  }
})

test('parallel OCR respects the worker limit and retains all completed results', async () => {
  const f = await fixture(true)

  try {
    const scan = await readFile(f.scan)

    for (let i = 0; i < 4; i++) {
      await writeFile(join(f.archive, `scan-${i}.pdf`), scan)
    }

    const result = await runArchiveOcr({
      archive: f.archive,
      executable: f.engine,
      threads: 2,
      log: () => {}
    })
    assert.deepEqual(result, { processed: 6, failed: 0 })
    let active = 0
    let peak = 0
    let starts = 0

    for (const event of (await readFile(join(f.base, 'events'), 'utf8')).trim().split('\n')) {
      if (event === 'start') {
        active++
        starts++
      } else {
        active--
      }

      peak = Math.max(peak, active)
      assert.ok(active >= 0 && active <= 2)
    }

    assert.equal(starts, 5)
    assert.equal(peak, 2)
    assert.equal(active, 0)
    const state = JSON.parse(
      await readFile(join(f.archive, '.document-organizer-ocr-state.json'), 'utf8')
    )
    assert.equal(Object.keys(state.results).length, 6)
    assert.ok(Object.values(state.results).every((result: any) => result.status !== 'error'))
    assert.deepEqual(
      await runArchiveOcr({
        archive: f.archive,
        threads: 3,
        executable: '/missing',
        log: () => {}
      }),
      { processed: 0, failed: 0 }
    )
  } finally {
    await rm(f.base, { recursive: true, force: true })
  }
})

test('stopping parallel OCR finishes active files and resumes remaining files', async () => {
  const f = await fixture(true)

  try {
    await rm(f.text)
    const scan = await readFile(f.scan)

    for (let i = 0; i < 3; i++) {
      await writeFile(join(f.archive, `scan-${i}.pdf`), scan)
    }

    let stopped = false
    const result = await runArchiveOcr({
      archive: f.archive,
      executable: f.engine,
      threads: 2,
      stopped: () => stopped,
      log: (line) => {
        if (line.startsWith('DONE ')) {
          stopped = true
        }
      }
    })
    assert.deepEqual(result, { processed: 2, failed: 0 })
    const state = JSON.parse(
      await readFile(join(f.archive, '.document-organizer-ocr-state.json'), 'utf8')
    )
    assert.equal(Object.keys(state.results).length, 2)
    assert.deepEqual(
      await runArchiveOcr({ archive: f.archive, executable: f.engine, threads: 2, log: () => {} }),
      { processed: 2, failed: 0 }
    )
  } finally {
    await rm(f.base, { recursive: true, force: true })
  }
})

test('invalid worker counts are rejected before accessing the archive', async () => {
  for (const threads of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(runArchiveOcr({ archive: '/missing', threads }), /positive integer/)
  }
})
