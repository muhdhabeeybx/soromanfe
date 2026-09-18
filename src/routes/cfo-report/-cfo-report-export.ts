import { format, parseISO } from 'date-fns'
import type { CfoReport, CfoDay, CfoRow, CfoTotals } from '#/lib/hooks/useCfoReport'
import {
  CFO_COLUMNS, CFO_CORE_COLUMNS, cfoRowValues, cfoTotalValues, cfoDisplay,
  quantityAcrossUnits, unitShort,
} from './-cfo-columns'
import {
  XL, PDF, NGN, NGN_SIGNED, COUNT, qtyFormat, ALL_BORDERS, TOTAL_BORDERS,
  HEADER_FILL, SUMMARY_FILL, TOTAL_FILL, GRAND_TOTAL_FILL,
  HEADER_FONT, TOTAL_FONT, SECTION_FONT, ROW_HEIGHT,
  writeTitleBlock, paintSigned, pdfStyles, drawPdfHeader, drawPdfFooters,
  triggerDownload,
} from '#/lib/report-theme'

/**
 * The CFO report, as a workbook and as a document.
 *
 * Both are built from the same column list and the same row values as the
 * screen — see -cfo-columns.ts — so a figure cannot differ between what
 * somebody read and what they sent on.
 *
 * ── The workbook is the one that gets checked ──────────────────────────────
 *
 * Quantities and money are written as real numbers with a cell format, never
 * as pre-formatted text. A column that reads like litres but is text cannot
 * be summed or pivoted, and that is the first thing anybody does with this
 * sheet. It also means each row carries its OWN unit format: 160,000 on an
 * LPG batch is kilogrammes and must not print "L".
 *
 * ── Shading means one thing ────────────────────────────────────────────────
 *
 * Per report-theme: a tint marks a total or a subordinate row, never
 * decoration; red and green are reserved for signed money. A corrected cell
 * is marked in the internal blue, which is the palette's third meaning — not
 * a gain, not a loss, "this did not come from where the rest of the column
 * came from".
 */

export interface CfoExportFilters {
  periodLabel: string
  locationName: string
  pfiNumber: string
  includeAll: boolean
}

const day = (iso: string) => format(parseISO(iso), 'EEEE, d MMMM yyyy')
const dayShort = (iso: string) => format(parseISO(iso), 'd MMM yyyy')

/** What report-theme's `fill()` returns — an ExcelJS solid pattern fill. */
type ExcelFill = typeof TOTAL_FILL

/** The format a quantity cell takes, given the unit of the row it is on. */
const qtyFmtFor = (unit: string) => qtyFormat(unitShort(unit))

function filename(report: CfoReport, filters: CfoExportFilters, ext: string) {
  const scope = filters.locationName !== 'All locations' ? filters.locationName : 'ALL'
  const span =
    report.meta.dateFrom === report.meta.dateTo
      ? report.meta.dateFrom
      : `${report.meta.dateFrom}_${report.meta.dateTo}`
  return `CFO-REPORT_${scope}_${span}.${ext}`.replace(/\s+/g, '-').toUpperCase()
}

/**
 * The subtitle every export opens with — what this document covers, stated
 * plainly enough that a printed copy on a desk is self-describing.
 */
function subtitle(report: CfoReport, filters: CfoExportFilters): string {
  return [
    `Period: ${filters.periodLabel}`,
    `Location: ${filters.locationName}`,
    `PFI: ${filters.pfiNumber}`,
    filters.includeAll ? 'Showing: all batches' : 'Showing: batches trading',
    `Dates are ${report.meta.timezone} calendar days`,
  ].join('   ·   ')
}

/**
 * The closing position, as figures a reader wants before any row.
 *
 * The cumulative columns are already cumulative, so these are the LAST day's
 * position, not a sum down the report — adding thirty days of "cumulative
 * sales volume" together counts the same litres thirty times. Volume moved
 * over the period is the one figure that genuinely sums, and it is labelled
 * as such.
 */
function summaryPairs(report: CfoReport): Array<[string, string | number, string?]> {
  const t = report.totals
  const periodVolume = Object.entries(t.periodByUnit || {})
    .filter(([, v]) => v !== 0)
    .map(([unit, v]) => `${Math.round(v).toLocaleString('en-NG')} ${unitShort(unit)}`)
    .join(' · ')

  return [
    ['Batches', t.rows, COUNT],
    ['Volume Sold In Period', periodVolume || '0'],
    ['Stock Balance', quantityAcrossUnits(t, (u) => u.stockBalance)],
    ['Sales Value To Date', t.salesValue, NGN],
    ['Bank Inflow Confirmed', t.bankInflow, NGN],
    ['Surplus / (Deficit)', t.surplusDeficit, NGN_SIGNED],
  ]
}

