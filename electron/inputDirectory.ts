import { lstat, open } from 'node:fs/promises'
import { dirname } from 'node:path'
import { listDirectory, validatePath } from './filesystem'
import type { FileEntry } from '../shared/types'

const signature = (entry: Pick<FileEntry, 'size' | 'modified'>) => `${entry.size}:${entry.modified}`
interface Observation { signature: string; since: number; ready: boolean }

// FTP servers rarely expose transfer completion. Wait for quiet metadata and,
// for PDFs, a final EOF marker. OCR still validates a snapshot and its hash.
export class InputDirectoryReader {
  private root = ''
  private observations = new Map<string, Observation>()
  constructor(private quietMs = 4000) {}

  async read(value: unknown, now = Date.now()) {
    const path = validatePath(value)
    const listing = await listDirectory(path)
    if (this.root !== path) { this.root = path; this.observations.clear() }
    const paths = new Set(listing.entries.map(entry => entry.path))
    for (const key of this.observations.keys()) if (!paths.has(key)) this.observations.delete(key)
    const inspect = async (entry: FileEntry) => {
      if (entry.isDirectory || entry.name.startsWith('.')) return
      const stamp = signature(entry)
      let observed = this.observations.get(entry.path)
      if (!observed || observed.signature !== stamp) {
        observed = { signature: stamp, since: now, ready: false }
        this.observations.set(entry.path, observed)
      }
      if (!observed.ready && !/\.(?:part|partial|filepart|tmp|upload)$/i.test(entry.name) && now - observed.since >= this.quietMs) {
        observed.ready = !/\.pdf$/i.test(entry.name) || entry.isSymbolicLink || await this.hasPdfEnd(entry.path, stamp)
      }
      entry.transferPending = !observed.ready
    }
    let next = 0
    await Promise.all(Array.from({ length: Math.min(32, listing.entries.length) }, async () => {
      while (next < listing.entries.length) await inspect(listing.entries[next++]!)
    }))
    return listing
  }

  async acknowledge(value: string, expected?: Pick<FileEntry, 'size' | 'modified'>) {
    const path = validatePath(value)
    if (dirname(path) !== this.root) return
    const info = await lstat(path)
    const stamp = signature({ size: info.size, modified: info.mtimeMs })
    if (expected && signature(expected) !== stamp) return
    this.observations.set(path, { signature: stamp, since: Date.now(), ready: true })
  }

  private async hasPdfEnd(path: string, stamp: string) {
    try {
      const file = await open(path, 'r')
      try {
        const info = await file.stat()
        if (signature({ size: info.size, modified: info.mtimeMs }) !== stamp || !info.size) return false
        const tail = Buffer.alloc(Math.min(1024, info.size))
        await file.read(tail, 0, tail.length, info.size - tail.length)
        if (!/%%EOF[\s\0]*$/.test(tail.toString('latin1'))) return false
        const after = await lstat(path)
        return signature({ size: after.size, modified: after.mtimeMs }) === stamp
      } finally { await file.close() }
    } catch { return false }
  }
}
