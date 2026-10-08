import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildFilenameWords, filenameCompletions } from '../src/filenameCompletion'

const words = buildFilenameWords([
  'ADAC\nBeitragsrechnung Beitrag\nVersicherung für Fahrzeuge\nMüller Kfz-Versicherung',
  'Beitragsrechnung'
])

test('completes OCR words without changing date, sender, suffix, or extension', () => {
  const name = '20260301_ADAC-bei.pdf'
  const completions = filenameCompletions(name, name.length - 4, name.length - 4, words)
  assert.equal(completions[0]!.filename, '20260301_ADAC-Beitragsrechnung.pdf')
  assert.ok(completions.some((item) => item.value === 'Beitrag'))
  const middle = '20260301_ADAC-bei-SUBJECT.PDF'
  assert.equal(
    filenameCompletions(middle, 17, 17, words)[0]!.filename,
    '20260301_ADAC-Beitragsrechnung-SUBJECT.PDF'
  )
})

test('matches case-insensitively, supports Unicode, and replaces unfinished token tails', () => {
  assert.equal(filenameCompletions('MÜ.pdf', 2, 2, words)[0]!.filename, 'Müller.pdf')
  assert.equal(filenameCompletions('Beixxx.pdf', 3, 3, words)[0]!.filename, 'Beitragsrechnung.pdf')
  assert.equal(filenameCompletions('Beixxx.pdf', 3, 6, words)[0]!.filename, 'Beitragsrechnung.pdf')
})

test('offers safe phrases and excludes empty prefixes, extensions, numeric prefixes and standalone stop words', () => {
  const phrases = filenameCompletions('Ver.pdf', 3, 3, words)
  assert.ok(phrases.some((item) => item.value === 'Versicherung-für-Fahrzeuge'))
  assert.deepEqual(filenameCompletions('scan.pdf', 6, 6, words), [])
  assert.deepEqual(filenameCompletions('20260301_.pdf', 9, 9, words), [])
  assert.deepEqual(filenameCompletions('2026.pdf', 4, 4, words), [])
  assert.ok(!words.some((word) => word.value === 'für'))
  assert.ok(words.every((word) => !/[<>:"/\\|?*\x00-\x1f]/.test(word.value)))
  const separated = buildFilenameWords(['Rechnung 01.03.2026 ADAC; Konto: Bank'])
  assert.ok(
    !separated.some((word) => word.value === 'Rechnung-ADAC' || word.value === 'Konto-Bank')
  )
})
