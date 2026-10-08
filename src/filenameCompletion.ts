export interface FilenameWord {
  label: string
  value: string
  count: number
  order: number
}

const stopWords = new Set(
  'der die das den dem des ein eine einer einem einen und oder für von vom zum zur mit auf im in am an ist sind es sie ihr ihre wir ich bei als zu the a an and or for of to from with on at is are your our'.split(
    ' '
  )
)

export function buildFilenameWords(pages: string[]): FilenameWord[] {
  const words = new Map<string, FilenameWord>()

  function add(label: string) {
    const value = label.replace(/\s+/g, '-')
    if (value.length > 80 || !/\p{L}/u.test(value)) {
      return
    }

    const key = value.toLocaleLowerCase()
    const existing = words.get(key)
    if (existing) {
      existing.count++
    } else {
      words.set(key, { label, value, count: 1, order: words.size })
    }
  }

  for (const page of pages) {
    for (const line of page.normalize('NFKC').split(/[\r\n]+/)) {
      const matches = [...line.matchAll(/[\p{L}][\p{L}\p{M}\d]*(?:[-'][\p{L}\p{M}\d]+)*/gu)]
      const tokens = matches.map((match) => match[0])

      for (let index = 0; index < tokens.length; index++) {
        const word = tokens[index]!
        if (word.length < 2 || stopWords.has(word.toLocaleLowerCase())) {
          continue
        }

        add(word)
        if (word.includes('-')) {
          for (const part of word.split('-')) {
            if (part.length > 1 && !stopWords.has(part.toLocaleLowerCase())) {
              add(part)
            }
          }
        }

        for (let length = 2; length <= 4 && index + length <= tokens.length; length++) {
          const previous = matches[index + length - 2]!
          const next = matches[index + length - 1]!
          if (!/^[\s-]+$/.test(line.slice(previous.index! + previous[0].length, next.index))) {
            break
          }

          add(tokens.slice(index, index + length).join(' '))
        }
      }
    }
  }

  return [...words.values()]
}

export function filenameCompletions(
  name: string,
  start: number,
  end: number,
  words: FilenameWord[]
) {
  const dot = name.lastIndexOf('.')
  const stemEnd = dot > 0 ? dot : name.length
  if (start > stemEnd || end > stemEnd) {
    return []
  }

  let tokenStart = start

  while (tokenStart > 0 && !/[\s_-]/.test(name[tokenStart - 1]!)) {
    tokenStart--
  }

  const query = name.slice(tokenStart, start).toLocaleLowerCase()
  if (!query || !/\p{L}/u.test(query)) {
    return []
  }

  let tokenEnd = Math.max(start, end)

  while (tokenEnd < stemEnd && !/[\s_-]/.test(name[tokenEnd]!)) {
    tokenEnd++
  }

  return words
    .filter(
      (word) =>
        word.value.toLocaleLowerCase().startsWith(query) && word.value.toLocaleLowerCase() !== query
    )
    .sort(
      (a, b) =>
        Number(a.value.includes('-')) - Number(b.value.includes('-')) ||
        b.count - a.count ||
        a.order - b.order
    )
    .slice(0, 8)
    .map((word) => ({
      ...word,
      start: tokenStart,
      end: tokenEnd,
      filename: name.slice(0, tokenStart) + word.value + name.slice(tokenEnd)
    }))
}
