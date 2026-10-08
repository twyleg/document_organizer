import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveOcrExecutable } from '../electron/ocrExecutable'

test('discovers the project OCR environment from source scripts and compiled Electron code', async () => {
  const base = await mkdtemp(join(tmpdir(), 'ocr-discovery-'))
  const previous = process.env.DOCUMENT_ORGANIZER_OCRMYPDF
  delete process.env.DOCUMENT_ORGANIZER_OCRMYPDF

  try {
    const entry = process.platform === 'win32' ? 'Scripts/ocrmypdf.exe' : 'bin/ocrmypdf'
    const local = join(base, '.venv-ocr', entry)
    await mkdir(join(local, '..'), { recursive: true })
    await writeFile(local, '')
    assert.equal(await resolveOcrExecutable(undefined, join(base, 'electron')), local)
    assert.equal(await resolveOcrExecutable(undefined, join(base, 'out/main')), local)
    process.env.DOCUMENT_ORGANIZER_OCRMYPDF = '/custom/env-engine'
    assert.equal(
      await resolveOcrExecutable(undefined, join(base, 'electron')),
      '/custom/env-engine'
    )
    assert.equal(
      await resolveOcrExecutable('/custom/cli-engine', join(base, 'electron')),
      '/custom/cli-engine'
    )
    delete process.env.DOCUMENT_ORGANIZER_OCRMYPDF
    assert.equal(
      await resolveOcrExecutable(undefined, join(base, 'other/deep/location')),
      'ocrmypdf'
    )
  } finally {
    if (previous === undefined) {
      delete process.env.DOCUMENT_ORGANIZER_OCRMYPDF
    } else {
      process.env.DOCUMENT_ORGANIZER_OCRMYPDF = previous
    }

    await rm(base, { recursive: true, force: true })
  }
})
