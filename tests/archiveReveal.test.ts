import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isRevealBranch } from '../src/archiveReveal'

test('exclusive folder reveal opens the target and ancestors, but not siblings or descendants', () => {
  const target = '/archive/Home/Electricity'

  for (const folder of ['/archive', '/archive/Home', target]) {
    assert.equal(isRevealBranch(folder, target), true)
  }

  for (const folder of [
    '/archive/Finance',
    '/archive/Homes',
    '/archive/Home/Electricity/Old',
    '/archive/Home/Electric'
  ]) {
    assert.equal(isRevealBranch(folder, target), false)
  }

  assert.equal(isRevealBranch('/archive/Home', ''), false)
  assert.equal(isRevealBranch('/archive/Home/', target), true)
})
test('folder reveal handles Windows separators and the archive root without substring matches', () => {
  assert.equal(isRevealBranch('C:\\archive\\Home', 'C:\\archive\\Home\\Electricity'), true)
  assert.equal(isRevealBranch('C:\\archive\\Home', 'C:/archive/Home/Electricity'), true)
  assert.equal(isRevealBranch('C:\\archive\\Home', 'C:\\archive\\Homes\\Electricity'), false)
  assert.equal(isRevealBranch('/archive/Home', '/archive'), false)
  assert.equal(isRevealBranch('/', '/archive'), true)
})
