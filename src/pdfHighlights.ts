export interface PdfTextHighlight {
  id: string
  start: number
  end: number
  color: string
  label: string
  selected?: boolean
  hovered?: boolean
}
