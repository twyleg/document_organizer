import { test } from 'node:test'
import assert from 'node:assert/strict'
import { recommendFolders, searchFolders } from '../src/folderTargets'

const folders = [
  { path: '/archive/Fahrzeuge', relative: 'Fahrzeuge' },
  { path: '/archive/Fahrzeuge/Golf/Versicherungen/ADAC', relative: 'Fahrzeuge/Golf/Versicherungen/ADAC' },
  { path: '/archive/Gesundheit/AOK', relative: 'Gesundheit/AOK' },
  { path: '/archive/Steuern', relative: 'Steuern' },
  { path: '/archive/Buro', relative: 'Büro/Straße' },
]
test('recommendations rank combined sender and parent-folder evidence first and expose keywords', () => {
  const result = recommendFolders(folders, 'ADAC Versicherung für Golf', 'scan.pdf')
  assert.equal(result[0]?.path, folders[1]!.path)
  assert.deepEqual(result[0]?.keywords, ['golf', 'versicherungen', 'adac'])
  assert.ok(result.every(folder => folder.score > 0))
  assert.ok(!result.some(folder => folder.path.includes('AOK')))
})
test('recommendations fall back to the filename and do not invent matches', () => {
  assert.equal(recommendFolders(folders, '', '20260301_AOK-Beitrag.pdf')[0]?.path, folders[2]!.path)
  assert.deepEqual(recommendFolders(folders, 'ordinary unrelated words', 'scan.pdf'), [])
  assert.deepEqual(recommendFolders(folders, 'AOKAY', 'scan.pdf'), [])
})
test('folder search matches multiple path terms, case, accents and German sharp s', () => {
  assert.deepEqual(searchFolders(folders, 'gOlF adac').map(folder => folder.path), [folders[1]!.path])
  assert.deepEqual(searchFolders(folders, 'buro strasse').map(folder => folder.path), [folders[4]!.path])
  assert.deepEqual(searchFolders(folders, 'missing'), [])
  assert.equal(searchFolders(folders, '').length, folders.length)
})
