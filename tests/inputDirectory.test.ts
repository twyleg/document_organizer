import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appendFile, mkdtemp, rename, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PDFDocument } from 'pdf-lib'
import { InputDirectoryReader } from '../electron/inputDirectory'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'input-transfer-test-'))
  const pdf = await PDFDocument.create()
  pdf.addPage().drawText('Incoming scan')
  const data = Buffer.from(await pdf.save())
  return { root, data, reader: new InputDirectoryReader(), path: join(root, 'scan.pdf') }
}

test('incomplete uploads remain pending through pauses and wait again after the final chunk', async () => {
  const { root, data, reader, path } = await fixture()
  try {
    const cut = data.lastIndexOf('%%EOF')
    await writeFile(path, data.subarray(0, cut))
    assert.equal((await reader.read(root, 0)).entries[0]!.transferPending, true)
    assert.equal((await reader.read(root, 8000)).entries[0]!.transferPending, true, 'a quiet incomplete PDF is not ready')
    await appendFile(path, data.subarray(cut))
    assert.equal((await reader.read(root, 9000)).entries[0]!.transferPending, true)
    assert.equal((await reader.read(root, 12999)).entries[0]!.transferPending, true)
    assert.equal((await reader.read(root, 13000)).entries[0]!.transferPending, false)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('each incoming file settles independently; timestamp changes restart the quiet period', async () => {
  const { root, data, reader, path } = await fixture()
  try {
    await writeFile(path, data)
    await reader.read(root, 0)
    const other = join(root, 'other.pdf')
    await writeFile(other, data)
    const listing = await reader.read(root, 4000)
    assert.equal(listing.entries.find(entry => entry.path === path)!.transferPending, false)
    assert.equal(listing.entries.find(entry => entry.path === other)!.transferPending, true)
    const info = await stat(path)
    await utimes(path, info.atime, new Date(info.mtimeMs + 10000))
    assert.equal((await reader.read(root, 5000)).entries.find(entry => entry.path === path)!.transferPending, true)
    assert.equal((await reader.read(root, 9000)).entries.find(entry => entry.path === path)!.transferPending, false)
    await rm(path)
    await reader.read(root, 10000)
    await writeFile(path, data)
    assert.equal((await reader.read(root, 11000)).entries.find(entry => entry.path === path)!.transferPending, true)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('known application writes and renames stay ready without a new transfer delay', async () => {
  const { root, data, reader, path } = await fixture()
  try {
    await writeFile(path, data)
    await reader.read(root, 0)
    await reader.acknowledge(path)
    assert.equal((await reader.read(root, 1)).entries[0]!.transferPending, false)
    const target = join(root, 'renamed.pdf')
    await rename(path, target)
    await reader.acknowledge(target)
    assert.equal((await reader.read(root, 2)).entries[0]!.transferPending, false)
    await writeFile(target, Buffer.alloc(0))
    assert.equal((await reader.read(root, 3)).entries[0]!.transferPending, true)
    assert.equal((await reader.read(root, 9000)).entries[0]!.transferPending, true)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('temporary upload names wait for a final rename and stale write acknowledgements cannot mark new content ready', async () => {
  const { root, data, reader, path } = await fixture()
  try {
    const temp = path + '.part'
    await writeFile(temp, data)
    await reader.read(root, 0)
    assert.equal((await reader.read(root, 9000)).entries[0]!.transferPending, true)
    await rename(temp, path)
    assert.equal((await reader.read(root, 10000)).entries[0]!.transferPending, true)
    assert.equal((await reader.read(root, 14000)).entries[0]!.transferPending, false)
    const info = await stat(path)
    const before = { size: info.size, modified: info.mtimeMs }
    await writeFile(path, data.subarray(0, data.lastIndexOf('%%EOF')))
    await reader.acknowledge(path, before)
    assert.equal((await reader.read(root, 15000)).entries[0]!.transferPending, true)
    assert.equal((await reader.read(root, 20000)).entries[0]!.transferPending, true)
  } finally { await rm(root, { recursive: true, force: true }) }
})
