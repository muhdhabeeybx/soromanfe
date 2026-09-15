import { format } from 'date-fns'
import {
  XL, PDF, NGN, COUNT, ALL_BORDERS, TOTAL_BORDERS, HEADER_FILL, SUMMARY_FILL, SUBROW_FILL,
  BAND_FILL, fill, writeTitleBlock, applySatoshi, drawPdfHeader, drawPdfFooters,
  pdfStyles, pdfNaira, pdfNairaIso, triggerDownload,
} from '#/lib/report-theme'

/**
 * The costing page, as a document.
 *
 * Batch by batch, each opening into its trucks — the same shape as the screen,
 * because somebody reading the file has usually just been looking at the page
 * and should not have to re-learn the layout.
 *
 * Money and litres go in as NUMBERS with a cell format, never as formatted
 * text. The first thing anybody does with a costing sheet is total a column or
 * sort by margin, and a column of strings does neither.
 */

export interface CostingRow {
  id: number
  truckNumber?: string | null
  quantityAllocated?: number | null
  agoLitres?: number | null
  agoPrice?: number | null
  agoValue?: number | null
  feedingAllowance?: number | null
  totalExpenses?: number | null
  costPerLitre?: number | null
  productPrice?: number | null
  landingCost?: number | null
  rate?: number | string | null
  margin?: number | null
  marginValue?: number | null
  costed?: boolean
}

export interface CostingBatch {
  code: string
  depot?: string | null
  pfiNumber?: string | null
  rows: CostingRow[]
  litres: number
  expenses: number
  marginValue: number
  avgMargin: number | null
  uncosted: number
}

export interface CostingMeta {
  /** What the filters were set to, so the file says what it is a view of. */
  scope: string
  trucks: number
  expenses: number
  marginValue: number
  avgMargin: number | null
}

const n = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const x = Number(v)
  return Number.isFinite(x) ? x : null
}

const stamp = () => format(new Date(), 'yyyyMMdd-HHmm')

/** One column's raw value off a row, without casting the row itself. */
const at = (r: CostingRow, key: string): unknown => (r as unknown as Record<string, unknown>)[key]

/** The columns, declared once — the sheet, the PDF and the totals share them. */
const COLUMNS = [
  { key: 'truckNumber', label: 'Truck', width: 14, money: false },
  { key: 'quantityAllocated', label: 'Loaded', width: 12, money: false, qty: true },
  { key: 'agoLitres', label: 'AGO (L)', width: 10, money: false, qty: true },
  { key: 'agoPrice', label: 'AGO price', width: 12, money: true },
  { key: 'agoValue', label: 'AGO value', width: 14, money: true },
  { key: 'feedingAllowance', label: 'Feeding', width: 13, money: true },
  { key: 'totalExpenses', label: 'Total expenses', width: 15, money: true },
  { key: 'costPerLitre', label: 'Cost / litre', width: 12, money: true },
  { key: 'productPrice', label: 'Product price', width: 13, money: true },
  { key: 'landingCost', label: 'Landing cost', width: 13, money: true },
  { key: 'rate', label: 'Rate sold', width: 12, money: true },
  { key: 'margin', label: 'Margin / litre', width: 13, money: true },
  { key: 'marginValue', label: 'Margin on load', width: 16, money: true },
] as const

// ── Excel ──────────────────────────────────────────────────────────────────

