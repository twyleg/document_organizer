import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { createCanvas } from '@napi-rs/canvas'

export interface SyntheticLabel {
  relativePath: string
  split: 'train' | 'holdout'
  folder: string
  sender: string
  subject: string
  date: string
  category: 'recurring' | 'ambiguous' | 'no-precedent' | 'no-text'
  format: string
}

const patterns = [
  {
    folder: 'Home/Utilities/Electricity',
    sender: 'LumenGrid',
    subject: 'Electricity bill',
    body: 'LumenGrid energy services. Electricity consumption meter kilowatt tariff supply household energy statement.',
    detail: 'Your meter reading includes the winter electricity usage adjustment.'
  },
  {
    folder: 'Home/Utilities/Water',
    sender: 'BrookWater',
    subject: 'Water bill',
    body: 'BrookWater municipal services. Drinking water consumption wastewater sewer meter cubic supply statement.',
    detail: 'Wastewater charges and the drinking water meter reading are enclosed.'
  },
  {
    folder: 'Health/Insurance',
    sender: 'CedarMutual',
    subject: 'Health policy',
    body: 'CedarMutual insurance. Health policy medical coverage outpatient hospital premium reimbursement benefits.',
    detail: 'Your annual medical premium includes outpatient reimbursement coverage.'
  },
  {
    folder: 'Transport/Insurance',
    sender: 'CedarMutual',
    subject: 'Vehicle policy',
    body: 'CedarMutual insurance. Vehicle motor collision liability roadside premium coverage automobile policy.',
    detail: 'The renewed automobile coverage includes collision and roadside assistance.'
  },
  {
    folder: 'Finance/Bank',
    sender: 'HarborBank',
    subject: 'Account statement',
    body: 'HarborBank personal banking. Current account balance debit credit transfer transactions deposit statement.',
    detail: 'This account summary lists debit transactions and the closing deposit balance.'
  },
  {
    folder: 'Home/Internet',
    sender: 'OrbitNet',
    subject: 'Internet bill',
    body: 'OrbitNet communications. Broadband internet router fibre connection monthly subscription download invoice.',
    detail: 'The fibre broadband subscription includes router rental and internet service.'
  }
]

async function makePdf(
  lines: string[],
  format: 'text' | 'scan' | 'searchable-scan' | 'mixed' | 'blank'
) {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const page = pdf.addPage([595, 842])
  if (format !== 'blank') {
    if (format === 'scan' || format === 'searchable-scan' || format === 'mixed') {
      const canvas = createCanvas(1190, 1684)
      const context = canvas.getContext('2d')
      context.fillStyle = '#faf9f5'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.fillStyle = '#222'
      context.font = '26px sans-serif'
      lines.forEach((line, index) => context.fillText(line, 65, 100 + index * 45))
      const image = await pdf.embedPng(canvas.toBuffer('image/png'))
      page.drawImage(image, { x: 0, y: 0, width: 595, height: 842 })
      if (format === 'searchable-scan') {
        lines.forEach((line, index) =>
          page.drawText(line, { font, size: 13, x: 32.5, y: 792 - index * 22.5, opacity: 0 })
        )
      }
    } else {
      lines.forEach((line, index) =>
        page.drawText(line, {
          font,
          size: 12,
          x: 32,
          y: 790 - index * 22,
          color: rgb(0.1, 0.1, 0.1)
        })
      )
    }
    if (format === 'mixed') {
      pdf.addPage([595, 842]).drawText('Digitally added cover: delivery confirmation.', {
        font,
        x: 32,
        y: 790,
        size: 12
      })
    }
  }

  return pdf.save()
}

