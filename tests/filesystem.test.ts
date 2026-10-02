import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, access, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { listDirectory, moveFile, previewFile, renameFile, validatePath } from '../electron/filesystem'

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

test('previews only supported regular documents, including mixed-case extensions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'document-preview-'))
  try {
    await writeFile(join(root, 'scan.PDF'), '%PDF-1.4')
    await writeFile(join(root, 'scan.JpEg'), 'image')
    await writeFile(join(root, 'page.html'), '<script>alert(1)</script>')
    await mkdir(join(root, 'folder.pdf'))
    assert.deepEqual(await previewFile(join(root, 'scan.PDF')), {
      path: join(root, 'scan.PDF'), mime: 'application/pdf', kind: 'pdf'
    })
    assert.equal((await previewFile(join(root, 'scan.JpEg'))).mime, 'image/jpeg')
    await assert.rejects(previewFile(join(root, 'page.html')), /Preview is available/)
    await assert.rejects(previewFile(join(root, 'folder.pdf')), /regular files/)
    await assert.rejects(previewFile(join(root, 'missing.pdf')))
    await assert.rejects(previewFile('relative.pdf'), /absolute filesystem path/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('moves a document preserving its filename and contents, without overwriting collisions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'document-move-'))
  try {
    const archive = join(root, 'archive')
    await mkdir(archive)
    const source = join(root, '20260301_ADAC-Beitragsrechnung.pdf')
    const target = join(archive, '20260301_ADAC-Beitragsrechnung.pdf')
    await writeFile(source, 'original scan')
    assert.equal(await moveFile(source, archive), target)
    assert.equal(await readFile(target, 'utf8'), 'original scan')
    await assert.rejects(access(source))
    await writeFile(source, 'new scan')
    await assert.rejects(moveFile(source, archive), /already exists/)
    assert.equal(await readFile(target, 'utf8'), 'original scan')
    assert.equal(await readFile(source, 'utf8'), 'new scan')
    await assert.rejects(moveFile(source, root), /already exists/)
    await assert.rejects(moveFile(archive, root), /regular files/)
    await assert.rejects(moveFile(source, target), /destination must be a folder/)
    await assert.rejects(moveFile(source, join(root, 'missing')))
    assert.equal(await readFile(source, 'utf8'), 'new scan')
    await assert.rejects(moveFile('relative.pdf', archive), /absolute filesystem path/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('refuses to move source symlinks or overwrite destination symlinks', { skip: process.platform === 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'document-move-links-'))
  try {
    const archive = join(root, 'archive')
    await mkdir(archive)
    const source = join(root, 'scan.pdf')
    const existing = join(root, 'existing.pdf')
    await writeFile(source, 'scan')
    await writeFile(existing, 'existing')
    await symlink(source, join(root, 'linked.pdf'))
    await assert.rejects(moveFile(join(root, 'linked.pdf'), archive), /Symbolic links/)
    await symlink(existing, join(archive, 'scan.pdf'))
    await assert.rejects(moveFile(source, archive), /already exists/)
    assert.equal(await readFile(existing, 'utf8'), 'existing')
    assert.equal(await readFile(source, 'utf8'), 'scan')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('renames in place without overwriting collisions or accepting paths as names', async () => {
  const root = await mkdtemp(join(tmpdir(), 'document-rename-'))
  try {
    const source = join(root, 'scan.pdf')
    const target = join(root, '20260301_ADAC-Beitragsrechnung.pdf')
    await writeFile(source, 'scanned document')
    assert.equal(await renameFile(source, 'scan.pdf'), source)
    assert.equal(await renameFile(source, '20260301_ADAC-Beitragsrechnung.pdf'), target)
    assert.equal(await readFile(target, 'utf8'), 'scanned document')
    await assert.rejects(access(source))
    await writeFile(source, 'another document')
    await assert.rejects(renameFile(source, '20260301_ADAC-Beitragsrechnung.pdf'), /already exists/)
    assert.equal(await readFile(source, 'utf8'), 'another document')
    assert.equal(await readFile(target, 'utf8'), 'scanned document')
    for (const name of ['', '.', '..', '../scan.pdf', 'folder/scan.pdf', 'folder\\scan.pdf', '/tmp/scan.pdf',
      'bad\0.pdf', 'bad?.pdf', 'scan.pdf ', 'scan.', 'CON.pdf', null, 42]) {
      await assert.rejects(renameFile(source, name), /valid filename/)
    }
    await assert.rejects(renameFile(root, 'folder'), /regular files/)
    assert.equal(await readFile(source, 'utf8'), 'another document')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('rename refuses source links and existing destination links', { skip: process.platform === 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'document-rename-link-'))
  try {
    const source = join(root, 'scan.pdf')
    await writeFile(source, 'scanned document')
    await symlink(source, join(root, 'link.pdf'))
    await assert.rejects(renameFile(join(root, 'link.pdf'), 'renamed.pdf'), /Symbolic links/)
    await assert.rejects(renameFile(source, 'link.pdf'), /already exists/)
    assert.equal(await readFile(source, 'utf8'), 'scanned document')
  } finally { await rm(root, { recursive: true, force: true }) }
})
