import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { listDirectory, validatePath } from '../electron/filesystem'

test('lists files, folders and hidden files with metadata and parent navigation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'file-browser-'))
  try {
    await mkdir(join(root, 'folder'))
    await writeFile(join(root, 'hello.txt'), 'hello')
    await writeFile(join(root, '.hidden'), '')
    const result = await listDirectory(root)
    assert.equal(result.path, root)
    assert.equal(result.parent, dirname(root))
    assert.equal(result.entries.length, 3)
    assert.equal(result.entries.find(entry => entry.name === 'folder')?.isDirectory, true)
    assert.equal(result.entries.find(entry => entry.name === 'hello.txt')?.size, 5)
    assert.equal(result.skipped, 0)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('follows folder symlinks and reports broken links without losing the listing', { skip: process.platform === 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'file-browser-'))
  try {
    await mkdir(join(root, 'folder'))
    await symlink(join(root, 'folder'), join(root, 'linked'))
    await symlink(join(root, 'missing'), join(root, 'broken'))
    const result = await listDirectory(root)
    const linked = result.entries.find(entry => entry.name === 'linked')
    assert.equal(linked?.isDirectory, true)
    assert.equal(linked?.isSymbolicLink, true)
    assert.equal(result.skipped, 1)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('rejects invalid paths and propagates unavailable folder errors', async () => {
  for (const value of ['', 'relative/path', null, 42, '/bad\0path']) {
    assert.throws(() => validatePath(value), /absolute filesystem path/)
  }
  const root = await mkdtemp(join(tmpdir(), 'file-browser-'))
  try {
    await writeFile(join(root, 'file'), '')
    await assert.rejects(listDirectory(join(root, 'missing')))
    await assert.rejects(listDirectory(join(root, 'file')))
  } finally { await rm(root, { recursive: true, force: true }) }
})
