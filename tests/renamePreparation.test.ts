import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  inputContentKey,
  matchingPreparation,
  prepareRenameText,
  type RenamePreparation
} from '../src/renamePreparation'
import type { FileEntry } from '../shared/types'

test('rename preparation derives dates and autocomplete from final OCR text, including partial and blank pages', () => {
  const pages = ['LumenGrid electricity consumption\nDocument date: 2026-10-03', '']
  const result = prepareRenameText(pages)
  assert.equal(result.dates[0]?.prefix, '20261003_')
  assert.ok(result.words.some((word) => word.value === 'LumenGrid'))
  assert.deepEqual(prepareRenameText(['', '']), { dates: [], words: [], keywords: [] })
})

test('prepared input data is reused only for unchanged, fully transferred files', () => {
  const file: FileEntry = {
    path: '/input/scan.pdf',
    name: 'scan.pdf',
    size: 100,
    modified: 1,
    isDirectory: false,
    isSymbolicLink: false
  }
  const prepared: RenamePreparation = {
    ...prepareRenameText(['Document date 2026-10-03']),
    pages: ['Document date 2026-10-03'],
    key: inputContentKey(file),
    version: 'hash'
  }
  assert.equal(matchingPreparation(file, prepared), prepared)

  for (const changed of [
    { size: 101 },
    { modified: 2 },
    { path: '/input/other.pdf' },
    { transferPending: true }
  ]) {
    assert.equal(matchingPreparation({ ...file, ...changed }, prepared), undefined)
  }

  assert.equal(matchingPreparation(file), undefined)
})
