import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PDFDocument } from 'pdf-lib'
import { ocrPdf } from '../electron/ocr'
import { readPdf, savePdf } from '../electron/pdf'

async function fixture(mode = 'success') {
  const root = await mkdtemp(join(tmpdir(), 'ocr-test-'))
  const source = join(root, 'scan.pdf')
  const pdf = await PDFDocument.create()
  pdf.addPage([400, 600])
  pdf.addPage([400, 600]).drawText('Existing text')
  await writeFile(source, await pdf.save())
  await chmod(source, 0o640)
  const executable = join(root, 'ocr-engine')
  await writeFile(
    executable,
    `#!/usr/bin/env node
const fs = require('node:fs/promises');
const { PDFDocument } = require(${JSON.stringify(join(process.cwd(), 'node_modules/pdf-lib'))});
(async () => {
  const args = process.argv.slice(2);
  if (!args.includes('--skip-text') || args[args.indexOf('--language') + 1] !== 'deu+eng') process.exit(7);
  const input = args.at(-2), output = args.at(-1);
  if (${JSON.stringify(mode)} === 'fail') { console.error('OCR engine failed'); process.exit(1); }
  if (${JSON.stringify(mode)} === 'broken') { await fs.writeFile(output, 'not a PDF'); return; }
  const pdf = await PDFDocument.load(await fs.readFile(input));
  pdf.getPage(0).drawText('Recognized scan text');
  if (${JSON.stringify(mode)} === 'pages') pdf.removePage(1);
  if (${JSON.stringify(mode)} === 'changed') await fs.appendFile(${JSON.stringify(source)}, '\\n% external change');
  await fs.writeFile(output, await pdf.save());
})().catch(error => { console.error(error); process.exit(1); });
`
  )
  await chmod(executable, 0o755)
  return { root, source, executable }
}

test('OCR commits a validated PDF, preserves page count and permissions, and removes temporary output', async () => {
  const { root, source, executable } = await fixture()

  try {
    const before = await readPdf(source)
    const result = await ocrPdf(source, before.version, executable)
    assert.notEqual(result.version, before.version)
    assert.equal((await PDFDocument.load(result.data)).getPageCount(), 2)
    assert.equal((await readPdf(source)).version, result.version)
    assert.equal((await stat(source)).mode & 0o777, 0o640)
    assert.deepEqual((await readdir(root)).sort(), ['ocr-engine', 'scan.pdf'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('OCR failures, invalid output, and page loss leave the source intact', async () => {
  for (const mode of ['fail', 'broken', 'pages']) {
    const { root, source, executable } = await fixture(mode)

    try {
      const before = await readPdf(source)
      await assert.rejects(ocrPdf(source, before.version, executable))
      assert.deepEqual(new Uint8Array(await readFile(source)), before.data)
      assert.deepEqual((await readdir(root)).sort(), ['ocr-engine', 'scan.pdf'])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }
})

test('OCR rejects stale versions and preserves changes made during recognition', async () => {
  const { root, source, executable } = await fixture('changed')

  try {
    const before = await readPdf(source)
    await assert.rejects(ocrPdf(source, 'stale', executable), /changed on disk/)
    await assert.rejects(ocrPdf(source, before.version, executable), /changed during OCR/)
    assert.ok((await readFile(source, 'utf8')).endsWith('% external change'))
    assert.deepEqual((await readdir(root)).sort(), ['ocr-engine', 'scan.pdf'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('OCR and page edits serialize writes and refuse to overwrite the newer result', async () => {
  const { root, source, executable } = await fixture()

  try {
    const before = await readPdf(source)
    const results = await Promise.allSettled([
      ocrPdf(source, before.version, executable),
      savePdf(source, before.version, [{ index: 0, rotation: 90 }])
    ])
    assert.equal(results[0]!.status, 'fulfilled')
    assert.equal(results[1]!.status, 'rejected')
    assert.equal((await PDFDocument.load((await readPdf(source)).data)).getPageCount(), 2)
    await assert.rejects(
      ocrPdf(source, (await readPdf(source)).version, join(root, 'missing-engine')),
      /Could not launch OCRmyPDF executable.*missing-engine/
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