/**
 * What this document leaves out, and where it parts company with the finance
 * report.
 *
 * Printed on the sheet rather than kept in a ticket. Both figures are money
 * that exists and that this report does not count, and a reader comparing it
 * against the audited finance report will find exactly these differences —
 * so the report states them itself instead of being caught out by them.
 */
function footnotes(report: CfoReport): string[] {
  const m = report.meta
  const ngn = (n: number) => `₦${n.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const notes: string[] = [
    'A sale is an order whose payment is confirmed, counted on the day the order was placed — the same rule the PFI page and the Finance Report use.',
    'Stock balance = initial qty − cumulative sales volume. Surplus / (deficit) = bank inflow − sales value. Both are derived and cannot be typed over.',
  ]
  if (m.partPaidHeld) {
    notes.push(
      `Excluded — part-paid orders: ${ngn(m.partPaidHeld)} across ${m.partPaidOrders} order(s). Counted on neither side: not yet a confirmed sale, so neither its litres nor its money appear above.`,
    )
  }
  if (m.duplicatesExcluded) {
    notes.push(
      `Excluded — duplicate payment rows from migration 0021: ${ngn(m.duplicatesExcluded)} across ${m.duplicateRows} row(s). The Finance Report is audited against figures that include these and does not move; this report reads past them.`,
    )
  }
  return notes
}

// ── Excel ───────────────────────────────────────────────────────────────────

export async function exportCfoReportExcel(report: CfoReport, filters: CfoExportFilters) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Soroman Energy'
  wb.created = new Date()

  const ws = wb.addWorksheet('CFO Report', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })
  ws.columns = CFO_COLUMNS.map((c) => ({ key: c.key, width: c.width }))

  let cursor = writeTitleBlock(ws, 1, {
    title: 'CFO Report — Depot Sales per PFI',
    subtitle: subtitle(report, filters),
    columnSpan: CFO_COLUMNS.length,
  })
  cursor += 1

  // The closing position first: this is read for its totals before anybody
  // looks at a single row.
  const pairs = summaryPairs(report)
  const labelRow = ws.getRow(cursor)
  pairs.forEach(([label], i) => {
    const cell = labelRow.getCell(i * 2 + 1)
    cell.value = label
    cell.font = { bold: true, size: 9 }
    cell.fill = SUMMARY_FILL
    cell.border = ALL_BORDERS
  })
  labelRow.height = ROW_HEIGHT.body
  cursor++

  const valueRow = ws.getRow(cursor)
  pairs.forEach(([, value, fmt], i) => {
    const cell = valueRow.getCell(i * 2 + 1)
    cell.value = value
    if (fmt) cell.numFmt = fmt
    cell.font = TOTAL_FONT
    cell.fill = SUMMARY_FILL
    cell.border = ALL_BORDERS
    if (fmt === NGN_SIGNED) paintSigned(cell, Number(value) || 0)
  })
  valueRow.height = ROW_HEIGHT.total
  cursor += 2

  for (const d of report.days) {
    // A day with nothing on it is still stated. A silent gap reads as a
    // missing page; "no batches trading" is an answer.
    cursor = writeDaySection(ws, cursor, d)
    cursor += 1
  }

  // The report's own closing row, in the brand tint — a grand total closes the
  // sheet and is not just another day's total.
  cursor = writeTotalRow(ws, cursor, report.totals, 'REPORT TOTAL — closing position', {
    fill: GRAND_TOTAL_FILL,
  })
  cursor += 2

  for (const note of footnotes(report)) {
    const r = ws.getRow(cursor)
    r.getCell(1).value = note
    r.getCell(1).font = { size: 8.5, color: { argb: XL.inkSoft } }
    r.getCell(1).alignment = { wrapText: true, vertical: 'top' }
    r.height = 26
    ws.mergeCells(cursor, 1, cursor, CFO_COLUMNS.length)
    cursor++
  }

  const buf = await wb.xlsx.writeBuffer()
  triggerDownload(
    new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    filename(report, filters, 'xlsx'),
  )
}

/** One day: its heading, its column header, its rows and its total. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function writeDaySection(ws: any, start: number, d: CfoDay): number {
  let cursor = start

  const heading = ws.getRow(cursor)
  heading.getCell(1).value = day(d.date).toUpperCase()
  heading.getCell(1).font = SECTION_FONT
  heading.height = ROW_HEIGHT.header
  ws.mergeCells(cursor, 1, cursor, CFO_COLUMNS.length)
  cursor++

  const headerRow = ws.getRow(cursor)
  headerRow.values = Object.fromEntries(CFO_COLUMNS.map((c) => [c.key, c.header]))
  headerRow.height = ROW_HEIGHT.header
  for (const c of CFO_COLUMNS) {
    const cell = headerRow.getCell(c.key)
    cell.font = HEADER_FONT
    cell.fill = HEADER_FILL
    cell.border = ALL_BORDERS
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
  }
  cursor++

  if (!d.rows.length) {
    const empty = ws.getRow(cursor)
    empty.getCell(1).value = 'No batches trading on this date.'
    empty.getCell(1).font = { italic: true, size: 9, color: { argb: XL.inkSoft } }
    empty.getCell(1).border = ALL_BORDERS
    ws.mergeCells(cursor, 1, cursor, CFO_COLUMNS.length)
    return cursor + 1
  }

  d.rows.forEach((row, i) => {
    writeDataRow(ws, cursor, row, i)
    cursor++
  })

  return writeTotalRow(ws, cursor, d.totals, `${dayShort(d.date)} total`, { fill: TOTAL_FILL })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function writeDataRow(ws: any, index: number, row: CfoRow, position: number) {
  const values = cfoRowValues(row, position)
  const excelRow = ws.getRow(index)
  excelRow.values = values
  excelRow.height = ROW_HEIGHT.body

  for (const c of CFO_COLUMNS) {
    const cell = excelRow.getCell(c.key)
    cell.border = ALL_BORDERS
    if (c.kind === 'qty') cell.numFmt = qtyFmtFor(row.productUnit)
    else if (c.kind === 'money') cell.numFmt = NGN
    else if (c.kind === 'signed') {
      cell.numFmt = NGN_SIGNED
      paintSigned(cell, row.surplusDeficit)
    }
    if (c.kind === 'text' || c.kind === 'index') cell.alignment = { vertical: 'middle', wrapText: c.key === 'remarks' }

    /**
     * A corrected cell is marked, and what the system said is put in the
     * cell's note.
     *
     * The blue is report-theme's `internal` — its third meaning, alongside
     * gain and loss, for a figure that did not come from where the rest of
     * the column came from. Keeping the system's own figure in a comment
     * rather than a second column is what makes the sheet the same shape as
     * the screen while still being checkable.
     */
    if (c.field && row.edited.includes(c.field)) {
      cell.font = { ...(cell.font || {}), bold: true, color: { argb: XL.internal } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.internalTint } }
      const systemValue = row.computed[c.field]
      cell.note = [
        'Corrected.',
        `System figure: ${cfoDisplay(c, systemValue, row.productUnit)}`,
        row.updatedByName ? `By: ${row.updatedByName}` : '',
      ].filter(Boolean).join('\n')
    }
  }
}

/** A totals row, keyed through the same columns as everything above it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function writeTotalRow(ws: any, index: number, totals: CfoTotals, label: string, opts: { fill: ExcelFill }): number {
  const { values, unit } = cfoTotalValues(totals, label)
  const row = ws.getRow(index)
  row.height = ROW_HEIGHT.total

  for (const c of CFO_COLUMNS) {
    const cell = row.getCell(c.key)
    const value = values[c.key]
    // Null is "these rows are in more than one unit and have no sum" — left
    // blank rather than printed as 0, which would be a wrong number.
    cell.value = value === null ? '' : value
    cell.font = TOTAL_FONT
    cell.fill = opts.fill
    cell.border = TOTAL_BORDERS
    if (c.kind === 'qty' && unit && value !== null) cell.numFmt = qtyFmtFor(unit)
    else if (c.kind === 'money' && value !== null) cell.numFmt = NGN
    else if (c.kind === 'signed') {
      cell.numFmt = NGN_SIGNED
      paintSigned(cell, Number(value) || 0)
    }
  }

  // Where the rows are in more than one unit, the quantity totals go into the
  // Remarks cell in words rather than being dropped. They are real figures and
  // a totals row that silently has four blanks in it reads as broken.
  if (!unit) {
    row.getCell('remarks').value = [
      `Sold today: ${quantityAcrossUnits(totals, (u) => u.dayVolume)}`,
      `Balance: ${quantityAcrossUnits(totals, (u) => u.stockBalance)}`,
    ].join('   ·   ')
    row.getCell('remarks').alignment = { wrapText: true, vertical: 'middle' }
  }

  return index + 1
}

// ── PDF ─────────────────────────────────────────────────────────────────────

export async function exportCfoReportPdf(report: CfoReport, filters: CfoExportFilters) {
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default
  // Landscape: twelve columns, four of them wide money figures, will not read
  // on a portrait page.
  const doc = new jsPDF({ orientation: 'landscape', format: 'a4' })

  let y = drawPdfHeader(
    doc,
    'CFO Report — Depot Sales per PFI',
    subtitle(report, filters),
  )

  const pairs = summaryPairs(report)
  autoTable(doc, {
    startY: y,
    head: [pairs.map(([label]) => label)],
    body: [pairs.map(([, value, fmt]) => pdfSummaryCell(value, fmt))],
    theme: 'grid',
    styles: { ...pdfStyles.body, halign: 'center', fontSize: 7 },
    headStyles: { ...pdfStyles.head, fontSize: 6.8 },
    // The surplus/deficit cell is the only one on this band that carries a
    // sign, and it is coloured the same way it is everywhere else.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    didParseCell: (data: any) => {
      if (data.section !== 'body' || data.column.index !== pairs.length - 1) return
      data.cell.styles.textColor = report.totals.surplusDeficit < 0 ? PDF.loss : PDF.gain
    },
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 7

  for (const d of report.days) {
    const pageHeight = doc.internal.pageSize.getHeight()
    // A day heading stranded at the foot of a page with its table overleaf is
    // the commonest way a long report becomes unreadable.
    if (y > pageHeight - 40) {
      doc.addPage()
      y = 16
    }

    doc.setFontSize(9.5)
    doc.setTextColor(...PDF.brandGreen)
    doc.text(day(d.date).toUpperCase(), 14, y)
    doc.setTextColor(...PDF.ink)
    y += 3

    const body = d.rows.map((row, i) => {
      const values = cfoRowValues(row, i)
      return CFO_CORE_COLUMNS.map((c) => cfoDisplay(c, values[c.key], row.productUnit))
    })

    const { values: totalValues, unit } = cfoTotalValues(d.totals, `${dayShort(d.date)} total`)
    const foot = d.rows.length
      ? [
          CFO_CORE_COLUMNS.map((c) => {
            const v = totalValues[c.key]
            if (v === null) return '—'
            return cfoDisplay(c, v, unit || 'Litres')
          }),
        ]
      : undefined

    autoTable(doc, {
      startY: y,
      head: [CFO_CORE_COLUMNS.map((c) => c.header)],
      body: body.length ? body : [['—', 'No batches trading on this date.', ...Array(CFO_CORE_COLUMNS.length - 2).fill('')]],
      foot,
      theme: 'grid',
      styles: { ...pdfStyles.body, fontSize: 6, cellPadding: 1.6 },
      headStyles: { ...pdfStyles.head, fontSize: 6 },
      footStyles: { ...pdfStyles.foot, fontSize: 6 },
      columnStyles: Object.fromEntries(
        CFO_CORE_COLUMNS.map((c, i) => [
          i,
          { halign: c.kind === 'text' || c.kind === 'index' ? 'left' : 'right' },
        ]),
      ),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      didParseCell: (data: any) => {
        const column = CFO_CORE_COLUMNS[data.column.index]
        if (!column) return
        if (data.section === 'foot' || data.section === 'body') {
          if (column.kind === 'signed') {
            const value = data.section === 'body' ? d.rows[data.row.index]?.surplusDeficit : d.totals.surplusDeficit
            data.cell.styles.textColor = (value ?? 0) < 0 ? PDF.loss : PDF.gain
          }
        }
        // Corrected cells, marked as they are in the workbook.
        if (data.section === 'body' && column.field) {
          const row = d.rows[data.row.index]
          if (row?.edited.includes(column.field)) {
            data.cell.styles.textColor = PDF.internal
            data.cell.styles.fontStyle = 'bold'
            data.cell.styles.fillColor = PDF.internalTint
          }
        }
      },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = (doc as any).lastAutoTable.finalY + 7
  }

  // The notes close the document, on a page of their own if there is no room
  // for them — a footnote split across a page break is a footnote nobody reads.
  const notes = footnotes(report)
  const pageHeight = doc.internal.pageSize.getHeight()
  const pageWidth = doc.internal.pageSize.getWidth()
  if (y > pageHeight - (14 + notes.length * 9)) {
    doc.addPage()
    y = 18
  }
  doc.setFontSize(8)
  doc.setTextColor(...PDF.inkSoft)
  for (const note of notes) {
    const lines = doc.splitTextToSize(`•  ${note}`, pageWidth - 28)
    doc.text(lines, 14, y)
    y += lines.length * 3.6 + 2.4
  }
  doc.setTextColor(...PDF.ink)

  drawPdfFooters(
    doc,
    `${report.meta.dateFrom} to ${report.meta.dateTo}  ·  ${filters.locationName}  ·  generated ${format(new Date(), 'd MMM yyyy HH:mm')}`,
  )
  doc.save(filename(report, filters, 'pdf'))
}

/**
 * A summary cell for the PDF.
 *
 * The naira glyph is in the core jsPDF fonts (this document is not set in
 * Satoshi, which has no U+20A6), so money keeps its symbol here.
 */
function pdfSummaryCell(value: string | number, fmt?: string): string {
  if (typeof value === 'string') return value
  if (fmt === NGN || fmt === NGN_SIGNED) {
    const abs = Math.abs(value).toLocaleString('en-NG', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
    return value < 0 ? `(₦${abs})` : `₦${abs}`
  }
  return value.toLocaleString('en-NG')
}
