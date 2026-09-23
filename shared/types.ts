export interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
  isSymbolicLink: boolean
  size: number
  modified: number
}

export interface DirectoryListing {
  path: string
  parent: string
  entries: FileEntry[]
  skipped: number
}

export interface Location {
  name: string
  path: string
  icon: string
}

export interface FileBrowserAPI {
  locations(): Promise<Location[]>
  listDirectory(path: string): Promise<DirectoryListing>
  chooseDirectory(): Promise<string | null>
  openFile(path: string): Promise<void>
}
