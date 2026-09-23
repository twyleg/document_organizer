import type { FileBrowserAPI } from '../shared/types'
declare global {
  interface Window { files: FileBrowserAPI }
}
