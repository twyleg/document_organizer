import { dirname, relative } from 'node:path'
import { archiveEntry } from './archive'

export async function inputFile(root: unknown, path: unknown) {
  const entry = await archiveEntry(root, path)
  if (entry.isDirectory || dirname(relative(entry.root, entry.path)) !== '.') {
    throw new Error('Choose a regular file directly inside the input folder.')
  }

  return entry
}

export async function trashInputFile(
  root: unknown,
  path: unknown,
  trash: (path: string) => Promise<void>
) {
  const entry = await inputFile(root, path)
  await trash(entry.path)
}
