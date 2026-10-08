import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { generateSyntheticArchive, type SyntheticLabel } from './syntheticArchive'

async function main() {
  const { values } = parseArgs({
    options: { output: { type: 'string' }, help: { type: 'boolean' } }
  })
  if (values.help) {
    console.log(
      'Usage: npm run test:environment -- [--output /path/to/new-directory]\nDefaults to .synthetic-archive/manual-testing. Refuses to overwrite an existing directory. No OCR or application settings are changed.'
    )
    return
  }

  const output = resolve(values.output ?? '.synthetic-archive/manual-testing')
  await mkdir(dirname(output), { recursive: true })
  // The generator reserves the output directory exclusively before writing any files.
  const dataset = await generateSyntheticArchive(output)
  const manifest = JSON.parse(await readFile(join(output, 'labels.json'), 'utf8')) as {
    documents: SyntheticLabel[]
  }
  const cases: Array<{
    input: string
    folder: string
    sender: string
    subject: string
    date: string
    format: string
    category: string
  }> = []

  for (const label of manifest.documents.filter((document) => document.split === 'holdout')) {
    const input = `scan-${String(cases.length + 1).padStart(3, '0')}.pdf`
    await rename(join(dataset.archive, label.relativePath), join(dataset.input, input))
    cases.push({
      input,
      folder: label.folder,
      sender: label.sender,
      subject: label.subject,
      date: label.date,
      format: label.format,
      category: label.category
    })
  }

  for (const sample of [
    {
      filename: '20261003_LumenGrid-Electricity bill.pdf',
      folder: 'Home/Utilities/Electricity',
      sender: 'LumenGrid',
      subject: 'Electricity bill',
      date: '20261003',
      format: 'scan',
      category: 'recurring'
    },
    {
      filename: '20261004_BrookWater-Water bill.pdf',
      folder: 'Home/Utilities/Water',
      sender: 'BrookWater',
      subject: 'Water bill',
      date: '20261004',
      format: 'mixed',
      category: 'recurring'
    },
    {
      filename: '20261005_QuietPaper-Empty form.pdf',
      folder: 'Miscellaneous/Unsorted',
      sender: 'QuietPaper',
      subject: 'Empty form',
      date: '20261005',
      format: 'blank',
      category: 'no-text'
    }
  ]) {
    const input = `scan-${String(cases.length + 1).padStart(3, '0')}.pdf`
    await rename(join(dataset.input, sample.filename), join(dataset.input, input))
    const { filename: _filename, ...expected } = sample
    cases.push({ input, ...expected })
  }

  await unlink(join(output, 'labels.json'))
  await writeFile(
    join(output, 'test-cases.json'),
    JSON.stringify(
      {
        synthetic: true,
        description:
          'Expected manual labels, not guaranteed recommendations. Input documents are excluded from the initial archive. Blank documents have no detectable date or naming evidence.',
        archiveDocuments: manifest.documents.filter((document) => document.split === 'train')
          .length,
        cases
      },
      null,
      2
    ) + '\n'
  )
  const rows = cases
    .map(
      (item) =>
        `| ${item.input} | ${item.format} | ${item.category} | ${item.folder} | ${item.date}_${item.sender}-${item.subject}.pdf |`
    )
    .join('\n')
  await writeFile(
    join(output, 'TESTING.md'),
    `# Fictional manual testing environment

1. Start Document Organizer with npm run uat from the project directory.
2. npm run uat opens the default generated input and archive automatically. For a custom output, run npm run uat -- --input "${dataset.input}" --archive "${dataset.archive}".
3. Verify the selected paths: input ${dataset.input}; archive ${dataset.archive}
4. Click Refresh text index in the application. The initial archive contains 26 searchable examples; input cases are excluded.
5. Open scan-001.pdf, inspect its text-based folder evidence and assisted rename suggestions. Check that matching filenames, folders and keywords are shown. Choose the new document's date, then manually confirm Rename and the destination move. The expected labels below are a review aid, not a guarantee of the baseline's output.
6. Try other recurring cases, preview archive PDFs, and exercise keyboard navigation, drag-and-drop, and PDF editing on these disposable documents. Refresh the text index after changing the archive.
7. scan-013.pdf is ambiguous insurance correspondence; inspect competing destinations. scan-014.pdf has no suitable precedent. scan-015.pdf is a new property policy from a known insurer and may misleadingly match existing insurance categories. Review these manually.
8. scan-017.pdf is image-only and scan-018.pdf mixes a scanned page with a digital page. Run OCR in the app before testing recommendations. This requires the usual external OCR setup. scan-016.pdf and scan-019.pdf are blank: expect no text-based recommendation or detected date.

No OCR is run by this script. All names and content are fictional. Searchable scans use generated invisible text layers. Similarity scores are not probabilities; success here does not establish accuracy on personal documents. Moving or renaming inputs changes this environment. Generate a fresh environment with a different --output path to restart; existing directories are never overwritten. This setup does not change application settings or use personal documents.

| Input | PDF format | Case | Expected destination | Expected filename (when evidence is available) |
| --- | --- | --- | --- | --- |
${rows}
`
  )
  console.log(
    `Created fictional testing environment:\nArchive: ${dataset.archive}\nInput: ${dataset.input}\nGuide: ${join(output, 'TESTING.md')}\n26 archived examples and ${cases.length} input PDFs. No OCR was run.`
  )
}

main().catch((cause) => {
  console.error(cause instanceof Error ? cause.message : String(cause))
  process.exitCode = 1
})
