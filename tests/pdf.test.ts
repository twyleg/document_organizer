import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { degrees, PDFDocument, PDFName, PDFString } from 'pdf-lib'
import { readPdf, savePdf } from '../electron/pdf'

async function fixture(path: string) {
  const pdf = await PDFDocument.create()
  const image = await pdf.embedPng(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=',
      'base64'
    )
  )
  pdf.setTitle('Scanned correspondence')

  for (let index = 0; index < 3; index++) {
    const page = pdf.addPage([400 + index * 10, 600])
    page.node.set(PDFName.of('ScanId'), PDFString.of(`scan-${index + 1}`))
    page.drawText(`Scan ${index + 1}`, { x: 40, y: 540, size: 20 })
    page.drawImage(image, { x: 40, y: 40, width: 80, height: 80 })
    if (index === 2) {
      page.setRotation(degrees(90))
    }
  }

  await writeFile(path, await pdf.save())
}

test('saves reorder, deletion and rotation while retaining page resources and document metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pdf-editor-'))

  try {
    const path = join(root, 'scan.pdf')
    await fixture(path)
    const source = await readPdf(path)
    const saved = await savePdf(path, source.version, [
      { index: 2, rotation: 90 },
      { index: 0, rotation: 270 }
    ])
    const pdf = await PDFDocument.load(saved.data)
    assert.equal(pdf.getPageCount(), 2)
    assert.equal(pdf.getTitle(), 'Scanned correspondence')
    assert.deepEqual(
      pdf.getPages().map((page) => page.getWidth()),
      [420, 400]
    )
    assert.deepEqual(
      pdf.getPages().map((page) => page.getRotation().angle),
      [180, 270]
    )
    assert.deepEqual(
      pdf.getPages().map((page) => page.node.lookup(PDFName.of('ScanId'), PDFString).decodeText()),
      ['scan-3', 'scan-1']
    )

    for (const page of pdf.getPages()) {
      assert.ok(page.node.Contents())
      assert.ok(page.node.Resources()?.has(PDFName.of('Font')))
      assert.ok(page.node.Resources()?.has(PDFName.of('XObject')))
    }

    assert.notEqual(source.version, saved.version)
    assert.equal((await readPdf(path)).version, saved.version)
    assert.equal(saved.size, (await readFile(path)).length)
    assert.deepEqual(await readdir(root), ['scan.pdf'])
    // A second edit applies rotation relative to the newly saved document.
    const again = await savePdf(path, saved.version, [{ index: 0, rotation: 90 }])
    const second = await PDFDocument.load(again.data)
    assert.equal(second.getPageCount(), 1)
    assert.equal(second.getPage(0).getRotation().angle, 270)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('refuses invalid page edits and leaves the original bytes intact', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pdf-editor-invalid-'))

  try {
    const path = join(root, 'scan.pdf')
    await fixture(path)
    const source = await readPdf(path)

    for (const recipe of [
      null,
      [],
      [{ index: -1, rotation: 0 }],
      [{ index: 3, rotation: 0 }],
      [{ index: 0.5, rotation: 0 }],
      [{ index: 0, rotation: 45 }],
      [
        { index: 0, rotation: 0 },
        { index: 0, rotation: 90 }
      ]
    ]) {
      await assert.rejects(savePdf(path, source.version, recipe))
      assert.deepEqual(new Uint8Array(await readFile(path)), source.data)
    }

    await assert.rejects(readPdf('relative.pdf'), /absolute/)
    await writeFile(join(root, 'not-pdf.txt'), 'text')
    await assert.rejects(readPdf(join(root, 'not-pdf.txt')), /regular PDF/)
    await writeFile(join(root, 'broken.pdf'), 'not a PDF')
    const broken = await readPdf(join(root, 'broken.pdf'))
    await assert.rejects(
      savePdf(join(root, 'broken.pdf'), broken.version, [{ index: 0, rotation: 90 }]),
      /cannot be edited/
    )
    assert.equal(await readFile(join(root, 'broken.pdf'), 'utf8'), 'not a PDF')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('detects external changes and serializes simultaneous saves to protect newer edits', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pdf-editor-conflict-'))

  try {
    const path = join(root, 'scan.pdf')
    await fixture(path)
    const source = await readPdf(path)
    await writeFile(path, new Uint8Array([...source.data, 10]))
    const changed = await readFile(path)
    await assert.rejects(
      savePdf(path, source.version, [{ index: 0, rotation: 90 }]),
      /changed on disk/
    )
    assert.deepEqual(await readFile(path), changed)
    const current = await readPdf(path)
    const results = await Promise.allSettled([
      savePdf(path, current.version, [{ index: 0, rotation: 90 }]),
      savePdf(path, current.version, [{ index: 1, rotation: 180 }])
    ])
    // Filesystem validation may finish in either order. Exactly one version
    // must win; the other save must reject rather than overwrite that result.
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
    assert.equal(results.filter((result) => result.status === 'rejected').length, 1)
    const loser = results.find((result) => result.status === 'rejected') as PromiseRejectedResult
    assert.match(String(loser.reason), /changed on disk/)
    const firstWon = results[0]!.status === 'fulfilled'
    const saved = await PDFDocument.load(await readFile(path))
    assert.equal(saved.getPageCount(), 1)
    assert.equal(saved.getPage(0).getWidth(), firstWon ? 400 : 410)
    assert.equal(saved.getPage(0).getRotation().angle, firstWon ? 90 : 180)
    assert.deepEqual(await readdir(root), ['scan.pdf'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('refuses to replace a PDF symlink', { skip: process.platform === 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pdf-editor-link-'))

  try {
    const path = join(root, 'scan.pdf')
    await fixture(path)
    const source = await readPdf(path)
    const link = join(root, 'linked.pdf')
    await symlink(path, link)
    await assert.rejects(readPdf(link), /symbolic links/)
    await assert.rejects(
      savePdf(link, source.version, [{ index: 0, rotation: 90 }]),
      /symbolic links/
    )
    assert.equal((await readPdf(path)).version, source.version)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('keeps inherited resources, page dimensions and rotation when changing the page tree', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pdf-editor-inherited-'))

  try {
    const path = join(root, 'scan.pdf')
    await fixture(path)
    const pdf = await PDFDocument.load(await readFile(path))
    const page = pdf.getPage(0)
    const parent = pdf.catalog.Pages()

    for (const name of ['Resources', 'MediaBox']) {
      const key = PDFName.of(name)
      parent.set(key, page.node.get(key)!)
      page.node.delete(key)
    }

    parent.set(PDFName.of('Rotate'), pdf.context.obj(90))
    await writeFile(path, await pdf.save())
    const source = await readPdf(path)
    const saved = await savePdf(path, source.version, [
      { index: 2, rotation: 0 },
      { index: 0, rotation: 90 }
    ])
    const result = await PDFDocument.load(saved.data)
    const inherited = result.getPage(1)
    assert.equal(inherited.getWidth(), 400)
    assert.equal(inherited.getHeight(), 600)
    assert.equal(inherited.getRotation().angle, 180)
    assert.ok(inherited.node.Resources()?.has(PDFName.of('Font')))
    assert.ok(inherited.node.Resources()?.has(PDFName.of('XObject')))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
