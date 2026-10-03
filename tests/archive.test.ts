import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { archiveEntry, createArchiveFolder, renameArchiveEntry, trashArchiveEntry } from '../electron/archive'

async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'archive-actions-test-'))
  const root = join(base, 'archive')
  await mkdir(root)
  return { base, root }
}
test('creates nested folders and renames directories without losing their documents', async () => {
  const { base, root } = await fixture()
  try {
    const parent = await createArchiveFolder(root, root, 'ADAC')
    const child = await createArchiveFolder(root, parent, 'Insurance')
    await writeFile(join(child, 'scan.pdf'), 'document contents')
    const renamed = await renameArchiveEntry(root, parent, 'AOK')
    assert.equal(await readFile(join(renamed, 'Insurance/scan.pdf'), 'utf8'), 'document contents')
    assert.deepEqual(await readdir(root), ['AOK'])
  } finally { await rm(base, { recursive: true, force: true }) }
})
test('duplicate names and invalid names never overwrite existing files or folders', async () => {
  const { base, root } = await fixture()
  try {
    const a = await createArchiveFolder(root, root, 'A')
    const b = await createArchiveFolder(root, root, 'B')
    await assert.rejects(renameArchiveEntry(root, a, 'B'), /already exists/)
    await assert.rejects(createArchiveFolder(root, root, 'A'), /already exists/)
    await writeFile(join(root, 'a.pdf'), 'first')
    await writeFile(join(root, 'b.pdf'), 'second')
    await assert.rejects(renameArchiveEntry(root, join(root, 'a.pdf'), 'b.pdf'), /already exists/)
    assert.equal(await readFile(join(root, 'b.pdf'), 'utf8'), 'second')
    assert.equal(await readFile(join(root, 'a.pdf'), 'utf8'), 'first')
    for (const name of ['', '..', '../escaped', 'folder/name', 'name.', 'CON']) await assert.rejects(createArchiveFolder(root, b, name), /valid name/)
    assert.deepEqual(await readdir(b), [])
    assert.equal(await renameArchiveEntry(root, join(root, 'a.pdf'), 'new.pdf'), join(root, 'new.pdf'))
  } finally { await rm(base, { recursive: true, force: true }) }
})
test('archive root, external paths and links pointing outside the archive are protected', async () => {
  const { base, root } = await fixture()
  try {
    const outside = join(base, 'outside'); await mkdir(outside)
    await symlink(outside, join(root, 'linked'), 'dir')
    await mkdir(join(outside, 'child'))
    await assert.rejects(renameArchiveEntry(root, root, 'renamed'), /root/)
    await assert.rejects(trashArchiveEntry(root, root, async () => assert.fail('trash called')), /root/)
    await assert.rejects(createArchiveFolder(root, outside, 'new'), /inside the archive/)
    await assert.rejects(createArchiveFolder(root, join(root, 'linked'), 'new'), /symbolic links/)
    await assert.rejects(archiveEntry(root, join(root, 'linked/child')), /outside the archive/)
    assert.deepEqual(await readdir(outside), ['child'])
  } finally { await rm(base, { recursive: true, force: true }) }
})
test('deletion delegates to trash and a trash failure leaves the original intact', async () => {
  const { base, root } = await fixture()
  try {
    const folder = await createArchiveFolder(root, root, 'Folder')
    await writeFile(join(folder, 'scan.pdf'), 'document')
    const calls: string[] = []
    await trashArchiveEntry(root, folder, async path => { calls.push(path) })
    assert.deepEqual(calls, [folder])
    await assert.rejects(trashArchiveEntry(root, folder, async () => { throw new Error('Trash unavailable') }), /Trash unavailable/)
    assert.equal(await readFile(join(folder, 'scan.pdf'), 'utf8'), 'document')
  } finally { await rm(base, { recursive: true, force: true }) }
})
