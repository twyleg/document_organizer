import { test } from 'node:test'
import assert from 'node:assert/strict'
import { startupDirectories } from '../electron/startupDirectories'

test('startup directories resolve paths, preserve spaces, and allow overriding dev defaults', () => {
  assert.deepEqual(startupDirectories(['electron', 'app', '--inspect=9229'], '/tmp'), {})
  assert.deepEqual(startupDirectories(['--input', 'default/input', '--archive=default/archive', '--input', 'other input', '--archive', '/archive'], '/tmp'), { input: '/tmp/other input', archive: '/archive' })
  for (const args of [['--input'], ['--archive='], ['--input', '--archive', '/tmp']]) {
    assert.throws(() => startupDirectories(args), /requires a directory path/)
  }
})
