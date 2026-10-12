import { resolve } from 'node:path'
import type { StartupDirectories } from '../shared/types'

/** Ignore Electron's own switches; later directory arguments override earlier ones. */
export function startupDirectories(args: string[], cwd = process.cwd()): StartupDirectories {
  const directories: StartupDirectories = {}

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    const flag = arg.split('=', 1)[0]
    const isInput = flag === '--input' || flag === '--input_directory'
    const isArchive = flag === '--archive' || flag === '--archive_directory'
    if (!isInput && !isArchive) {
      continue
    }

    const value = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : args[++i]
    if (!value || value.startsWith('--')) {
      throw new Error(`${flag} requires a directory path.`)
    }

    directories[isInput ? 'input' : 'archive'] = resolve(cwd, value)
  }

  return directories
}
