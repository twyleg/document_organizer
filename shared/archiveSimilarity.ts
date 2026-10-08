import { findDocumentDates } from '../src/documentDates'

export interface ArchiveDocument {
  relativePath: string; folder: string; filename: string; text: string; pages: string[]
  missingPages: number[]; hash: string; date?: string; sender?: string; subject?: string
}
export interface ArchiveIndex {
  schema: 1; archive: string; builtAt: string; documents: ArchiveDocument[]
  errors: { relativePath: string; error: string }[]
}
export interface SimilarDocument { document: ArchiveDocument; score: number; keywords: string[] }
export interface LabelSuggestion { value: string; score: number; examples: SimilarDocument[] }
export interface ArchiveSuggestion {
  matches: SimilarDocument[]; folders: LabelSuggestion[]; senders: LabelSuggestion[]; subjects: LabelSuggestion[]
  names: { sender: string; subject: string; score: number; examples: SimilarDocument[] }[]
  dates: ReturnType<typeof findDocumentDates>; filenames: string[]
}

export function parseArchiveFilename(filename: string) {
  // First hyphen separates sender and subject; further hyphens belong to the subject.
  const match = /^(\d{8})_([^\-]+)-(.+)\.pdf$/i.exec(filename)
  if (!match) return {}
  const date = match[1]!, sender = match[2]!.trim(), subject = match[3]!.trim()
  const parsed = new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T00:00:00Z`)
  if (!sender || !subject || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10).replace(/-/g, '') !== date) return {}
  return { date, sender, subject }
}
const stop = new Set(`a an the and or of to in on at by for from with is are was were be been this that these those your our you we it as not please dear regards sincerely der die das den dem des ein eine einer einen und oder von zu im am an auf fur mit ist sind war werden ihr ihre wir sie sehr geehrte geehrter freundlichen grussen januar january februar february mar march marz april mai may juni june juli july august september oktober october november dezember december jan feb apr jun jul aug sep oct okt nov dec dez all also any can could would should have has had do does did will may must more most other some such than then there their them through about into out over under up down if so only each every when where which who what how its itself ourselves yourselves himself herself themselves before after between during again further once here both few own same too very just now please dear regards sincerely including includes enclosed following next previous reference ref number customer document documents date period amount total payable service services thank thanks datum dokument dokumente referenz nummer kunde kunden betrag gesamt zahlbar zeitraum vielen dank`.split(' '))
export function similarityTerms(text: string) {
  return (text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/ß/g, 'ss')
    .match(/[\p{L}\p{N}]+/gu) ?? [])
    // Drop entire alphanumeric identifiers, not just their digits, and date/month words.
    .filter(term => term.length >= 3 && !/\p{N}/u.test(term) && !stop.has(term))
}
function counts(text: string) {
  const result = new Map<string, number>()
  for (const term of similarityTerms(text)) result.set(term, (result.get(term) ?? 0) + 1)
  return result
}

/** Sublinear TF, smoothed IDF, L2 normalization; fit on archive texts only. */
export class ArchiveSimilarity {
  private idf = new Map<string, number>()
  private vectors: Map<string, number>[]
  constructor(private documents: ArchiveDocument[]) {
    const frequency = new Map<string, number>()
    for (const document of documents) for (const term of new Set(similarityTerms(document.text))) frequency.set(term, (frequency.get(term) ?? 0) + 1)
    for (const [term, n] of frequency) this.idf.set(term, 1 + Math.log((1 + documents.length) / (1 + n)))
    this.vectors = documents.map(document => this.vector(document.text))
  }
  private vector(text: string) {
    const vector = new Map<string, number>()
    let length = 0
    for (const [term, count] of counts(text)) {
      // Unknown query terms contribute to its norm, reducing weak out-of-domain matches.
      const weight = (1 + Math.log(count)) * (this.idf.get(term) ?? (1 + Math.log(1 + this.documents.length)))
      vector.set(term, weight); length += weight * weight
    }
    if (length) for (const [term, weight] of vector) vector.set(term, weight / Math.sqrt(length))
    return vector
  }
  suggest(pages: string[], excludedPaths: string[] = []): ArchiveSuggestion {
    const query = this.vector(pages.join('\n')), excluded = new Set(excludedPaths)
    const matches = this.documents.flatMap((document, index) => {
      if (excluded.has(document.relativePath)) return []
      const contributions = [...this.vectors[index]!].flatMap(([term, weight]) => query.has(term) ? [{ term, weight: weight * query.get(term)! }] : [])
        .sort((a, b) => b.weight - a.weight || a.term.localeCompare(b.term))
      const score = contributions.reduce((sum, item) => sum + item.weight, 0)
      // Conservative evidence gate, a heuristic rather than a calibrated confidence.
      if (score < .15 || contributions.length < 2) return []
      return [{ document, score, keywords: contributions.slice(0, 6).map(item => item.term) }]
    }).sort((a, b) => b.score - a.score || a.document.relativePath.localeCompare(b.document.relativePath)).slice(0, 10)
    function labels(key: 'folder' | 'sender' | 'subject') {
      const groups = new Map<string, SimilarDocument[]>()
      for (const match of matches) {
        const value = match.document[key]
        if (value === undefined) continue
        const examples = groups.get(value) ?? []; examples.push(match); groups.set(value, examples)
      }
      // Best example determines rank so large folders cannot win by sheer volume.
      return [...groups].map(([value, examples]) => ({ value, score: examples[0]!.score, examples }))
        .sort((a, b) => b.score - a.score || a.value.localeCompare(b.value)).slice(0, 5)
    }
    const pairs = new Map<string, ArchiveSuggestion['names'][number]>()
    for (const match of matches) {
      const { sender, subject } = match.document
      if (!sender || !subject) continue
      const key = JSON.stringify([sender, subject]), existing = pairs.get(key)
      if (existing) existing.examples.push(match)
      else pairs.set(key, { sender, subject, score: match.score, examples: [match] })
    }
    const names = [...pairs.values()].slice(0, 5), dates = findDocumentDates(pages)
    // Only dates extracted from the query can appear in a proposed filename.
    const filenames = dates.slice(0, 5).flatMap(date => names.slice(0, 3).map(name => `${date.prefix}${name.sender}-${name.subject}.pdf`))
    return { matches, folders: labels('folder'), senders: labels('sender'), subjects: labels('subject'), names, dates, filenames }
  }
}