/** Creates an exclusively reserved directory; never overwrites an existing dataset. */
export async function generateSyntheticArchive(output: string) {
  await mkdir(output)
  const archive = join(output, 'archive')
  const input = join(output, 'input')
  const labels: SyntheticLabel[] = []
  await mkdir(archive)
  await mkdir(input)

  async function add(
    folder: string,
    sender: string,
    subject: string,
    date: string,
    text: string,
    split: SyntheticLabel['split'],
    category: SyntheticLabel['category'],
    format: Parameters<typeof makePdf>[1] = 'text'
  ) {
    const relativePath = `${folder}/${date}_${sender}-${subject}.pdf`
    const lines = [
      `${sender} - fictional sample document`,
      `Document date: ${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}`,
      `Reference INV${date}X payment code ${date.slice(2)}99`,
      ...text.match(/.{1,78}(?:\s|$)/g)!.map((line) => line.trim()),
      'All parties and account details in this dataset are fictional.'
    ]
    await mkdir(dirname(join(archive, relativePath)), { recursive: true })
    await writeFile(join(archive, relativePath), await makePdf(lines, format))
    labels.push({ relativePath, folder, sender, subject, date, split, category, format })
  }

  for (const pattern of patterns) {
    for (let i = 1; i <= 4; i++) {
      await add(
        pattern.folder,
        pattern.sender,
        pattern.subject,
        `20250${i}15`,
        pattern.body +
          ` Payment due on 2025-0${i}-28. Amount ${i * 37}. Thank you for your payment.`,
        'train',
        'recurring',
        i % 2 ? 'text' : 'searchable-scan'
      )
    }

    // Different wording, dates, numbers and OCR-like errors; no exact training duplicates.
    await add(
      pattern.folder,
      pattern.sender,
      pattern.subject,
      '20260817',
      pattern.detail +
        ' Statement for the next service period. Customer ref ZZ88271. Total payable 149.75.',
      'holdout',
      'recurring',
      'searchable-scan'
    )
    await add(
      pattern.folder,
      pattern.sender,
      pattern.subject,
      '20260918',
      pattern.body.replace('services', 'servlces') +
        ' Updated terms and revised charges apply. Invoice ZX99302.',
      'holdout',
      'recurring'
    )
  }

  // Identical texts with conflicting filing labels expose an irreducible ambiguity.
  const ambiguous =
    'CedarMutual insurance premium coverage policy renewal. Please retain this statement for your records. Renewal date 03/04/2026.'
  await add(
    'Health/Insurance',
    'CedarMutual',
    'Health policy',
    '20250403',
    ambiguous.replace('2026', '2025'),
    'train',
    'ambiguous'
  )
  await add(
    'Transport/Insurance',
    'CedarMutual',
    'Vehicle policy',
    '20250403',
    ambiguous.replace('2026', '2025'),
    'train',
    'ambiguous'
  )
  await add(
    'Transport/Insurance',
    'CedarMutual',
    'Vehicle policy',
    '20260403',
    ambiguous,
    'holdout',
    'ambiguous'
  )
  await add(
    'Travel/Expeditions',
    'AuroraClub',
    'Polar expedition',
    '20261001',
    'AuroraClub polar expedition itinerary. Glacier kayaking tundra wildlife penguin expedition rendezvous.',
    'holdout',
    'no-precedent'
  )
  // Hard unknown: same sender and familiar generic terms, new destination/subject.
  await add(
    'Home/Insurance',
    'CedarMutual',
    'Property policy',
    '20260920',
    'CedarMutual insurance premium policy coverage. Property building storm roof household damage renewal.',
    'holdout',
    'no-precedent'
  )
  await add(
    'Miscellaneous/Unsorted',
    'QuietPaper',
    'Empty form',
    '20261002',
    'Empty sample',
    'holdout',
    'no-text',
    'blank'
  )
  await writeFile(
    join(input, '20261003_LumenGrid-Electricity bill.pdf'),
    await makePdf(
      [
        'LumenGrid electricity consumption meter tariff',
        'Document date 2026-10-03. Invoice INV887103'
      ],
      'scan'
    )
  )
  await writeFile(
    join(input, '20261004_BrookWater-Water bill.pdf'),
    await makePdf(
      ['BrookWater drinking water wastewater meter', 'Document date 2026-10-04. Invoice INV778501'],
      'mixed'
    )
  )
  await writeFile(join(input, '20261005_QuietPaper-Empty form.pdf'), await makePdf([], 'blank'))
  await writeFile(join(archive, 'notes.txt'), 'Fictional dataset. Do not index non-PDF files.\n')
  await writeFile(
    join(output, 'labels.json'),
    JSON.stringify(
      {
        schema: 1,
        synthetic: true,
        description:
          'Synthetic labels only; searchable scans use generated text layers, not measured OCR output.',
        documents: labels
      },
      null,
      2
    ) + '\n'
  )
  return { archive, input, documents: labels.length }
}
