import { readdir, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, normalize } from 'node:path'
import type { DirectoryListing, FileEntry } from '../shared/types'

export function validatePath(value: unknown): string {
  if (typeof value !== 'string' || !isAbsolute(value) || value.includes('\0')) {
    throw new Error('Please enter an absolute filesystem path.')
  }
  return normalize(value)
}

export async function listDirectory(value: unknown): Promise<DirectoryListing> {
  const path = validatePath(value)
  const children = await readdir(path, { withFileTypes: true })
  const entries: FileEntry[] = []
  let skipped = 0
  // Bound concurrent filesystem calls so large directories do not exhaust file handles.
  let next = 0
  await Promise.all(Array.from({ length: Math.min(32, children.length) }, async () => {
    while (next < children.length) {
      const child = children[next++]!
      const childPath = join(path, child.name)
      try {
        const info = await stat(childPath)
        entries.push({ name: child.name, path: childPath, isDirectory: info.isDirectory(),
          isSymbolicLink: child.isSymbolicLink(), size: info.size, modified: info.mtimeMs })
      } catch {
        skipped++
      }
    }
  }))
  return { path, parent: dirname(path), entries, skipped }
}
