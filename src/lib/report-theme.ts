/**
 * One look for every Excel and PDF the system produces.
 *
 * Before this, each export invented its own colours, borders and number
 * formats, so two reports off the same data looked like they came from two
 * companies. Everything visual lives here; an export module decides WHAT to
 * put in a sheet, never how it should look.
 *
 * ── The rules the palette encodes ─────────────────────────────────────────
 *
 * Navy is structure — table headers, section rules. Green is the brand and
 * marks titles and totals. Red and green together are reserved for SIGNED
 * money: a figure that can be a gain or a loss. Nothing else is allowed to
 * be red or green, so when a reader sees either, it always means the same
 * thing.
 *
 * Shading is never decorative. A tinted row means "this is subordinate to
 * the row above" or "this is a total", and nothing else.
 */

// ── Brand palette ─────────────────────────────────────────────────────────

/** ARGB, for ExcelJS. */
export const XL = {
  brandGreen: 'FF007A55',
  headerNavy: 'FF1F3864',
  /** Header band one step lighter, for a second-level header row. */
  headerNavySoft: 'FF2E4F7F',
  summaryTint: 'FFE8EEF7',
  /** Nested/sub-row tint — present enough to group, faint enough to ignore. */
  subRowTint: 'FFF7F9FB',
  /** Banding on long tables, lighter still than a sub-row. */
  bandTint: 'FFFCFDFE',
  totalTint: 'FFE8EEF7',
  /** A grand total closes the sheet and gets the brand, not the neutral tint. */
  grandTotalTint: 'FFD8EDE4',
  gridline: 'FFB7C0CC',
  white: 'FFFFFFFF',
  ink: 'FF141414',
  inkSoft: 'FF5A6472',
  /** Signed money only. */
  gain: 'FF0B7A3B',
  loss: 'FFCC0000',
  warn: 'FF9A6700',
  /**
   * Money that moved inside the business rather than through a bank.
   *
   * A third meaning alongside gain and loss, and the only one that is not
   * about sign: an internal transfer has no statement line and no reference
   * because none exists, which reads as missing data unless it is marked.
   */
  internal: 'FF1D4ED8',
  internalTint: 'FFEFF4FE',
} as const

/** RGB tuples, for jsPDF / autotable. */
export const PDF = {
  brandGreen: [0, 122, 85] as [number, number, number],
  headerNavy: [31, 56, 100] as [number, number, number],
  headerNavySoft: [46, 79, 127] as [number, number, number],
  summaryTint: [232, 238, 247] as [number, number, number],
  subRowTint: [247, 249, 251] as [number, number, number],
  bandTint: [252, 253, 254] as [number, number, number],
  totalTint: [232, 238, 247] as [number, number, number],
  grandTotalTint: [216, 237, 228] as [number, number, number],
  gridline: [183, 192, 204] as [number, number, number],
  white: [255, 255, 255] as [number, number, number],
  ink: [20, 20, 20] as [number, number, number],
  inkSoft: [90, 100, 114] as [number, number, number],
  gain: [11, 122, 59] as [number, number, number],
  loss: [204, 0, 0] as [number, number, number],
  /** See XL.internal — the same third meaning, for jsPDF. */
  internal: [29, 78, 216] as [number, number, number],
  internalTint: [239, 244, 254] as [number, number, number],
} as const

// ── Number formats ────────────────────────────────────────────────────────

/**
 * Money. Negatives are red AND parenthesised — colour alone fails on a
 * monochrome print-out, which is how most of these are actually read.
 */
export const NGN = '₦#,##0.00;[Red](₦#,##0.00)'
/**
 * Money that carries meaning in its sign — a differential, a bank charge, a
 * profit. Green when positive, red when negative, so the two read apart at a
 * glance without anyone reaching for the minus sign.
 */
export const NGN_SIGNED = '[Color10]₦#,##0.00;[Red](₦#,##0.00);₦0.00'
export const QTY = '#,##0 "L"'
export const QTY_KG = '#,##0 "kg"'
export const COUNT = '#,##0'
export const PCT = '0.0%'
/**
 * dd-mm-yyyy, hyphens deliberate: in an Excel format code "/" is a
 * placeholder for the reader's own locale separator, so a format written
 * with slashes renders differently machine to machine. "-" is a literal.
 */
export const DATE_FMT = 'dd-mm-yyyy'
/** The date-fns equivalent, for the PDF and anywhere text is written directly. */
export const DATE_PATTERN = 'dd-MM-yyyy'

// ── ExcelJS building blocks ───────────────────────────────────────────────

const THIN = { style: 'thin' as const, color: { argb: XL.gridline } }
export const ALL_BORDERS = { top: THIN, left: THIN, bottom: THIN, right: THIN }

const MEDIUM = { style: 'medium' as const, color: { argb: XL.headerNavy } }
/** Closes a totals row off from the body above it. */
export const TOTAL_BORDERS = { top: MEDIUM, left: THIN, bottom: MEDIUM, right: THIN }

export const fill = (argb: string) => ({
  type: 'pattern' as const,
  pattern: 'solid' as const,
  fgColor: { argb },
})

export const HEADER_FILL = fill(XL.headerNavy)
export const HEADER_FILL_SOFT = fill(XL.headerNavySoft)
export const SUMMARY_FILL = fill(XL.summaryTint)
export const SUBROW_FILL = fill(XL.subRowTint)
export const BAND_FILL = fill(XL.bandTint)
export const TOTAL_FILL = fill(XL.totalTint)
export const GRAND_TOTAL_FILL = fill(XL.grandTotalTint)

