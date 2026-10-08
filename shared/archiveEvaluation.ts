import { ArchiveSimilarity, type ArchiveDocument } from './archiveSimilarity'
export interface EvaluationLabel {
  relativePath: string; split: 'train' | 'holdout'; folder: string; sender: string; subject: string; date: string; category: string
}
export function evaluateArchive(documents: ArchiveDocument[], labels: EvaluationLabel[], syntheticOnly = false) {
  const byPath = new Map(documents.map(document => [document.relativePath, document]))
  const training = labels.filter(label => label.split === 'train').map(label => byPath.get(label.relativePath)).filter((document): document is ArchiveDocument => !!document)
  const similarity = new ArchiveSimilarity(training)
  const details = labels.filter(label => label.split === 'holdout').map(label => {
    const document = byPath.get(label.relativePath)
    if (!document) return { relativePath: label.relativePath, category: label.category, error: 'Not indexed' } as const
    const suggestion = similarity.suggest(document.pages)
    const rank = (values: string[], expected: string) => { const index = values.indexOf(expected); return index < 0 ? null : index + 1 }
    return { relativePath: label.relativePath, category: label.category, abstained: !suggestion.matches.length,
      folderRank: rank(suggestion.folders.map(item => item.value), label.folder),
      senderRank: rank(suggestion.senders.map(item => item.value), label.sender),
      subjectRank: rank(suggestion.subjects.map(item => item.value), label.subject),
      dateRank: rank(suggestion.dates.map(item => item.prefix.replace(/_$/, '')), label.date),
      matches: suggestion.matches.slice(0, 3).map(item => ({ path: item.document.relativePath, score: item.score, keywords: item.keywords })) }
  })
  function metrics(rows: typeof details) {
    const indexed = rows.filter(row => !('error' in row)), total = rows.length
    const score = (key: 'folderRank' | 'senderRank' | 'subjectRank' | 'dateRank') => {
      const ranks = indexed.map(row => row[key])
      return { top1: ranks.filter(rank => rank === 1).length,
        top3: ranks.filter(rank => rank !== null && rank !== undefined && rank <= 3).length, denominator: total }
    }
    return { total, indexed: indexed.length, abstentions: indexed.filter(row => row.abstained).length,
      folder: score('folderRank'), sender: score('senderRank'), subject: score('subjectRank'), date: score('dateRank') }
  }
  return { syntheticOnly, trainingDocuments: training.length, holdout: metrics(details),
    byCategory: Object.fromEntries([...new Set(details.map(row => row.category))].map(category => [category, metrics(details.filter(row => row.category === category))])),
    details, warning: 'Synthetic accuracy does not establish real archive accuracy. Similarity scores are not probabilities. Dates are evaluated independently, including when naming abstains.' }
}
