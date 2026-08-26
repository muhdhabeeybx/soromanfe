import { format } from 'date-fns'
import {
  officerName, gateDriver, gateQuantity, timeOnSite,
  type GateMovement, type GateTotals,
} from '#/lib/hooks/useGateMovements'
import {
  XL, QTY, COUNT, DATE_FMT, ALL_BORDERS, TOTAL_BORDERS, HEADER_FILL, SUMMARY_FILL,
  TOTAL_FILL, HEADER_FONT, TOTAL_FONT, ROW_HEIGHT,
  writeTitleBlock, pdfStyles, drawPdfHeader, drawPdfFooters, triggerDownload,
} from '#/lib/report-theme'

/**
 * The gate register, as a sheet and as a page.
 *
 * Both are built from the same column list and the same row values, so the
 * two documents cannot drift from each other or from the screen. Quantities
 * are written as real numbers with a cell format — a litres column that reads
 * like litres but is text cannot be summed, and summing it is the first thing
 * anyone does with this sheet.
 */

export interface GateReportFilters {
  periodLabel: string
  dateFrom: string
  dateTo: string
  locationName: string
  pfiNumber: string
  search: string
}

/** 12-hour clock throughout — this is read by people working a shift, not a log parser. */
const TIME_PATTERN = 'h:mm a'
const time = (iso: string | null) => (iso ? format(new Date(iso), TIME_PATTERN) : '—')
const day = (iso: string | null) => (iso ? format(new Date(iso), 'd MMM yyyy') : '—')

const COLUMNS: Array<{ header: string; key: string; width: number; fmt?: string }> = [
  { header: 'S/N', key: 'sn', width: 6 },
  { header: 'Date', key: 'date', width: 14 },
  { header: 'Location', key: 'location', width: 22 },
  { header: 'Truck No', key: 'truck', width: 16 },
  { header: 'Driver', key: 'driver', width: 20 },
  { header: 'Driver Phone', key: 'driverPhone', width: 16 },
  { header: 'Loader', key: 'loader', width: 18 },
  { header: 'Loader Phone', key: 'loaderPhone', width: 16 },
  { header: 'Gantry', key: 'gantry', width: 9 },
  { header: 'Quantity', key: 'qty', width: 13, fmt: QTY },
  { header: 'Product', key: 'product', width: 12 },
  { header: 'Order Ref', key: 'ref', width: 20 },
  { header: 'Company', key: 'company', width: 20 },
  { header: 'Customer', key: 'customer', width: 20 },
  { header: 'Customer Phone', key: 'customerPhone', width: 16 },
  { header: 'PFI', key: 'pfi', width: 26 },
  { header: 'Time In', key: 'timeIn', width: 12 },
  { header: 'Entered By', key: 'enteredBy', width: 20 },
  { header: 'Time Out', key: 'timeOut', width: 12 },
  { header: 'Exited By', key: 'exitedBy', width: 20 },
  { header: 'Time On Site', key: 'onSite', width: 13 },
  { header: 'Status', key: 'status', width: 14 },
]

export const GATE_COLUMNS = COLUMNS.map((c) => ({ header: c.header, key: c.key }))

/** Right-aligned on screen — the numeric ones. */
export const GATE_NUMERIC = new Set(['qty'])

export function gateRowValues(t: GateMovement, index: number) {
  const driver = gateDriver(t)
  return {
    sn: index + 1,
    date: day(t.enteredAt),
    location: t.depotName || '—',
    truck: t.truckNumber || `Truck ${t.truckIndex}`,
    driver: driver.name || '—',
    driverPhone: driver.phone || '—',
    loader: t.loaderName || '—',
    loaderPhone: t.loaderPhone || '—',
    gantry: t.gantry || '—',
    qty: gateQuantity(t),
    product: t.productName || '—',
    ref: t.orderNumber || '—',
    company: t.companyName || '—',
    customer: t.customerName || '—',
    customerPhone: t.customerPhone || '—',
    pfi: t.pfiNumber || '—',
    timeIn: time(t.enteredAt),
    enteredBy: officerName(t.enteredByFirstName, t.enteredBySurname) || '—',
    timeOut: time(t.exitedAt),
    exitedBy: officerName(t.exitedByFirstName, t.exitedBySurname) || '—',
    // A truck still inside has no duration yet, and saying so is the point of
    // the column — it is the list of what security still has on the yard.
    onSite: timeOnSite(t) || 'On site',
    status: t.exitedAt ? 'Cleared' : 'On site',
  }
}

function filename(filters: GateReportFilters, ext: string) {
  const scope =
    filters.locationName && filters.locationName !== 'All locations' ? filters.locationName : 'ALL'
  const span = filters.dateFrom === filters.dateTo ? filters.dateFrom : `${filters.dateFrom}_${filters.dateTo}`
  return `GATE-REPORT_${scope}_${span}.${ext}`.replace(/\s+/g, '-').toUpperCase()
}

/** The figures a shift is judged on, in the order they get asked about. */
function summaryPairs(totals: GateTotals): Array<[string, string | number, string?]> {
  return [
    ['Trucks Entered', totals.entered, COUNT],
    ['Trucks Exited', totals.exited, COUNT],
    ['Still On Site', totals.onSite, COUNT],
    ['Quantity Entered', totals.quantityEntered, QTY],
    ['Quantity Exited', totals.quantityExited, QTY],
  ]
}

