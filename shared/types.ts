export interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
  isSymbolicLink: boolean
  size: number
  modified: number
  transferPending?: boolean
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

export interface PdfPageEdit {
  index: number
  rotation: number
}

export interface PdfDocumentData {
  data: Uint8Array
  version: string
  size: number
  modified: number
}

export interface FileBrowserAPI {
  archiveContextMenu(root: string, path: string): Promise<'create' | 'rename' | 'delete' | null>
  createArchiveFolder(root: string, parent: string, name: string): Promise<string>
  renameArchiveEntry(root: string, path: string, name: string): Promise<string>
  deleteArchiveEntry(root: string, path: string): Promise<void>
  locations(): Promise<Location[]>
  listDirectory(path: string): Promise<DirectoryListing>
  listInputDirectory(path: string): Promise<DirectoryListing>
  chooseDirectory(): Promise<string | null>
  openFile(path: string): Promise<void>
  previewFile(path: string): Promise<{ url: string; kind: 'pdf' | 'image' }>
  moveFile(source: string, destinationFolder: string): Promise<string>
  renameFile(source: string, name: string): Promise<string>
  readPdf(path: string): Promise<PdfDocumentData>
  ocrPdf(path: string, version: string): Promise<PdfDocumentData>
  savePdf(path: string, version: string, pages: PdfPageEdit[]): Promise<PdfDocumentData>
}