export async function exportCostingWorkbook(batches: CostingBatch[], meta: CostingMeta) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Soroman System'
  wb.created = new Date()

  const ws = wb.addWorksheet('Delivery costing', {
    views: [{ state: 'frozen', ySplit: 4 }],
  })
  const lastCol = COLUMNS.length

  let row = writeTitleBlock(ws, 1, {
    title: 'Delivery costing',
    subtitle: `${meta.scope}   ·   Generated ${format(new Date(), 'd MMM yyyy, HH:mm')}`,
    columnSpan: lastCol,
  })
  row += 1

  for (const batch of batches) {
    /**
     * The batch heading carries its own totals.
     *
     * A reader scrolling a long sheet loses the summary rows at the top, and
     * the figure they want at that moment is this batch's — not the company's.
     */
    const head = ws.getRow(row)
    head.getCell(1).value = batch.code
    head.getCell(2).value = [batch.depot, batch.pfiNumber].filter(Boolean).join('  ·  ')
    head.getCell(7).value = batch.expenses || null
    head.getCell(12).value = batch.avgMargin
    head.getCell(13).value = batch.marginValue || null
    for (let c = 1; c <= lastCol; c++) {
      const cell = head.getCell(c)
      cell.font = { bold: true, color: { argb: XL.white }, size: 10 }
      cell.fill = HEADER_FILL
      cell.border = ALL_BORDERS
      if (c >= 7) cell.numFmt = NGN
      if (c > 1) cell.alignment = { horizontal: c >= 7 ? 'right' : 'left' }
    }
    ws.mergeCells(row, 2, row, 6)
    row++

    const header = ws.getRow(row)
    COLUMNS.forEach((c, i) => {
      const cell = header.getCell(i + 1)
      cell.value = c.label
      cell.font = { bold: true, color: { argb: XL.ink }, size: 9 }
      cell.fill = SUMMARY_FILL
      cell.border = ALL_BORDERS
      cell.alignment = { horizontal: i === 0 ? 'left' : 'right', wrapText: true }
    })
    row++

    batch.rows.forEach((r, idx) => {
      const line = ws.getRow(row)
      COLUMNS.forEach((c, i) => {
        const cell = line.getCell(i + 1)
        const raw = at(r, c.key)
        cell.value = c.key === 'truckNumber' ? String(raw ?? '') : n(raw)
        cell.border = ALL_BORDERS
        // Banding, faint enough to ignore and present enough to follow a row
        // across thirteen columns.
        if (idx % 2 === 1) cell.fill = BAND_FILL
        if (c.money) cell.numFmt = NGN
        else if ('qty' in c && c.qty) cell.numFmt = COUNT
        cell.alignment = { horizontal: i === 0 ? 'left' : 'right' }
      })

      /**
       * A margin that could not be worked out is left EMPTY, not zero.
       *
       * Zero in a summable column is a claim: it says this trip broke even.
       * Blank says nobody has costed it, which is what is true — and it keeps
       * the column's average honest, since Excel skips blanks and counts
       * zeros.
       */
      if (r.margin == null) {
        line.getCell(12).value = null
        line.getCell(13).value = null
        line.getCell(12).note = 'Not costed — needs the product price or a selling rate'
      } else {
        const tone = r.margin >= 0 ? XL.gain : XL.loss
        line.getCell(12).font = { color: { argb: tone }, bold: true }
        line.getCell(13).font = { color: { argb: tone }, bold: true }
      }
      row++
    })

    // The batch's own total line, closing the block.
    const tot = ws.getRow(row)
    tot.getCell(1).value = `${batch.rows.length} truck${batch.rows.length === 1 ? '' : 's'}`
    tot.getCell(2).value = batch.litres || null
    tot.getCell(7).value = batch.expenses || null
    tot.getCell(12).value = batch.avgMargin
    tot.getCell(13).value = batch.marginValue || null
    for (let c = 1; c <= lastCol; c++) {
      const cell = tot.getCell(c)
      cell.font = { bold: true }
      cell.fill = SUBROW_FILL
      cell.border = TOTAL_BORDERS
      if (c === 2) cell.numFmt = COUNT
      if (c >= 7) cell.numFmt = NGN
      cell.alignment = { horizontal: c === 1 ? 'left' : 'right' }
    }
    if (batch.uncosted > 0) {
      tot.getCell(1).value = `${batch.rows.length} trucks · ${batch.uncosted} not costed`
    }
    row += 2
  }

  // The grand total, in the brand rather than the neutral tint.
  const grand = ws.getRow(row)
  grand.getCell(1).value = 'All batches'
  grand.getCell(2).value = meta.trucks
  grand.getCell(7).value = meta.expenses || null
  grand.getCell(12).value = meta.avgMargin
  grand.getCell(13).value = meta.marginValue || null
  for (let c = 1; c <= lastCol; c++) {
    const cell = grand.getCell(c)
    cell.font = { bold: true, size: 10 }
    cell.fill = fill(XL.grandTotalTint)
    cell.border = TOTAL_BORDERS
    if (c === 2) cell.numFmt = COUNT
    if (c >= 7) cell.numFmt = NGN
    cell.alignment = { horizontal: c === 1 ? 'left' : 'right' }
  }

  COLUMNS.forEach((c, i) => { ws.getColumn(i + 1).width = c.width })

  const buffer = await wb.xlsx.writeBuffer()
  triggerDownload(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    `Soroman_Delivery_Costing_${stamp()}.xlsx`,
  )
}

// ── PDF ────────────────────────────────────────────────────────────────────