export async function exportGateReportExcel(
  trucks: GateMovement[],
  totals: GateTotals,
  filters: GateReportFilters,
) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Soroman Energy'
  wb.created = new Date()
  const ws = wb.addWorksheet('Gate Register', {
    views: [{ state: 'frozen', ySplit: 0 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })
  ws.columns = COLUMNS.map((c) => ({ key: c.key, width: c.width }))

  let cursor = writeTitleBlock(ws, 1, {
    title: 'Gate Register',
    subtitle: [
      `Period: ${filters.periodLabel}`,
      `Location: ${filters.locationName}`,
      `PFI: ${filters.pfiNumber}`,
      filters.search ? `Search: ${filters.search}` : '',
    ].filter(Boolean).join('   ·   '),
    columnSpan: COLUMNS.length,
  })
  cursor += 1

  // Summary band first: a security report is read for its counts before
  // anybody looks at a single row.
  const sumRow = ws.getRow(cursor)
  summaryPairs(totals).forEach(([label], i) => {
    const cell = sumRow.getCell(i * 2 + 1)
    cell.value = label
    cell.font = { bold: true, size: 9 }
    cell.fill = SUMMARY_FILL
    cell.border = ALL_BORDERS
  })
  cursor++
  const valRow = ws.getRow(cursor)
  summaryPairs(totals).forEach(([, value, fmt], i) => {
    const cell = valRow.getCell(i * 2 + 1)
    cell.value = value
    if (fmt) cell.numFmt = fmt
    cell.font = TOTAL_FONT
    cell.fill = SUMMARY_FILL
    cell.border = ALL_BORDERS
  })
  cursor += 2

  const headerRow = ws.getRow(cursor)
  headerRow.values = Object.fromEntries(COLUMNS.map((c) => [c.key, c.header]))
  headerRow.height = ROW_HEIGHT.header
  for (const c of COLUMNS) {
    const cell = headerRow.getCell(c.key)
    cell.font = HEADER_FONT
    cell.fill = HEADER_FILL
    cell.border = ALL_BORDERS
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
  }
  // Everything above the header scrolls away; the header itself stays put.
  ws.views = [{ state: 'frozen', ySplit: cursor }]
  cursor++

  trucks.forEach((t, i) => {
    const row = ws.getRow(cursor)
    row.values = gateRowValues(t, i)
    row.height = ROW_HEIGHT.body
    for (const c of COLUMNS) {
      const cell = row.getCell(c.key)
      cell.border = ALL_BORDERS
      if (c.fmt) cell.numFmt = c.fmt
      // A truck still inside is the row an officer is looking for, so it is
      // the one row that is coloured.
      if (!t.exitedAt) cell.font = { color: { argb: XL.internal } }
    }
    if (row.getCell('date').value) row.getCell('date').numFmt = DATE_FMT
    cursor++
  })

  const totalRow = ws.getRow(cursor)
  totalRow.getCell('truck').value = `Total (${trucks.length})`
  totalRow.getCell('qty').value = totals.quantityEntered
  totalRow.getCell('qty').numFmt = QTY
  for (const c of COLUMNS) {
    const cell = totalRow.getCell(c.key)
    cell.font = TOTAL_FONT
    cell.fill = TOTAL_FILL
    cell.border = TOTAL_BORDERS
  }

  const buf = await wb.xlsx.writeBuffer()
  triggerDownload(
    new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    filename(filters, 'xlsx'),
  )
}

export async function exportGateReportPdf(
  trucks: GateMovement[],
  totals: GateTotals,
  filters: GateReportFilters,
) {
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default
  // Landscape: twenty-two columns will not read on a portrait page.
  const doc = new jsPDF({ orientation: 'landscape', format: 'a4' })

  let y = drawPdfHeader(
    doc,
    'Gate Register',
    [
      filters.periodLabel,
      filters.locationName,
      filters.pfiNumber !== 'All PFIs' ? filters.pfiNumber : '',
      filters.search ? `“${filters.search}”` : '',
    ].filter(Boolean).join('  ·  '),
  )

  autoTable(doc, {
    startY: y,
    head: [summaryPairs(totals).map(([label]) => label)],
    body: [summaryPairs(totals).map(([, v, fmt]) =>
      fmt === QTY ? `${Number(v).toLocaleString()} L` : Number(v).toLocaleString(),
    )],
    theme: 'grid',
    styles: { ...pdfStyles.body, halign: 'center' },
    headStyles: pdfStyles.head,
  })
  y = (doc as any).lastAutoTable.finalY + 6

  autoTable(doc, {
    startY: y,
    head: [COLUMNS.map((c) => c.header)],
    body: trucks.map((t, i) => {
      const v = gateRowValues(t, i) as Record<string, unknown>
      return COLUMNS.map((c) => (c.key === 'qty' ? Number(v.qty).toLocaleString() : String(v[c.key] ?? '—')))
    }),
    theme: 'grid',
    styles: { ...pdfStyles.body, fontSize: 6, cellPadding: 1.2 },
    headStyles: { ...pdfStyles.head, fontSize: 6 },
    // The still-on-site rows, marked the same way as in the workbook.
    didParseCell: (data: any) => {
      if (data.section !== 'body') return
      if (!trucks[data.row.index]?.exitedAt) data.cell.styles.textColor = [37, 99, 235]
    },
  })

  drawPdfFooters(doc, `${totals.entered} entered · ${totals.exited} exited · ${totals.onSite} still on site`)
  doc.save(filename(filters, 'pdf'))
}