/** Every sheet opens the same way: brand title, then a quiet subtitle line. */
export const TITLE_FONT = { bold: true, size: 15, color: { argb: XL.brandGreen } }
export const SUBTITLE_FONT = { size: 9, color: { argb: XL.inkSoft } }
export const SECTION_FONT = { bold: true, size: 12, color: { argb: XL.brandGreen } }
export const HEADER_FONT = { bold: true, size: 10, color: { argb: XL.white } }
export const TOTAL_FONT = { bold: true, size: 10, color: { argb: XL.ink } }

/** Row heights, in points. Space is what makes a dense sheet readable. */
export const ROW_HEIGHT = {
  title: 24,
  subtitle: 16,
  header: 22,
  body: 18,
  total: 22,
} as const

/**
 * Writes the title block every export opens with and returns the next free
 * row. `columnSpan` is how far the banner should reach across.
 */
export function writeTitleBlock(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ws: any,
  row: number,
  { title, subtitle, columnSpan }: { title: string; subtitle: string; columnSpan: number },
): number {
  const titleRow = ws.getRow(row)
  titleRow.getCell(1).value = title
  titleRow.getCell(1).font = TITLE_FONT
  titleRow.getCell(1).alignment = { vertical: 'middle' }
  titleRow.height = ROW_HEIGHT.title
  if (columnSpan > 1) ws.mergeCells(row, 1, row, columnSpan)

  const subRow = ws.getRow(row + 1)
  subRow.getCell(1).value = subtitle
  subRow.getCell(1).font = SUBTITLE_FONT
  subRow.getCell(1).alignment = { vertical: 'middle' }
  subRow.height = ROW_HEIGHT.subtitle
  if (columnSpan > 1) ws.mergeCells(row + 1, 1, row + 1, columnSpan)

  return row + 2
}

/** A section heading inside a sheet — "PFI STOCK SUMMARY" and the like. */
export function writeSectionHeading(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ws: any,
  row: number,
  text: string,
): number {
  const r = ws.getRow(row)
  r.getCell(1).value = text
  r.getCell(1).font = SECTION_FONT
  r.height = ROW_HEIGHT.header
  return row + 1
}

/**
 * Colours a signed money cell green or red.
 *
 * Applied on top of NGN_SIGNED rather than instead of it: the format handles
 * the printed workbook, this handles the case where a reader has replaced
 * the format, and together they mean the sign is never carried by colour
 * alone.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function paintSigned(cell: any, value: number) {
  if (value > 0) cell.font = { ...(cell.font || {}), color: { argb: XL.gain } }
  else if (value < 0) cell.font = { ...(cell.font || {}), color: { argb: XL.loss } }
}

// ── autotable presets ─────────────────────────────────────────────────────

export const pdfStyles = {
  body: {
    fontSize: 6.8,
    cellPadding: 2,
    lineColor: PDF.gridline,
    lineWidth: 0.1,
    textColor: PDF.ink,
    valign: 'middle' as const,
  },
  head: {
    fillColor: PDF.headerNavy,
    textColor: PDF.white,
    fontStyle: 'bold' as const,
    fontSize: 7,
    cellPadding: 2.5,
    lineWidth: 0.1,
    lineColor: PDF.gridline,
  },
  foot: {
    fillColor: PDF.totalTint,
    textColor: PDF.ink,
    fontStyle: 'bold' as const,
    fontSize: 7,
    cellPadding: 2.5,
    lineWidth: 0.1,
    lineColor: PDF.gridline,
  },
  summaryBody: {
    fillColor: PDF.summaryTint,
    fontStyle: 'bold' as const,
    textColor: PDF.ink,
  },
} as const

/**
 * The brand header every PDF opens with, plus the generated-at line.
 * Returns the y to start the first table at.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function drawPdfHeader(doc: any, title: string, subtitle: string): number {
  const pageWidth = doc.internal.pageSize.getWidth()

  // A thin brand rule across the top does more for "this is ours" than a
  // bigger logotype would, and costs no vertical space worth having.
  doc.setFillColor(...PDF.brandGreen)
  doc.rect(0, 0, pageWidth, 3, 'F')

  doc.setFontSize(15)
  doc.setTextColor(...PDF.brandGreen)
  doc.setFont('helvetica', 'bold')
  doc.text(title, 14, 15)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(...PDF.inkSoft)
  doc.text(subtitle, 14, 21)
  doc.setTextColor(...PDF.ink)

  return 26
}

/**
 * Page numbers, written after every page exists.
 *
 * autotable's own didDrawPage fires before later pages are added, so a
 * footer drawn there reads "Page 1 of 1" on every page of a five-page
 * report. This walks the finished document instead.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function drawPdfFooters(doc: any, note?: string) {
  const pages = doc.internal.getNumberOfPages()
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()

  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setFontSize(7.5)
    doc.setTextColor(...PDF.inkSoft)
    if (note) doc.text(note, 14, pageHeight - 8)
    doc.text(`Page ${i} of ${pages}`, pageWidth - 14, pageHeight - 8, { align: 'right' })
  }
  doc.setTextColor(...PDF.ink)
}

/** Shared naira text for PDFs, where the ₦ glyph is not in the core fonts. */
export function pdfNaira(n: number): string {
  const abs = Math.abs(n).toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return n < 0 ? `(NGN ${abs})` : `NGN ${abs}`
}

export function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
