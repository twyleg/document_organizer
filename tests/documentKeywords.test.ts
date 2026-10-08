import { test } from 'node:test'
import assert from 'node:assert/strict'
import { documentKeywords } from '../src/documentKeywords'
import { queueThumbnail } from '../src/thumbnailQueue'

test('document hints retain sender/content terms and ignore dates, invoice identifiers and boilerplate', () => {
  const keywords = documentKeywords(['LumenGrid electricity meter tariff electricity. Document date 2026-10-03 INV99302. The fictional sample dataset.'])
  assert.ok(keywords.includes('electricity'))
  assert.ok(keywords.includes('LumenGrid'))
  assert.ok(keywords.includes('meter'))
  assert.ok(keywords.every(term => !/\d/.test(term)))
  assert.ok(!keywords.some(term => ['fictional', 'sample', 'dataset', 'The'].includes(term)))
  assert.ok(keywords.length <= 5)
  assert.deepEqual(documentKeywords(['', '2026-10-03 INV1122 the and']), [])
})
test('keyword hints merge case/accents, favor repeated content and return words actually printed', () => {
  const keywords = documentKeywords(['Électricité meter Meter tariff', 'electricite electricity electricity electricity'])
  assert.equal(keywords.filter(term => /lectricité|electricite/i.test(term)).length, 1)
  assert.equal(keywords[0], 'Électricité')
  assert.equal(documentKeywords(['tariff electricity electricity electricity'])[0], 'electricity')
  assert.equal(documentKeywords(['sender tariff', 'unrelated'], 1).length, 1)
})
test('thumbnail queue limits work to two PDFs and continues after a failed render', async () => {
  const releases: Array<() => void> = []
  let active = 0, maximum = 0, started = 0
  const job = async (fail = false) => {
    started++; active++; maximum = Math.max(maximum, active)
    await new Promise<void>(resolve => releases.push(resolve))
    active--
    if (fail) throw new Error('Unreadable PDF')
  }
  const first = queueThumbnail(() => job()), second = queueThumbnail(() => job(true)), third = queueThumbnail(() => job())
  const failure = assert.rejects(second, /Unreadable PDF/)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(started, 2)
  releases[1]!()
  await failure
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(started, 3)
  releases[0]!(); releases[2]!()
  await Promise.all([first, third])
  assert.equal(maximum, 2)
})
