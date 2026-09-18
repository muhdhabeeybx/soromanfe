import { format, parseISO } from 'date-fns'
import type { CfoReport, CfoDay, CfoRow, CfoTotals } from '#/lib/hooks/useCfoReport'
import {
  CFO_SHEET_COLUMNS, CFO_CORE_COLUMNS, cfoRowValues, cfoTotalValues, cfoDisplay,
  quantityAcrossUnits, unitShort, rowRemark, nairaIn, nairaSignedIn,
  type CurrencyMark,
} from './-cfo-columns'
import {
  XL, PDF, NGN, NGN_SIGNED, COUNT, qtyFormat, ALL_BORDERS, TOTAL_BORDERS,
  HEADER_FILL, SUMMARY_FILL, TOTAL_FILL, GRAND_TOTAL_FILL,
  HEADER_FONT, TOTAL_FONT, SECTION_FONT, ROW_HEIGHT,
  writeTitleBlock, paintSigned, pdfStyles, drawPdfHeader, drawPdfFooters,
  applySatoshi, triggerDownload,
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
 * LPG PFI is kilogrammes and must not print "L".
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

/**
 * Text the PDF's typefaces can actually draw.
 *
 * Applied to EVERY string this document renders, generated or typed. Two
 * characters go missing silently, and silence is the problem:
 *
 *   U+2212 MINUS SIGN   absent from Satoshi and from jsPDF's Helvetica. It
 *                       does not render as a box, it renders as nothing — so
 *                       "initial qty − cumulative" printed as "initial qty
 *                       cumulative", and a negative figure would print as a
 *                       positive one. On a finance document that is not a
 *                       typographic blemish, it is a wrong number.
 *   U+20A6 NAIRA SIGN   absent from both, for the same reason the money
 *                       columns use the ISO form. A remark somebody typed
 *                       with a ₦ in it would otherwise print a broken bar.
 *
 * Mapped rather than stripped, so the meaning survives the substitution.
 */
const pdfSafe = (text: string): string =>
  String(text ?? '').replace(/\u2212/g, '-').replace(/\u20A6/g, 'NGN ')

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
    filters.includeAll ? 'Showing: all PFIs' : 'Showing: PFIs trading',
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
    ['PFIs', t.rows, COUNT],
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
function footnotes(
  report: CfoReport,
  ngn: (n: number) => string = (n) =>
    `₦${n.toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`,
): string[] {
  const m = report.meta
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
  ws.columns = CFO_SHEET_COLUMNS.map((c) => ({ key: c.key, width: c.width }))

  let cursor = writeTitleBlock(ws, 1, {
    title: 'CFO Report — Depot Sales per PFI',
    subtitle: subtitle(report, filters),
    columnSpan: CFO_SHEET_COLUMNS.length,
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
    // missing page; "no PFIs trading" is an answer.
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
    ws.mergeCells(cursor, 1, cursor, CFO_SHEET_COLUMNS.length)
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
  ws.mergeCells(cursor, 1, cursor, CFO_SHEET_COLUMNS.length)
  cursor++

  const headerRow = ws.getRow(cursor)
  headerRow.values = Object.fromEntries(CFO_SHEET_COLUMNS.map((c) => [c.key, c.header]))
  headerRow.height = ROW_HEIGHT.header
  for (const c of CFO_SHEET_COLUMNS) {
    const cell = headerRow.getCell(c.key)
    cell.font = HEADER_FONT
    cell.fill = HEADER_FILL
    cell.border = ALL_BORDERS
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
  }
  cursor++

  if (!d.rows.length) {
    const empty = ws.getRow(cursor)
    empty.getCell(1).value = 'No PFIs trading on this date.'
    empty.getCell(1).font = { italic: true, size: 9, color: { argb: XL.inkSoft } }
    empty.getCell(1).border = ALL_BORDERS
    ws.mergeCells(cursor, 1, cursor, CFO_SHEET_COLUMNS.length)
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
  const remark = rowRemark(row)
  const excelRow = ws.getRow(index)
  excelRow.values = values
  excelRow.height = ROW_HEIGHT.body

  for (const c of CFO_SHEET_COLUMNS) {
    const cell = excelRow.getCell(c.key)
    cell.border = ALL_BORDERS
    if (c.kind === 'qty') cell.numFmt = qtyFmtFor(row.productUnit)
    else if (c.kind === 'money') cell.numFmt = NGN
    else if (c.kind === 'signed') {
      cell.numFmt = NGN_SIGNED
      paintSigned(cell, row.surplusDeficit)
    }
    if (c.kind === 'percent') cell.numFmt = '0%'
    if (c.kind === 'text' || c.kind === 'index') {
      cell.alignment = {
        vertical: 'middle',
        wrapText: c.key === 'remarks' || c.key === 'inflowMakeup',
      }
    }
    // The figures the eye should land on: what is left, what it came to, what
    // arrived, and the gap. Bold is the only emphasis used in the body, so it
    // keeps its force.
    if (c.bold) cell.font = { ...(cell.font || {}), bold: true }

    /**
     * A remark the row wrote about itself is set in the soft ink and says so
     * in its note. On an audit sheet, a generated sentence that looks
     * identical to one a person typed is worse than an empty cell — somebody
     * will quote it back as a colleague's judgement.
     */
    if (c.key === 'remarks' && remark.auto) {
      // Set in the soft ink and marked in its note — but NOT italicised: a
      // whole column of italics is harder to read than the sentences are
      // worth, and the note is what actually carries the fact.
      cell.font = { ...(cell.font || {}), color: { argb: XL.inkSoft } }
      cell.note = 'Written from this row\u2019s own figures. Nobody typed this.'
    }

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

  for (const c of CFO_SHEET_COLUMNS) {
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
  // Landscape: twelve columns, three of them wide money figures, will not read
  // on a portrait page.
  const doc = new jsPDF({ orientation: 'landscape', format: 'a4' })

  /**
   * Satoshi, the face the rest of the company's documents are set in — and
   * with it the ISO money form.
   *
   * Satoshi has no U+20A6, so a report set in it that printed "₦" would put an
   * empty box beside every figure. Neither does jsPDF's core Helvetica, which
   * is what the first version of this export used: it rendered a broken bar in
   * place of the naira sign on every one of the three money columns. "NGN
   * 32,784,600,000" is the standard form on a financial document anyway.
   *
   * If the face will not load the document still prints, in Helvetica — and
   * then it keeps the ₦ sign, because only Satoshi lacks the glyph.
   */
  const satoshi = await applySatoshi(doc)
  /**
   * The currency mark this document can actually draw, threaded through every
   * figure AND every generated remark.
   *
   * report-theme's own pdfNairaIso is not used, deliberately: it forces two
   * decimal places, and ".00" on all three money columns is what pushed
   * "NGN 32,784,600,000.00" past its column and split it across two lines.
   * These writers share the screen's rule instead — kobo shown only where
   * there is kobo — so the PDF and the page print a figure the same way.
   */
  const mark: CurrencyMark = satoshi ? 'NGN ' : '₦'
  const money = nairaIn(mark)
  const signedMoney = nairaSignedIn(mark)

  /**
   * autotable picks its own font and ignores the document's, so the face has
   * to be handed to every table. Without it the headings come out in Satoshi
   * and the tables beneath in Helvetica — the tell that makes a generated
   * document look assembled rather than designed.
   */
  const face = satoshi ? { font: 'Satoshi' } : {}

  /**
   * The page margins, stated rather than inherited.
   *
   * autotable's default margin is large enough that the fixed column widths
   * below would not fit inside it, and it would then shrink them back — which
   * is how a figure ends up wrapped again after being given a width precisely
   * so it would not. 14mm matches where drawPdfHeader puts the title, so the
   * table lines up with the heading above it.
   *
   *   A4 landscape 297mm − 28mm of margin = 269mm, and the fixed widths come
   *   to 235mm, leaving 34mm for Remarks.
   *
   * Thirteen columns will not sit at 6pt inside that, so the body steps down
   * to 5.6. That is preferable to the two alternatives: dropping a column
   * loses information from the printed document, and moving to A3 hands
   * people paper their office does not stock.
   */
  const margin = { left: 14, right: 14 }

  let y = drawPdfHeader(doc, 'CFO Report — Depot Sales per PFI', pdfSafe(subtitle(report, filters)))

  const pairs = summaryPairs(report)
  autoTable(doc, {
    startY: y,
    head: [pairs.map(([label]) => label)],
    body: [pairs.map(([, value, fmt]) => pdfSafe(pdfSummaryCell(value, fmt, money)))],
    theme: 'grid',
    margin,
    styles: { ...pdfStyles.body, ...face, halign: 'center', fontSize: 7 },
    headStyles: { ...pdfStyles.head, ...face, fontSize: 6.8 },
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

  /**
   * Fixed widths on every numeric column, in millimetres.
   *
   * Left to size itself by content, autotable wrapped money figures
   * mid-number — "₦32,784,600,0" on one line, "00.00" on the next. That is not
   * a hard-to-read figure, it is a wrong one, and it is the single worst thing
   * a report like this can print. Remarks carries no width and takes what is
   * left, which is correct: prose is the one thing on this sheet that should
   * wrap.
   */
  const columnStyles: Record<
    number,
    { halign: 'left' | 'right'; cellWidth?: number; fontStyle?: 'bold' }
  > =
    Object.fromEntries(
      CFO_CORE_COLUMNS.map((c, i) => [
        i,
        {
          halign: (c.kind === 'text' || c.kind === 'index' ? 'left' : 'right') as 'left' | 'right',
          ...(c.pdf ? { cellWidth: c.pdf } : {}),
          // The same four figures the workbook bolds, so a reader moving
          // between the two documents is looking at the same emphasis.
          ...(c.bold ? { fontStyle: 'bold' as const } : {}),
        },
      ]),
    )

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
    doc.setFont(satoshi ? 'Satoshi' : 'helvetica', 'bold')
    doc.text(pdfSafe(day(d.date).toUpperCase()), 14, y)
    doc.setFont(satoshi ? 'Satoshi' : 'helvetica', 'normal')
    doc.setTextColor(...PDF.ink)
    y += 3

    const body = d.rows.map((row, i) => {
      const values = cfoRowValues(row, i, mark)
      return CFO_CORE_COLUMNS.map((c) =>
        pdfSafe(cfoDisplay(c, values[c.key], row.productUnit, money, signedMoney)),
      )
    })

    const { values: totalValues, unit } = cfoTotalValues(d.totals, `${dayShort(d.date)} total`)
    const foot = d.rows.length
      ? [
          CFO_CORE_COLUMNS.map((c) => {
            const v = totalValues[c.key]
            if (v === null) return '—'
            return pdfSafe(cfoDisplay(c, v, unit || 'Litres', money, signedMoney))
          }),
        ]
      : undefined

    autoTable(doc, {
      startY: y,
      head: [CFO_CORE_COLUMNS.map((c) => c.header)],
      body: body.length
        ? body
        : [['—', 'No PFIs trading on this date.', ...Array(CFO_CORE_COLUMNS.length - 2).fill('')]],
      foot,
      theme: 'grid',
      styles: { ...pdfStyles.body, ...face, fontSize: 5.6, cellPadding: 1.3 },
      headStyles: { ...pdfStyles.head, ...face, fontSize: 5.6, cellPadding: 1.6 },
      footStyles: { ...pdfStyles.foot, ...face, fontSize: 5.6, cellPadding: 1.3 },
      columnStyles,
      margin,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      didParseCell: (data: any) => {
        const column = CFO_CORE_COLUMNS[data.column.index]
        if (!column) return

        if (column.kind === 'signed' && (data.section === 'foot' || data.section === 'body')) {
          const value =
            data.section === 'body' ? d.rows[data.row.index]?.surplusDeficit : d.totals.surplusDeficit
          data.cell.styles.textColor = (value ?? 0) < 0 ? PDF.loss : PDF.gain
        }

        if (data.section !== 'body') return
        const row = d.rows[data.row.index]
        if (!row) return

        // Corrected cells, marked as they are in the workbook.
        if (column.field && row.edited.includes(column.field)) {
          data.cell.styles.textColor = PDF.internal
          data.cell.styles.fontStyle = 'bold'
          data.cell.styles.fillColor = PDF.internalTint
        }

        // A remark the row wrote about itself is set in italic soft ink, so it
        // cannot be read as a colleague's words.
        // A remark the row wrote about itself sits in the soft ink. Not
        // italicised — a column of italics is harder to read than the
        // sentences are worth.
        if (column.key === 'remarks' && rowRemark(row, mark).auto) {
          data.cell.styles.textColor = PDF.inkSoft
        }
        if (column.key === 'inflowMakeup') data.cell.styles.textColor = PDF.inkSoft

        // The PFI reference over the place it trades from: the reference is
        // the line that gets looked up, so it is the one in bold.
        if (column.key === 'pfiLocation') data.cell.styles.fontStyle = 'bold'
      },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = (doc as any).lastAutoTable.finalY

    /**
     * Where a day holds more than one unit its quantity totals are blank —
     * litres and kilogrammes have no sum — so the per-unit figures go
     * underneath in words. Without this the PDF simply lost them: the screen
     * states them under the table and the workbook puts them in the totals
     * row, and only this document had four dashes and no explanation.
     */
    const units = Object.values(d.totals.byUnit)
    if (units.length > 1) {
      y += 3.5
      doc.setFontSize(6.5)
      doc.setTextColor(...PDF.inkSoft)
      doc.text(
        pdfSafe(`Quantities are not totalled across units.  ${units
          .map(
            (u) =>
              `${unitShort(u.unit)} — sold today ${Math.round(u.dayVolume).toLocaleString('en-NG')}, balance ${Math.round(u.stockBalance).toLocaleString('en-NG')}`,
          )
          .join('   ·   ')}`),
        14,
        y,
      )
      doc.setTextColor(...PDF.ink)
    }
    y += 7
  }

  // The notes close the document, on a page of their own if there is no room
  // for them — a footnote split across a page break is a footnote nobody reads.
  const notes = footnotes(report, money)
  const pageHeight = doc.internal.pageSize.getHeight()
  const pageWidth = doc.internal.pageSize.getWidth()
  if (y > pageHeight - (14 + notes.length * 9)) {
    doc.addPage()
    y = 18
  }
  doc.setFontSize(8)
  doc.setTextColor(...PDF.inkSoft)
  for (const note of notes) {
    const lines = doc.splitTextToSize(pdfSafe(`•  ${note}`), pageWidth - 28)
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
function pdfSummaryCell(
  value: string | number,
  fmt: string | undefined,
  money: (n: number) => string,
): string {
  if (typeof value === 'string') return value
  if (fmt === NGN || fmt === NGN_SIGNED) {
    return value < 0 ? `(${money(Math.abs(value))})` : money(value)
  }
  return value.toLocaleString('en-NG')
}
