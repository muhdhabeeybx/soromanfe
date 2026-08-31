import { format } from 'date-fns'
import api from '#/lib/api/http'
import { ALL_TYPES, REPORTS, allFields, reportValue } from '#/routes/my-report/-report-config'
import { naira } from '#/routes/pfi/-pfi-utils'
import type { DailyReportRow } from './-hub-data'

/**
 * Real numbers with a cell format, never pre-formatted strings — a column
 * that looks like money but is text cannot be summed, and summing a column
 * is the first thing anyone does with one of these sheets.
 */
const NGN = '₦#,##0.00;[Red]-₦#,##0.00'
const QTY = '#,##0'

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

const STATUS_LABEL: Record<string, string> = {
  submitted: 'Submitted',
  approved: 'Approved',
  rejected: 'Rejected',
}

/** Excel worksheet names: 31 chars, none of `\ / * ? : [ ]`, unique per workbook. */
function sheetName(location: string, used: Set<string>) {
  const base = location.replace(/[\\/*?:[\]]/g, '').slice(0, 31) || 'Unknown'
  let name = base
  let i = 2
  while (used.has(name)) {
    name = `${base.slice(0, 28)}~${i++}`
  }
  used.add(name)
  return name
}

/**
 * One workbook, one sheet per location — mirrors the on-screen grouping so a
 * reader can cross-check a sheet against the page it came from. Each sheet
 * stacks a coloured banner + header + rows per role, since the five report
 * types share no common column shape.
 *
 * Returns the raw buffer rather than triggering anything itself, so the same
 * workbook can be downloaded or emailed without building it twice.
 */
export async function buildReportsHubWorkbook(
  rows: DailyReportRow[],
  opts: { date: string; location: string; pfi: string },
): Promise<{ buffer: ArrayBuffer; filename: string }> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Soroman System'
  wb.created = new Date()

  const byLocation = new Map<string, DailyReportRow[]>()
  for (const r of rows) {
    const loc = r.location?.trim() || 'Unknown'
    if (!byLocation.has(loc)) byLocation.set(loc, [])
    byLocation.get(loc)!.push(r)
  }
  const locations = [...byLocation.keys()].sort((a, b) =>
    a === 'Unknown' ? 1 : b === 'Unknown' ? -1 : a.localeCompare(b),
  )

  // Widest field set across the five types, so every sheet's columns are wide
  // enough for whichever role's block is currently occupying them — column
  // width is a sheet property, but each role's header row redraws its own
  // labels into the same columns.
  const maxFields = Math.max(...ALL_TYPES.map((t) => allFields(REPORTS[t]).length))
  const usedNames = new Set<string>()

  for (const loc of locations) {
    const ws = wb.addWorksheet(sheetName(loc, usedNames))
    const lastCol = 3 + maxFields

    ws.mergeCells(1, 1, 1, lastCol)
    const title = ws.getCell(1, 1)
    title.value = `Soroman — Staff Reports · ${loc}`
    title.font = { bold: true, size: 13 }

    ws.mergeCells(2, 1, 2, lastCol)
    const meta = ws.getCell(2, 1)
    const filters = [
      `Date: ${opts.date}`,
      opts.location !== 'all' ? `Location filter: ${opts.location}` : '',
      opts.pfi !== 'all' ? `PFI filter: ${opts.pfi}` : '',
    ]
      .filter(Boolean)
      .join(' · ')
    meta.value = `${filters} · Generated ${format(new Date(), 'd MMM yyyy, HH:mm')}`
    meta.font = { italic: true, size: 9, color: { argb: 'FF666666' } }

    let cursor = 4
    const locRows = byLocation.get(loc)!

    for (const type of ALL_TYPES) {
      const def = REPORTS[type]
      const typeRows = locRows.filter((r) => r.reportType === type)
      if (typeRows.length === 0) continue

      const fields = allFields(def)
      const headers = ['PFI', 'Submitted by', 'Status', ...fields.map((f) => f.label)]

      ws.mergeCells(cursor, 1, cursor, lastCol)
      const banner = ws.getCell(cursor, 1)
      banner.value = `${def.roleLabel} (${typeRows.length})`
      banner.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      banner.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${def.color}` } }
      cursor++

      const headerRow = ws.getRow(cursor)
      headerRow.values = headers
      headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } }
      cursor++

      for (const r of typeRows) {
        const row = ws.getRow(cursor)
        row.values = [
          r.pfiNumber || '',
          r.submittedByName || '',
          STATUS_LABEL[r.status] || r.status,
          ...fields.map((f) => {
            // reportValue, not r[f.key]: the commission report's two
            // outstanding figures postdate the rows that still have to state
            // them, and those work out from what the row does carry.
            const v = reportValue(r, f.key)
            if (f.type === 'priceBands') {
              return Array.isArray(v) && v.length
                ? (v as Array<{ price: unknown; litres: unknown }>)
                  .map((b) => `${naira(Number(b.price))}×${Number(b.litres).toLocaleString()}L`).join('; ')
                : null
            }
            if (f.type === 'topCustomers') {
              return Array.isArray(v) && v.length
                ? (v as Array<{ name?: string; litres: unknown }>)
                  .map((c) => `${c.name || '—'} (${Number(c.litres).toLocaleString()}L)`).join(', ')
                : null
            }
            if (v == null || v === '') return null
            return f.type === 'money' || f.type === 'number' ? Number(v) : String(v)
          }),
        ]
        fields.forEach((f, i) => {
          if (f.type !== 'money' && f.type !== 'number') return
          row.getCell(4 + i).numFmt = f.type === 'money' ? NGN : QTY
        })
        cursor++
      }
      cursor += 2 // blank row between role blocks
    }

    ws.getColumn(1).width = 18
    ws.getColumn(2).width = 22
    ws.getColumn(3).width = 12
    for (let i = 4; i <= lastCol; i++) ws.getColumn(i).width = 20
    // Remarks reads better wide than wrapped across a narrow column.
    for (const type of ALL_TYPES) {
      const idx = allFields(REPORTS[type]).findIndex((f) => f.key === 'remarks')
      if (idx >= 0) ws.getColumn(4 + idx).width = 36
    }
  }

  const buffer = await wb.xlsx.writeBuffer()
  return { buffer, filename: `Soroman_Reports_${opts.date}.xlsx` }
}

/** Download button: build the workbook, hand it straight to the browser. */
export async function exportReportsHub(
  rows: DailyReportRow[],
  opts: { date: string; location: string; pfi: string },
) {
  const { buffer, filename } = await buildReportsHubWorkbook(rows, opts)
  triggerDownload(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    filename,
  )
}

/**
 * "Email report" button: the server builds and sends the readable summary for
 * the date, to whoever was just typed in.
 *
 * No workbook goes up with it. This used to base64 the whole spreadsheet into
 * the request body, which the server then discarded — the email has always
 * been the summary, and the summary is what it is meant to be. The xlsx is for
 * the operator who wants to work the numbers, and "Download report" is right
 * there for that.
 */
export async function emailReportsHub(
  opts: { date: string; location: string; pfi: string },
  recipients: string[],
): Promise<{ message: string }> {
  const res = await api.post('/daily-reports/email', {
    recipients,
    reportDate: opts.date,
    location: opts.location,
    pfi: opts.pfi,
  })
  return res.data as { message: string }
}
