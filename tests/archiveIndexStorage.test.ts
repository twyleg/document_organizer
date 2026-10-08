import type { ArchiveIndexProgress } from '../shared/types'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { archiveIndexPath, buildArchiveIndex, migrateArchiveIndex } from '../electron/archiveIndex'

test('archive-local index migrates legacy content and removes the old copy only after success', async () => {
  const base = await mkdtemp(join(tmpdir(), 'index-storage-'))

  try {
    const root = join(await realpath(base), 'archive')
    const userData = join(base, 'userData')
    await mkdir(root)
    await mkdir(userData)
    const legacyPath = join(
      userData,
      `archive-index-${createHash('sha256').update(root).digest('hex')}.json`
    )
    const index = { schema: 1, archive: root, builtAt: 'old', documents: [], errors: [] }
    await writeFile(legacyPath, JSON.stringify(index))
    assert.deepEqual(await migrateArchiveIndex(root, root, userData), index)
    assert.deepEqual(JSON.parse(await readFile(archiveIndexPath(root), 'utf8')), index)
    await assert.rejects(stat(legacyPath), { code: 'ENOENT' })
    if (process.platform !== 'win32') {
      assert.equal((await stat(archiveIndexPath(root))).mode & 0o777, 0o600)
    }

    const progress: ArchiveIndexProgress[] = []
    assert.equal(
      (
        await buildArchiveIndex(root, archiveIndexPath(root), undefined, (event) =>
          progress.push(event)
        )
      ).documents.length,
      0
    )
    assert.equal(progress.at(-1)?.phase, 'complete')
    assert.equal(progress.at(-1)?.total, 0)
    assert.equal(progress.at(-1)?.processed, 0)
    assert.deepEqual(await readdir(root), ['.document-organizer-text-index.json'])
    const refreshed = await readFile(archiveIndexPath(root), 'utf8')
    await writeFile(legacyPath, JSON.stringify(index))
    await migrateArchiveIndex(root, root, userData)
    assert.equal(await readFile(archiveIndexPath(root), 'utf8'), refreshed)
    await assert.rejects(stat(legacyPath), { code: 'ENOENT' })
    // An unsafe destination must not cause the only existing cache to be removed.
    await rm(archiveIndexPath(root))
    await symlink(join(base, 'outside.json'), archiveIndexPath(root))
    await writeFile(legacyPath, JSON.stringify(index))
    await assert.rejects(migrateArchiveIndex(root, root, userData), /regular file/)
    assert.deepEqual(JSON.parse(await readFile(legacyPath, 'utf8')), index)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})
