import { copyFile, lstat, readdir, stat, unlink } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, normalize } from 'node:path'
import type { DirectoryListing, FileEntry } from '../shared/types'

export function validatePath(value: unknown): string {
  if (typeof value !== 'string' || !isAbsolute(value) || value.includes('\0')) {
    throw new Error('Please enter an absolute filesystem path.')
  }
  return normalize(value)
}

export async function renameFile(sourceValue: unknown, nameValue: unknown): Promise<string> {
  const source = validatePath(sourceValue)
  if (typeof nameValue !== 'string' || !nameValue.trim() || nameValue !== nameValue.trim() ||
      nameValue === '.' || nameValue === '..' || /[<>:"/\\|?*\x00-\x1f]/.test(nameValue) || /[. ]$/.test(nameValue) ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(nameValue)) {
    throw new Error('Enter a valid filename without folder separators or special characters.')
  }
  if (!(await lstat(source)).isFile()) throw new Error('Only regular files can be renamed. Symbolic links are not supported.')
  const destination = join(dirname(source), nameValue)
  if (destination === source) return source
  try { await copyFile(source, destination, constants.COPYFILE_EXCL) }
  catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`A file named "${nameValue}" already exists. Choose another name.`)
    throw cause
  }
  try { await unlink(source) }
  catch { throw new Error(`A copy was created as "${nameValue}", but the original could not be removed. Both copies have been kept.`) }
  return destination
}

export async function moveFile(sourceValue: unknown, folderValue: unknown): Promise<string> {
  const source = validatePath(sourceValue)
  const folder = validatePath(folderValue)
  if (!(await lstat(source)).isFile()) throw new Error('Only regular files can be moved. Symbolic links are not supported.')
  if (!(await stat(folder)).isDirectory()) throw new Error('The destination must be a folder.')
  const destination = join(folder, basename(source))
  try {
    // Exclusive copy works across drives and cannot overwrite an existing file or link.
    await copyFile(source, destination, constants.COPYFILE_EXCL)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`A file named "${basename(source)}" already exists in this folder. Nothing was moved.`)
    }
    throw cause
  }
  try { await unlink(source) }
  catch {
    throw new Error(`The file was copied to "${destination}", but the original could not be removed. Both copies have been kept.`)
  }
  return destination
}

export async function previewFile(value: unknown) {
  const path = validatePath(value)
  const info = await stat(path)
  if (!info.isFile()) throw new Error('Only regular files can be previewed.')
  // Only passive document formats are served to the embedded viewer.
  const mimeTypes: Record<string, string> = {
    '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp'
  }
  const mime = mimeTypes[extname(path).toLowerCase()]
  if (!mime) throw new Error('Preview is available for PDF, PNG, JPEG, GIF, WebP and BMP files. Open this file in its default application instead.')
  return { path, mime, kind: mime === 'application/pdf' ? 'pdf' as const : 'image' as const }
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
