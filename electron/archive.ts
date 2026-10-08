import { lstat, mkdir, realpath, rename, rmdir, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { moveFile, renameFile, validatePath } from './filesystem'

function inside(root: string, path: string) {
  const part = relative(root, path)
  return !isAbsolute(part) && part !== '..' && !part.startsWith('../') && !part.startsWith('..\\')
}

function validName(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value !== value.trim() ||
    /[<>:"/\\|?*\x00-\x1f]/.test(value) ||
    value === '.' ||
    value === '..' ||
    /[. ]$/.test(value) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)
  ) {
    throw new Error('Enter a valid name without folder separators or special characters.')
  }

  return value
}

export async function archiveEntry(rootValue: unknown, pathValue: unknown, allowRoot = false) {
  const root = validatePath(rootValue)
  const path = validatePath(pathValue)
  if (!inside(root, path) || (!allowRoot && root === path)) {
    throw new Error(
      'Choose an entry inside the archive. The archive root cannot be renamed or deleted.'
    )
  }
  if (!(await stat(root)).isDirectory()) {
    throw new Error('The archive root must be a folder.')
  }

  const info = await lstat(path)
  if (info.isSymbolicLink()) {
    throw new Error('Archive changes through symbolic links are not supported.')
  }
  if (!inside(await realpath(root), await realpath(path))) {
    throw new Error('This entry points outside the archive.')
  }
  if (!info.isDirectory() && !info.isFile()) {
    throw new Error('Choose a regular file or folder.')
  }

  return { root, path, isDirectory: info.isDirectory() }
}

export async function createArchiveFolder(
  rootValue: unknown,
  parentValue: unknown,
  nameValue: unknown
) {
  const parent = await archiveEntry(rootValue, parentValue, true)
  if (!parent.isDirectory) {
    throw new Error('New folders must be created inside a folder.')
  }

  const path = join(parent.path, validName(nameValue))

  try {
    await mkdir(path)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error('An entry with this name already exists.')
    }

    throw cause
  }

  return path
}

export async function renameArchiveEntry(
  rootValue: unknown,
  pathValue: unknown,
  nameValue: unknown
) {
  const entry = await archiveEntry(rootValue, pathValue)
  const path = join(dirname(entry.path), validName(nameValue))
  if (path === entry.path) {
    return path
  }
  if (!entry.isDirectory) {
    return renameFile(entry.path, nameValue)
  }

  // Reserve the destination exclusively. On Linux, rename replaces this empty
  // reservation atomically; an existing folder or file is never used as a target.
  try {
    await mkdir(path)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error('An entry with this name already exists.')
    }

    throw cause
  }

  const reserved = await lstat(path)

  try {
    await rename(entry.path, path)
  } catch (cause) {
    const current = await lstat(path).catch(() => undefined)
    if (current?.ino === reserved.ino && current.dev === reserved.dev) {
      await rmdir(path).catch(() => {})
    }

    throw cause
  }

  return path
}

export async function trashArchiveEntry(
  rootValue: unknown,
  pathValue: unknown,
  trash: (path: string) => Promise<void>
) {
  const entry = await archiveEntry(rootValue, pathValue)
  await trash(entry.path)
}

export async function moveArchiveFile(root: unknown, source: unknown, destination: unknown) {
  const entry = await archiveEntry(root, source)
  const folder = await archiveEntry(root, destination, true)
  if (entry.isDirectory || !folder.isDirectory) {
    throw new Error('Move a regular file into an archive folder.')
  }
  if (dirname(entry.path) === folder.path) {
    throw new Error('This file is already in that folder.')
  }

  return moveFile(entry.path, folder.path)
}
