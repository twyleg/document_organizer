import type { ArchiveIndexProgress } from '../shared/types'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ArchiveSimilarity, parseArchiveFilename, similarityTerms, type ArchiveDocument } from '../shared/archiveSimilarity'
import { buildArchiveIndex, extractArchiveText, loadArchiveIndex } from '../electron/archiveIndex'
import { evaluateArchive, type EvaluationLabel } from '../shared/archiveEvaluation'
import { generateSyntheticArchive } from '../scripts/syntheticArchive'

function document(text: string, filename = '20250101_LumenGrid-Electricity bill.pdf', folder = 'Home/Utilities'): ArchiveDocument {
  return { relativePath: `${folder}/${filename}`, folder, filename, text, pages: [text], hash: 'fixture', missingPages: [], ...parseArchiveFilename(filename) }
}
test('filename labels require a valid date and a sender-subject separator', () => {
  assert.deepEqual(parseArchiveFilename('20240229_CedarMutual-Health-policy.pdf'), { date: '20240229', sender: 'CedarMutual', subject: 'Health-policy' })
  for (const name of ['20250229_LumenGrid-Bill.pdf', 'scan.pdf', '20250101_Sender.pdf']) assert.deepEqual(parseArchiveFilename(name), {})
})
test('terms discard changing dates, month names, invoice identifiers and common words', () => {
  assert.deepEqual(similarityTerms('The INV12345 electricity 2025-01-20 January für meter ZZ9981'), ['electricity', 'meter'])
})
test('distinctive text outranks shared numbers; explanations name contributing terms and use new dates only', () => {
  const electricity = document('LumenGrid electricity consumption meter kilowatt tariff INV888 2025-01-01')
  const bank = document('HarborBank account deposit transactions balance INV999 2026-08-17', '20250102_HarborBank-Statement.pdf', 'Finance/Bank')
  const engine = new ArchiveSimilarity([electricity, bank])
  const result = engine.suggest(['LumenGrid electricity meter tariff invoice INV999. Document date: 2026-08-17'])
  assert.equal(result.folders[0]?.value, electricity.folder)
  assert.equal(result.senders[0]?.value, 'LumenGrid')
  assert.equal(result.subjects[0]?.value, 'Electricity bill')
  assert.ok(result.matches[0]!.keywords.includes('electricity'))
  assert.ok(result.filenames.includes('20260817_LumenGrid-Electricity bill.pdf'))
  assert.ok(result.filenames.every(name => !name.startsWith('20250101')))
  assert.deepEqual(engine.suggest(['LumenGrid electricity meter']).filenames, [])
  assert.deepEqual(engine.suggest(['glacier expedition penguin rendezvous']).matches, [])
  assert.deepEqual(engine.suggest(['']).matches, [])
  assert.deepEqual(engine.suggest(['electricity'], [electricity.relativePath]).matches, [])
})
test('sender and subject combinations come from the same labeled examples; folder size cannot swamp best evidence', () => {
  const docs = [document('electricity meter tariff consumption')]
  for (let i = 0; i < 12; i++) docs.push(document('electricity water wastewater sewer consumption', `20250101_BrookWater-Water ${i}.pdf`, 'Home/Water'))
  const result = new ArchiveSimilarity(docs).suggest(['electricity meter tariff consumption'])
  assert.equal(result.folders[0]?.value, 'Home/Utilities')
  for (const name of result.names) assert.ok(docs.some(doc => doc.sender === name.sender && doc.subject === name.subject))
})
test('evaluation fits only training documents and measures date candidates independently of naming abstention', () => {
  const train = document('electricity meter consumption tariff')
  const holdout = document('polar glacier expedition. Date 2026-10-01', '20261001_AuroraClub-Expedition.pdf', 'Travel')
  const labels: EvaluationLabel[] = [
    { relativePath: train.relativePath, split: 'train', folder: train.folder, sender: 'LumenGrid', subject: 'Electricity bill', date: '20250101', category: 'recurring' },
    { relativePath: holdout.relativePath, split: 'holdout', folder: 'Travel', sender: 'AuroraClub', subject: 'Expedition', date: '20261001', category: 'no-precedent' }
  ]
  const report = evaluateArchive([train, holdout], labels)
  assert.equal(report.trainingDocuments, 1)
  assert.equal(report.holdout.abstentions, 1)
  assert.deepEqual(report.holdout.folder, { top1: 0, top3: 0, denominator: 1 })
  assert.deepEqual(report.holdout.date, { top1: 1, top3: 1, denominator: 1 })
})
test('synthetic archive exercises extraction, safe indexing, incremental refresh and held-out evaluation', async () => {
  const base = await mkdtemp(join(tmpdir(), 'archive-similarity-'))
  try {
    const dataset = await generateSyntheticArchive(join(base, 'dataset')), indexPath = join(base, 'index.json')
    await assert.rejects(generateSyntheticArchive(join(base, 'dataset')), /EEXIST/)
    const scanPath = join(dataset.input, '20261003_LumenGrid-Electricity bill.pdf')
    assert.deepEqual((await extractArchiveText(scanPath)).missingPages, [1])
    assert.deepEqual((await extractArchiveText(join(dataset.input, '20261004_BrookWater-Water bill.pdf'))).missingPages, [1])
    assert.deepEqual((await extractArchiveText(join(dataset.input, '20261005_QuietPaper-Empty form.pdf'))).missingPages, [1])
    await symlink(dataset.input, join(dataset.archive, 'linked-folder'))
    await symlink(scanPath, join(dataset.archive, 'linked.pdf'))
    await writeFile(join(dataset.archive, 'broken.pdf'), 'not a PDF')
    const before = await readFile(join(dataset.archive, 'Home/Utilities/Electricity/20250215_LumenGrid-Electricity bill.pdf'))
    const progress: ArchiveIndexProgress[] = []
    const index = await buildArchiveIndex(dataset.archive, indexPath, undefined, event => progress.push(event))
    assert.equal(progress[0]?.phase, 'scanning')
    const completed = progress.at(-1)!
    assert.equal(completed.phase, 'complete')
    assert.equal(completed.total, dataset.documents + 1)
    assert.equal(completed.processed, completed.total)
    assert.equal(completed.reused, 0)
    assert.equal(completed.errors, 1)
    assert.equal(progress.at(-2)?.phase, 'saving')
    assert.ok(progress.some(event => event.currentFile === 'broken.pdf'))
    const checks = progress.filter(event => event.phase === 'indexing')
    assert.ok(checks.every((event, i) => i === 0 || event.processed >= checks[i - 1]!.processed))
    assert.equal(index.documents.length, dataset.documents)
    assert.equal(index.errors.length, 1)
    assert.ok(index.documents.every(doc => !doc.relativePath.includes('linked')))
    assert.equal(index.documents.filter(doc => doc.missingPages.length).length, 1)
    assert.ok(index.documents.find(doc => doc.filename.startsWith('20250215_LumenGrid'))?.text.includes('Electricity'))
    assert.deepEqual(await readFile(join(dataset.archive, 'Home/Utilities/Electricity/20250215_LumenGrid-Electricity bill.pdf')), before)
    assert.equal((await loadArchiveIndex(dataset.archive, indexPath))?.documents.length, index.documents.length)
    const query = index.documents.find(doc => doc.filename === '20260817_LumenGrid-Electricity bill.pdf')!
    const fullCorpusSuggestion = new ArchiveSimilarity(index.documents).suggest(query.pages, [query.relativePath])
    assert.equal(fullCorpusSuggestion.folders[0]?.value, 'Home/Utilities/Electricity')
    assert.ok(fullCorpusSuggestion.matches.every(match => match.document.relativePath !== query.relativePath))
    const manifest = JSON.parse(await readFile(join(base, 'dataset/labels.json'), 'utf8'))
    const report = evaluateArchive(index.documents, manifest.documents, true)
    assert.equal(report.trainingDocuments, 26)
    assert.equal(report.holdout.total, 16)
    assert.equal(report.byCategory.recurring!.total, 12)
    assert.ok((report.byCategory.recurring!.folder as { top1: number }).top1 >= 10)
    assert.equal(report.byCategory['no-text']!.abstentions, 1)
    await unlink(join(dataset.archive, index.documents[0]!.relativePath))
    await unlink(join(dataset.archive, 'broken.pdf'))
    await writeFile(join(dataset.archive, 'new.pdf'), before)
    const refreshProgress: ArchiveIndexProgress[] = []
    const refreshed = await buildArchiveIndex(dataset.archive, indexPath, undefined, event => refreshProgress.push(event))
    assert.equal(refreshProgress.at(-1)?.reused, index.documents.length - 1)
    assert.equal(refreshProgress.at(-1)?.processed, index.documents.length)
    assert.equal(refreshed.documents.length, index.documents.length)
    assert.equal(refreshed.errors.length, 0)
    assert.ok(!refreshed.documents.some(doc => doc.relativePath === index.documents[0]!.relativePath))
    assert.ok(refreshed.documents.some(doc => doc.relativePath === 'new.pdf' && !doc.sender))
    const newPath = join(dataset.archive, 'new.pdf')
    const originalHash = refreshed.documents.find(doc => doc.relativePath === 'new.pdf')!.hash
    await writeFile(newPath, await readFile(scanPath))
    const changed = await buildArchiveIndex(dataset.archive, indexPath)
    const updated = changed.documents.find(doc => doc.relativePath === 'new.pdf')!
    assert.notEqual(updated.hash, originalHash)
    assert.deepEqual(updated.missingPages, [1])
    await writeFile(indexPath, '{invalid JSON')
    await assert.rejects(loadArchiveIndex(dataset.archive, indexPath), SyntaxError)
    assert.equal((await buildArchiveIndex(dataset.archive, indexPath)).documents.length, changed.documents.length)
    await assert.rejects(buildArchiveIndex(dataset.archive, scanPath), /must not be a PDF/)
    const linkedIndex = join(base, 'linked-index.json')
    await symlink(indexPath, linkedIndex)
    await assert.rejects(buildArchiveIndex(dataset.archive, linkedIndex), /regular file/)

  } finally { await rm(base, { recursive: true, force: true }) }
})
