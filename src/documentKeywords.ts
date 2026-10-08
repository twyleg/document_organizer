import { similarityTerms } from '../shared/archiveSimilarity'

const boilerplate = new Set(
  'fictional sample dataset parties details enclosed attached attachment copy original page pages document documents code payment payments zahlung zahlungen beispiel seite seiten anlage anlagen'.split(
    ' '
  )
)

/** Short content hints from OCR text; no filename or destination labels are inserted. */
export function documentKeywords(pages: string[], limit = 5): string[] {
  const terms = new Map<
    string,
    { label: string; count: number; firstPage: boolean; order: number }
  >()
  pages.forEach((page, pageIndex) => {
    for (const token of page.match(/[\p{L}\p{N}]+/gu) ?? []) {
      const term = similarityTerms(token)[0]
      if (!term || boilerplate.has(term)) {
        continue
      }

      const old = terms.get(term)
      if (old) {
        old.count++
        old.firstPage ||= pageIndex === 0
      } else {
        terms.set(term, { label: token, count: 1, firstPage: pageIndex === 0, order: terms.size })
      }
    }
  })
  const score = (term: { count: number; firstPage: boolean }) =>
    (1 + Math.log(term.count)) * (term.firstPage ? 1.3 : 1)

  return [...terms.values()]
    .sort((a, b) => score(b) - score(a) || a.order - b.order)
    .slice(0, Math.max(0, limit))
    .map((term) => term.label)
}