export async function exportCostingPdf(batches: CostingBatch[], meta: CostingMeta) {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ])

  const doc = new jsPDF({ orientation: 'landscape' })

  /**
   * Satoshi, awaited before a character is drawn.
   *
   * jsPDF resolves a font at draw time, so registering it later leaves the
   * header in Helvetica and the tables in Satoshi. If the face will not load
   * the document still prints, in Helvetica, keeping the ₦ sign — only Satoshi
   * lacks that glyph.
   */
  const satoshi = await applySatoshi(doc)
  const naira = satoshi ? pdfNairaIso : pdfNaira

  /**
   * autotable picks its own font and ignores the document's, so the face has
   * to be handed to every table. Without it the headings come out in Satoshi
   * and the tables beneath in Helvetica — the tell that makes a generated
   * document look assembled rather than designed.
   */
  const face = satoshi ? { font: 'Satoshi' } : {}

  let y = drawPdfHeader(doc, 'Delivery Costing', meta.scope)

  const cell = (v: number | null) => (v == null ? '—' : naira(v))
  const count = (v: number | null) => (v == null ? '—' : v.toLocaleString('en-NG'))

  for (const batch of batches) {
    autoTable(doc, {
      startY: y,
      // The batch line, as its own one-row table so it cannot be split from
      // the trucks beneath it by a page break.
      head: [[
        batch.code,
        [batch.depot, batch.pfiNumber].filter(Boolean).join('  ·  '),
        `${batch.rows.length} truck${batch.rows.length === 1 ? '' : 's'}`,
        count(batch.litres),
        cell(batch.expenses),
        batch.avgMargin == null ? '—' : `${naira(batch.avgMargin)}/L`,
        cell(batch.marginValue),
      ]],
      body: [],
      theme: 'grid',
      headStyles: { ...pdfStyles.head, ...face },
      columnStyles: {
        2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' },
        5: { halign: 'right' }, 6: { halign: 'right' },
      },
      margin: { left: 10, right: 10 },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = (doc as any).lastAutoTable.finalY

    autoTable(doc, {
      startY: y,
      head: [COLUMNS.map((c) => c.label)],
      body: batch.rows.map((r) => COLUMNS.map((c) => {
        if (c.key === 'truckNumber') return r.truckNumber || '—'
        const v = n(at(r, c.key))
        if (v == null) return '—'
        return c.money ? naira(v) : count(v)
      })),
      foot: [[
        batch.uncosted > 0 ? `${batch.rows.length} trucks · ${batch.uncosted} not costed` : `${batch.rows.length} trucks`,
        count(batch.litres), '', '', '', '',
        cell(batch.expenses), '', '', '', '',
        batch.avgMargin == null ? '—' : naira(batch.avgMargin),
        cell(batch.marginValue),
      ]],
      theme: 'grid',
      styles: { ...pdfStyles.body, ...face },
      headStyles: { ...pdfStyles.head, ...face, fillColor: PDF.headerNavySoft },
      footStyles: { ...pdfStyles.foot, ...face },
      alternateRowStyles: { fillColor: PDF.bandTint },
      columnStyles: Object.fromEntries(
        COLUMNS.map((c, i) => [i, { halign: i === 0 ? 'left' : 'right' }]),
      ),
      // Red for a loss, green for a gain — on the margin columns only, since
      // colouring every figure would make none of them mean anything.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      didParseCell: (data: any) => {
        if (data.section !== 'body') return
        if (data.column.index !== 11 && data.column.index !== 12) return
        const m = batch.rows[data.row.index]?.margin
        if (m == null) return
        data.cell.styles.textColor = m >= 0 ? PDF.gain : PDF.loss
        data.cell.styles.fontStyle = 'bold'
      },
      margin: { left: 10, right: 10 },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = (doc as any).lastAutoTable.finalY + 6
  }

  autoTable(doc, {
    startY: y,
    head: [['All batches', 'Trucks', 'Trip expenses', 'Margin / litre', 'Margin earned']],
    body: [[
      '', meta.trucks.toLocaleString('en-NG'), cell(meta.expenses),
      meta.avgMargin == null ? '—' : naira(meta.avgMargin), cell(meta.marginValue),
    ]],
    theme: 'grid',
    styles: { ...pdfStyles.body, ...face },
    headStyles: { ...pdfStyles.head, ...face },
    bodyStyles: { fillColor: PDF.grandTotalTint, fontStyle: 'bold' },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
    margin: { left: 10, right: 10 },
  })

  drawPdfFooters(doc, 'A blank margin means the trip has no product price or no selling rate recorded — not that it broke even.')
  doc.save(`Soroman_Delivery_Costing_${stamp()}.pdf`)
}
