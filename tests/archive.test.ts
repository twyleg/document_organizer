import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  archiveEntry,
  copyArchiveEntry,
  createArchiveFolder,
  renameArchiveEntry,
  trashArchiveEntry,
  moveArchiveFile
} from '../electron/archive'

async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'archive-actions-test-'))
  const root = join(base, 'archive')
  await mkdir(root)
  return { base, root }
}

test('moves an archive file between folders and to the archive root without overwriting', async () => {
  const { base, root } = await fixture()

  try {
    const a = await createArchiveFolder(root, root, 'A')
    const b = await createArchiveFolder(root, root, 'B')
    const source = join(a, 'scan.pdf')
    const target = join(b, 'scan.pdf')
    await writeFile(source, 'source')
    await writeFile(target, 'existing')
    await assert.rejects(moveArchiveFile(root, source, b), /already exists/)
    assert.equal(await readFile(source, 'utf8'), 'source')
    assert.equal(await readFile(target, 'utf8'), 'existing')
    await rm(target)
    assert.equal(await moveArchiveFile(root, source, b), target)
    assert.deepEqual(await readdir(a), [])
    assert.equal(await moveArchiveFile(root, target, root), join(root, 'scan.pdf'))
    assert.equal(await readFile(join(root, 'scan.pdf'), 'utf8'), 'source')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})
test('archive moves reject folders, external destinations, links and the current folder', async () => {
  const { base, root } = await fixture()

  try {
    const folder = await createArchiveFolder(root, root, 'A')
    const outside = join(base, 'outside')
    await mkdir(outside)
    const source = join(root, 'scan.pdf')
    await writeFile(source, 'source')
    await assert.rejects(moveArchiveFile(root, folder, root), /regular file/)
    await assert.rejects(moveArchiveFile(root, source, root), /already in/)
    await assert.rejects(moveArchiveFile(root, source, outside), /inside the archive/)
    await assert.rejects(moveArchiveFile(root, source, source), /archive folder/)
    if (process.platform !== 'win32') {
      await symlink(folder, join(root, 'linked'))
      await assert.rejects(moveArchiveFile(root, source, join(root, 'linked')), /symbolic links/)
    }

    assert.equal(await readFile(source, 'utf8'), 'source')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})
test('creates nested folders and renames directories without losing their documents', async () => {
  const { base, root } = await fixture()

  try {
    const parent = await createArchiveFolder(root, root, 'ADAC')
    const child = await createArchiveFolder(root, parent, 'Insurance')
    await writeFile(join(child, 'scan.pdf'), 'document contents')
    const renamed = await renameArchiveEntry(root, parent, 'AOK')
    assert.equal(await readFile(join(renamed, 'Insurance/scan.pdf'), 'utf8'), 'document contents')
    assert.deepEqual(await readdir(root), ['AOK'])
  } finally {
    await rm(base, { recursive: true, force: true })
  }
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

    for (const name of ['', '..', '../escaped', 'folder/name', 'name.', 'CON']) {
      await assert.rejects(createArchiveFolder(root, b, name), /valid name/)
    }

    assert.deepEqual(await readdir(b), [])
    assert.equal(
      await renameArchiveEntry(root, join(root, 'a.pdf'), 'new.pdf'),
      join(root, 'new.pdf')
    )
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})
test('archive root, external paths and links pointing outside the archive are protected', async () => {
  const { base, root } = await fixture()

  try {
    const outside = join(base, 'outside')
    await mkdir(outside)
    await symlink(outside, join(root, 'linked'), 'dir')
    await mkdir(join(outside, 'child'))
    await assert.rejects(renameArchiveEntry(root, root, 'renamed'), /root/)
    await assert.rejects(
      trashArchiveEntry(root, root, async () => assert.fail('trash called')),
      /root/
    )
    await assert.rejects(createArchiveFolder(root, outside, 'new'), /inside the archive/)
    await assert.rejects(createArchiveFolder(root, join(root, 'linked'), 'new'), /symbolic links/)
    await assert.rejects(archiveEntry(root, join(root, 'linked/child')), /outside the archive/)
    assert.deepEqual(await readdir(outside), ['child'])
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})
test('deletion delegates to trash and a trash failure leaves the original intact', async () => {
  const { base, root } = await fixture()

  try {
    const folder = await createArchiveFolder(root, root, 'Folder')
    await writeFile(join(folder, 'scan.pdf'), 'document')
    const calls: string[] = []
    await trashArchiveEntry(root, folder, async (path) => {
      calls.push(path)
    })
    assert.deepEqual(calls, [folder])
    await assert.rejects(
      trashArchiveEntry(root, folder, async () => {
        throw new Error('Trash unavailable')
      }),
      /Trash unavailable/
    )
    assert.equal(await readFile(join(folder, 'scan.pdf'), 'utf8'), 'document')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('copies archive files and nested folders while retaining sources and refusing overwrites', async () => {
  const { base, root } = await fixture()

  try {
    const sourceFolder = await createArchiveFolder(root, root, 'Fictional sender')
    const nested = await createArchiveFolder(root, sourceFolder, 'Statements')
    const destination = await createArchiveFolder(root, root, 'Review')
    const filename = '20250115_Fictional sender-Statement.pdf'
    await writeFile(join(nested, filename), 'fictional document')

    const copiedFile = await copyArchiveEntry(root, join(nested, filename), root)
    assert.equal(copiedFile, join(root, filename))
    assert.equal(await readFile(copiedFile, 'utf8'), 'fictional document')
    assert.equal(await readFile(join(nested, filename), 'utf8'), 'fictional document')
    await assert.rejects(copyArchiveEntry(root, join(nested, filename), root), /already exists/)
    assert.equal(await readFile(copiedFile, 'utf8'), 'fictional document')

    const copiedFolder = await copyArchiveEntry(root, sourceFolder, destination)
    assert.equal(
      await readFile(join(copiedFolder, 'Statements', filename), 'utf8'),
      'fictional document'
    )
    assert.equal(await readFile(join(nested, filename), 'utf8'), 'fictional document')
    await assert.rejects(copyArchiveEntry(root, sourceFolder, destination), /already exists/)
    assert.equal(
      await readFile(join(copiedFolder, 'Statements', filename), 'utf8'),
      'fictional document'
    )
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('archive copies reject root, descendants, external paths and non-folder destinations', async () => {
  const { base, root } = await fixture()

  try {
    const source = await createArchiveFolder(root, root, 'Source')
    const child = await createArchiveFolder(root, source, 'Child')
    const outside = join(base, 'outside')
    await mkdir(outside)
    const document = join(source, 'document.pdf')
    await writeFile(document, 'fictional document')

    await assert.rejects(copyArchiveEntry(root, root, child), /root/)
    await assert.rejects(copyArchiveEntry(root, source, source), /descendants/)
    await assert.rejects(copyArchiveEntry(root, source, child), /descendants/)
    await assert.rejects(copyArchiveEntry(root, source, outside), /inside the archive/)
    await assert.rejects(copyArchiveEntry(root, source, document), /archive folder/)
    await assert.rejects(copyArchiveEntry(root, document, source), /already exists/)
    assert.deepEqual(await readdir(child), [])
    assert.equal(await readFile(document, 'utf8'), 'fictional document')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('a symbolic link in a copied subtree aborts and removes only the incomplete copy', async () => {
  const { base, root } = await fixture()

  try {
    const source = await createArchiveFolder(root, root, 'Source')
    const destination = await createArchiveFolder(root, root, 'Destination')
    const outside = join(base, 'outside.pdf')
    await writeFile(outside, 'private fictional contents')
    await writeFile(join(source, 'a.pdf'), 'fictional document')
    await writeFile(join(destination, 'existing.pdf'), 'existing document')
    await symlink(outside, join(source, 'z.pdf'))

    await assert.rejects(copyArchiveEntry(root, source, destination), /symbolic links/)
    assert.deepEqual(await readdir(destination), ['existing.pdf'])
    assert.equal(await readFile(join(source, 'a.pdf'), 'utf8'), 'fictional document')
    assert.equal(await readFile(outside, 'utf8'), 'private fictional contents')
    await assert.rejects(
      copyArchiveEntry(root, join(source, 'z.pdf'), destination),
      /symbolic links/
    )
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})
