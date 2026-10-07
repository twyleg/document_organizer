import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inputFile, trashInputFile } from '../electron/inputActions'

test('input deletion delegates to trash and preserves a file on failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'input-delete-'))
  try {
    const path = join(root, 'scan.pdf')
    await writeFile(path, 'scan')
    assert.equal((await inputFile(root + '/', path)).path, path)
    const calls: string[] = []
    await trashInputFile(root, path, async target => { calls.push(target) })
    assert.deepEqual(calls, [path])
    await assert.rejects(trashInputFile(root, path, async () => { throw new Error('Trash unavailable') }), /Trash unavailable/)
    assert.equal(await readFile(path, 'utf8'), 'scan')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('input deletion rejects the root, folders, nested files, external files and links', async () => {
  const base = await mkdtemp(join(tmpdir(), 'input-delete-boundary-'))
  try {
    const root = join(base, 'input'), folder = join(root, 'nested')
    await mkdir(folder, { recursive: true })
    const nested = join(folder, 'scan.pdf'), outside = join(base, 'outside.pdf')
    await writeFile(nested, 'nested')
    await writeFile(outside, 'outside')
    for (const path of [root, folder, nested, outside]) {
      await assert.rejects(trashInputFile(root, path, async () => assert.fail('Invalid target reached trash')))
    }
    if (process.platform !== 'win32') {
      const link = join(root, 'link.pdf')
      await symlink(outside, link)
      await assert.rejects(inputFile(root, link), /symbolic links/)
    }
    assert.equal(await readFile(nested, 'utf8'), 'nested')
    assert.equal(await readFile(outside, 'utf8'), 'outside')
  } finally { await rm(base, { recursive: true, force: true }) }
})
