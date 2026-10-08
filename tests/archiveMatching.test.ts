import { reactive } from 'vue'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMatchingHandler, type MatchingReply, type MatchingRequest } from '../shared/archiveMatching'
import { ArchiveSimilarity, type ArchiveDocument } from '../shared/archiveSimilarity'
import { createArchiveMatcher, type MatchingPort } from '../src/archiveMatcher'

const document: ArchiveDocument = { relativePath: 'Home/20250101_LumenGrid-Electricity bill.pdf', folder: 'Home', filename: '20250101_LumenGrid-Electricity bill.pdf', text: 'LumenGrid electricity meter tariff', pages: ['LumenGrid electricity meter tariff'], missingPages: [], hash: 'fictional', date: '20250101', sender: 'LumenGrid', subject: 'Electricity bill' }

test('background matching preserves baseline evidence and clears cached results for a new snapshot', () => {
  const handle = createMatchingHandler()
  assert.match(handle({ id: 1, type: 'suggest', pages: ['electricity meter'], cacheKey: 'input' }).error!, /not ready/)
  assert.deepEqual(handle({ id: 2, type: 'fit', documents: [document] }), { id: 2 })
  const pages = ['LumenGrid electricity meter tariff. Document date 2026-10-03']
  const request: MatchingRequest = { id: 3, type: 'suggest', pages, cacheKey: 'input:size:mtime' }
  const result = handle(request).result!
  assert.deepEqual(result, new ArchiveSimilarity([document]).suggest(pages))
  assert.ok(result.filenames.includes('20261003_LumenGrid-Electricity bill.pdf'))
  assert.equal(handle({ ...request, id: 4 }).result, result)
  handle({ id: 5, type: 'fit', documents: [] })
  assert.deepEqual(handle({ ...request, id: 6 }).result?.matches, [])
  assert.deepEqual(handle({ id: 7, type: 'suggest', pages: [''], cacheKey: 'blank' }).result?.matches, [])
})

function fakePort() {
  const sent: MatchingRequest[] = []
  let terminated = false
  const port: MatchingPort = { onmessage: null, onerror: null, postMessage: message => { sent.push(structuredClone(message)) }, terminate: () => { terminated = true } }
  const reply = (data: MatchingReply) => port.onmessage?.({ data } as MessageEvent<MatchingReply>)
  return { port, sent, reply, terminated: () => terminated }
}
test('worker requests keep their results separate and reject pending work on disposal', async () => {
  const fake = fakePort(), client = createArchiveMatcher(fake.port)
  const fitting = client.fit([document])
  fake.reply({ id: fake.sent[0]!.id })
  await fitting
  const first = client.suggest(reactive(['electricity meter']), 'first'), second = client.suggest(['unknown'], 'second')
  const result = new ArchiveSimilarity([document]).suggest(['electricity meter'])
  const empty = new ArchiveSimilarity([]).suggest(['unknown'])
  fake.reply({ id: fake.sent[2]!.id, result: empty })
  fake.reply({ id: fake.sent[1]!.id, result })
  assert.equal(await first, result)
  assert.equal(await second, empty)
  const pending = client.suggest(['electricity'], 'pending')
  const rejection = assert.rejects(pending, /cancelled/)
  client.dispose()
  await rejection
  assert.equal(fake.terminated(), true)
  await assert.rejects(client.suggest([], 'late'), /cancelled/)
})
test('worker failures are surfaced instead of leaving suggestions loading indefinitely', async () => {
  const fake = fakePort(), client = createArchiveMatcher(fake.port)
  const pending = client.fit([document])
  const rejection = assert.rejects(pending, /worker failed/)
  fake.port.onerror?.({ message: 'worker failed' } as ErrorEvent)
  await rejection
  assert.equal(fake.terminated(), true)
})
