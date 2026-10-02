export interface DateEvidence {
  text: string
  page: number
  context: string
  ambiguous: boolean
  start: number
  end: number
}

export interface DateSuggestion {
  prefix: string
  evidence: DateEvidence[]
}

const months: Record<string, number> = {
  jan: 1, january: 1, januar: 1, feb: 2, february: 2, februar: 2,
  mar: 3, march: 3, mär: 3, märz: 3, maerz: 3, mrz: 3,
  apr: 4, april: 4, may: 5, mai: 5, jun: 6, june: 6, juni: 6,
  jul: 7, july: 7, juli: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, okt: 10, oktober: 10,
  nov: 11, november: 11, dec: 12, december: 12, dez: 12, dezember: 12
}
const monthPattern = Object.keys(months).sort((a, b) => b.length - a.length).join('|')
const yearPattern = '(?:\\d{4}|\\d{2})'
const yearOf = (value: string) => value.length === 2 ? Number(value) + (Number(value) < 70 ? 2000 : 1900) : Number(value)

function prefixOf(year: number, month: number, day: number): string | undefined {
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return
  return `${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}_`
}

/** Complete calendar dates only; keep both interpretations of ambiguous slash/dash dates. */
export function findDocumentDates(pages: string[]): DateSuggestion[] {
  const suggestions = new Map<string, DateSuggestion>()
  pages.forEach((raw, index) => {
    // Keep source offsets even when OCR characters expand during normalization.
    let text = ''
    const offsets: { start: number; end: number }[] = []
    for (const part of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(raw)) {
      const normalized = part.segment.normalize('NFKC').replace(/[\u2010-\u2015]/g, '-')
      text += normalized
      for (let position = 0; position < normalized.length; position++) offsets.push({ start: part.index, end: part.index + part.segment.length })
    }
    const hits: { index: number; evidence: DateEvidence; prefixes: string[] }[] = []
    function collect(pattern: RegExp, parse: (match: RegExpMatchArray) => (string | undefined)[], isoTimestamp = false) {
      for (const match of text.matchAll(pattern)) {
        const start = match.index!
        const end = start + match[0].length
        // Do not interpret substrings of identifiers or longer date-like numbers.
        if (/[\p{L}\p{N}]/u.test(text[start - 1] ?? '') ||
            (/[\p{L}\p{N}]/u.test(text[end] ?? '') && !(isoTimestamp && /^T\d{2}:\d{2}/.test(text.slice(end))))) continue
        if (/\d\s*[./-]\s*$/.test(text.slice(Math.max(0, start - 5), start))) continue
        const prefixes = [...new Set(parse(match).filter((value): value is string => !!value))]
        if (!prefixes.length) continue
        hits.push({ index: start, prefixes, evidence: { text: raw.slice(offsets[start]!.start, offsets[end - 1]!.end), page: index + 1,
          start: offsets[start]!.start, end: offsets[end - 1]!.end,
          context: text.slice(Math.max(0, start - 35), Math.min(text.length, end + 35)).replace(/\s+/g, ' ').trim(),
          ambiguous: prefixes.length > 1 } })
      }
    }
    collect(/\d{4}\s*([./-])\s*\d{1,2}\s*\1\s*\d{1,2}/g, match => {
      const [year, month, day] = match[0].split(/[./-]/).map(Number)
      return [prefixOf(year!, month!, day!)]
    }, true)
    collect(/(?:19|20|21)\d{6}/g, match => [prefixOf(Number(match[0].slice(0, 4)), Number(match[0].slice(4, 6)), Number(match[0].slice(6)))])
    collect(/(\d{1,2})\s*([./-])\s*(\d{1,2})\s*\2\s*(\d{4}|\d{2})/g, match => {
      const day = Number(match[1]), month = Number(match[3]), year = yearOf(match[4]!)
      return match[2] === '.' ? [prefixOf(year, month, day)] : [prefixOf(year, month, day), prefixOf(year, day, month)]
    })
    collect(new RegExp(`(\\d{1,2})(?:\\.|st|nd|rd|th)?[\\s./-]*(?:of\\s+)?(${monthPattern})\\.?[\\s,./-]*(${yearPattern})`, 'gi'), match =>
      [prefixOf(yearOf(match[3]!), months[match[2]!.toLocaleLowerCase()]!, Number(match[1]))])
    collect(new RegExp(`(${monthPattern})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th|\\.)?[\\s,]+(${yearPattern})`, 'gi'), match =>
      [prefixOf(yearOf(match[3]!), months[match[1]!.toLocaleLowerCase()]!, Number(match[2]))])
    hits.sort((a, b) => a.index - b.index)
    for (const hit of hits) for (const prefix of hit.prefixes) {
      const suggestion = suggestions.get(prefix) ?? { prefix, evidence: [] }
      if (!suggestion.evidence.some(item => item.page === hit.evidence.page && item.start === hit.evidence.start && item.end === hit.evidence.end)) {
        suggestion.evidence.push(hit.evidence)
      }
      suggestions.set(prefix, suggestion)
    }
  })
  return [...suggestions.values()]
}
