import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findDocumentDates } from '../src/documentDates'

const prefixes = (text: string) => findDocumentDates([text]).map((date) => date.prefix)

test('recognizes common numeric, compact, ISO timestamp and German/English named dates', () => {
  for (const text of [
    '01.03.2026',
    '1 . 3 . 2026',
    '2026-03-01',
    '2026/3/1',
    '2026.03.01',
    '20260301',
    '2026-03-01T12:30:45Z',
    '1. März 2026',
    '01.März2026',
    '1 Maerz 2026',
    '01-Mar-2026',
    '1st of March 2026',
    'March 1st, 2026',
    'MAR. 1, 2026',
    '1\u00a0Mrz.\u00a02026'
  ]) {
    assert.deepEqual(prefixes(text), ['20260301_'], text)
  }

  assert.deepEqual(prefixes('24. Dezember 2026; December 24, 2026'), ['20261224_'])
})

test('deduplicates dates across pages and preserves document order and source evidence', () => {
  const dates = findDocumentDates([
    'Rechnung vom 01.03.2026, fällig am 15.04.2026.',
    'Copy: March 1, 2026.'
  ])
  assert.deepEqual(
    dates.map((date) => date.prefix),
    ['20260301_', '20260415_']
  )
  assert.equal(dates[0]!.evidence.length, 2)
  assert.equal(dates[0]!.evidence[1]!.page, 2)
  assert.match(dates[0]!.evidence[0]!.context, /Rechnung vom/)
})

test('offers both day/month interpretations when slash/dash dates are ambiguous', () => {
  assert.deepEqual(prefixes('03/04/2026'), ['20260403_', '20260304_'])
  assert.ok(findDocumentDates(['03-04-2026']).every((date) => date.evidence[0]!.ambiguous))
  assert.deepEqual(prefixes('04/23/2026; 23/04/2026; 04/04/2026'), ['20260423_', '20260404_'])
  assert.deepEqual(prefixes('03.04.2026'), ['20260403_'])
})

test('checks leap years and rejects impossible, incomplete, and embedded dates', () => {
  assert.deepEqual(prefixes('29.02.2024; 29.02.2000'), ['20240229_', '20000229_'])

  for (const text of [
    '29.02.2026',
    '29.02.1900',
    '31.04.2026',
    '2026-02-30',
    '00.03.2026',
    '01.13.2026',
    'March 32, 2026',
    'March 2026',
    '2026',
    '12320260301123',
    'ABC20260301XYZ',
    '01.03.20261',
    '2026-03-011',
    'version 1.2.3.2026'
  ]) {
    assert.deepEqual(prefixes(text), [], text)
  }
})

test('supports short years and normalizes OCR spacing and Unicode punctuation', () => {
  assert.deepEqual(prefixes('1.3.26, 24 Dec 99, 1.1.70, 1.1.69'), [
    '20260301_',
    '19991224_',
    '19700101_',
    '20690101_'
  ])
  assert.deepEqual(prefixes('2026–03–01; ０１．０３．２０２６; 01.\n03. 2026'), ['20260301_'])
})

test('maps normalized date matches back to their exact source text offsets', () => {
  const text = 'ﬂ Invoice: ０１．０３．２０２６; date: 1. Ma\u0308rz 2026'
  const [date] = findDocumentDates([text])
  assert.equal(date!.prefix, '20260301_')
  assert.equal(date!.evidence.length, 2)

  for (const evidence of date!.evidence) {
    assert.equal(text.slice(evidence.start, evidence.end), evidence.text)
    assert.equal(evidence.start, text.indexOf(evidence.text))
  }
})

test('retains distinct repeated occurrences even when nearby text is identical', () => {
  const text = '01.03.2026 '.repeat(20)
  const [date] = findDocumentDates([text])
  assert.equal(date!.evidence.length, 20)
  assert.equal(new Set(date!.evidence.map((item) => item.start)).size, 20)
})
