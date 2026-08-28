import type { ImportRow } from '#/lib/hooks/useContacts'

/**
 * A CSV parser that handles the files people actually upload.
 *
 * Quoted fields containing commas, escaped quotes (""), CRLF line endings and
 * Excel's UTF-8 BOM all appear in real exports, and a naive `split(',')`
 * mangles every one of them — a company called "Bello Oil, Ltd" would arrive
 * as two columns and shift every field after it.
 *
 * Deliberately parsed in the browser rather than posted as a file: encodings,
 * delimiters and Excel's several dialects stay a client problem, and a
 * malformed file fails in front of the person who chose it — where they can
 * see which line is wrong — instead of as a 400 from the server.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  // Excel writes a BOM on UTF-8 CSVs; left in place it becomes part of the
  // first header name and that column never matches.
  const src = text.replace(/^\uFEFF/, '')

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]

    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++ }  // "" is a literal quote
        else quoted = false
      } else {
        field += ch
      }
      continue
    }

    if (ch === '"') { quoted = true; continue }
    if (ch === ',') { row.push(field); field = ''; continue }
    if (ch === '\r') continue
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue }
    field += ch
  }

  // Whatever was still being read when the file ended.
  if (field !== '' || row.length) { row.push(field); rows.push(row) }

  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

/**
 * Which spreadsheet column means what.
 *
 * Nobody names their columns the way an importer wants, so several spellings
 * map to each field. Matching is done on letters only, so "Phone Number",
 * "phone_number" and "PhoneNo." are all the same header.
 */
const ALIASES: Record<keyof ImportRow, string[]> = {
  name: ['name', 'fullname', 'contactname', 'customername', 'contact', 'client'],
  phone: ['phone', 'phonenumber', 'phoneno', 'mobile', 'mobilenumber', 'number', 'tel', 'telephone', 'msisdn'],
  email: ['email', 'emailaddress', 'mail'],
  companyName: ['company', 'companyname', 'business', 'businessname', 'organisation', 'organization', 'org'],
  stage: ['stage', 'type', 'category'],
  tags: ['tags', 'tag', 'labels', 'segment'],
  notes: ['notes', 'note', 'comment', 'comments', 'remark', 'remarks'],
}

const key = (h: string) => h.toLowerCase().replace(/[^a-z]/g, '')

export interface ParsedImport {
  rows: ImportRow[]
  headers: string[]
  /** Columns in the file that matched nothing — surfaced so a mis-shaped file is visible. */
  unmapped: string[]
  /** Lines dropped for having no name or no number. */
  skipped: number
}

/**
 * Turn a parsed CSV into import rows.
 *
 * A file with no recognisable header row is treated as headerless and read
 * positionally as name, phone, email, company — which is what a list pasted
 * out of a phone book looks like, and refusing it outright would be unhelpful
 * when the intent is obvious.
 */
export function toImportRows(table: string[][]): ParsedImport {
  if (!table.length) return { rows: [], headers: [], unmapped: [], skipped: 0 }

  const header = table[0].map((h) => h.trim())
  const mapped = new Map<number, keyof ImportRow>()
  const unmapped: string[] = []

  header.forEach((h, i) => {
    const k = key(h)
    const field = (Object.keys(ALIASES) as Array<keyof ImportRow>).find((f) =>
      ALIASES[f].includes(k),
    )
    if (field && ![...mapped.values()].includes(field)) mapped.set(i, field)
    else if (h) unmapped.push(h)
  })

  // No header recognised at all: read positionally rather than throwing the
  // file away, and keep the first line as data since it was never a header.
  const headerless = !mapped.size
  if (headerless) {
    ;['name', 'phone', 'email', 'companyName'].forEach((f, i) => mapped.set(i, f as keyof ImportRow))
  }

  const body = headerless ? table : table.slice(1)
  const rows: ImportRow[] = []
  let skipped = 0

  for (const line of body) {
    const row: ImportRow = {}
    mapped.forEach((field, i) => {
      const value = (line[i] ?? '').trim()
      if (!value) return
      if (field === 'tags') {
        // "vip; warri" and "vip, warri" both mean two tags.
        row.tags = value.split(/[;|]/).flatMap((t) => t.split(',')).map((t) => t.trim()).filter(Boolean)
      } else if (field === 'stage') {
        row.stage = /contact/i.test(value) ? 'contact' : 'lead'
      } else {
        ;(row as Record<string, unknown>)[field] = value
      }
    })

    // The server skips these too, but counting them here lets the dialog say
    // what will happen before anything is sent.
    const digits = (row.phone || '').replace(/[^0-9]/g, '')
    if (!row.name || digits.length < 7) { skipped++; continue }
    rows.push(row)
  }

  return { rows, headers: header, unmapped: headerless ? [] : unmapped, skipped }
}
