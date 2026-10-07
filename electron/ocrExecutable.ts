import { access } from 'node:fs/promises'
import { join } from 'node:path'

export async function resolveOcrExecutable(executable?: string, moduleDirectory = __dirname) {
  const configured = executable ?? process.env.DOCUMENT_ORGANIZER_OCRMYPDF
  if (configured) return configured
  const entry = process.platform === 'win32' ? 'Scripts/ocrmypdf.exe' : 'bin/ocrmypdf'
  // Source scripts run from electron/, while the built app runs from out/main/.
  for (const root of ['..', '../..']) {
    const local = join(moduleDirectory, root, '.venv-ocr', entry)
    try { await access(local); return local } catch { /* Try the next layout. */ }
  }
  return 'ocrmypdf'
}
