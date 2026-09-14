import api from '#/lib/api/http'
import { ALL_TYPES, REPORTS, allFields, reportValue } from '#/routes/my-report/-report-config'
import { naira } from '#/routes/pfi/-pfi-utils'
import {
  variancesOn, checkSourceFor, SYSTEM_CHECKED_FIELDS,
  type DailyReportRow, type SystemActuals,
} from './-hub-data'

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
  /** Live system figures for reports with no snapshot — see checkSourceFor. */
  live?: Map<string, SystemActuals>,
): Promise<{ buffer: ArrayBuffer; filename: string }> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Soroman System'
  wb.created = new Date()

  /**
   * One sheet per ROLE, mirroring the page.
   *
   * It used to be one sheet per location, which put a sales sheet, a security
   * sheet and a commissions sheet side by side and scattered each role across
   * the workbook. Comparing one sales manager against another meant opening
   * six tabs. A role to a tab, ordered by batch, puts the outlier beside its
   * peers — and it means a tab can be sent to the person who owns it.
   *
   * Location becomes a column, so nothing is lost by not being a tab.
   */
  const usedNames = new Set<string>()

  for (const type of ALL_TYPES) {
    const typeRows = rows
      .filter((r) => r.reportType === type)
      .sort((a, b) => (
        (a.pfiNumber || '').localeCompare(b.pfiNumber || '')
          || (a.location || '').localeCompare(b.location || '')
      ))
    if (typeRows.length === 0) continue

    const def = REPORTS[type]
    const fields = allFields(def)
    const ws = wb.addWorksheet(sheetName(def.roleLabel, usedNames))

    /**
     * Each figure the system can speak to is followed by its own column, the
     * same pairing the page shows. Two numbers in one cell read as a figure
     * with a footnote; side by side they read as a comparison.
     */
    const columns: Array<{ label: string; field?: typeof fields[number]; system?: boolean }> = [
      { label: 'PFI' }, { label: 'Location' }, { label: 'Submitted by' }, { label: 'Status' },
    ]
    for (const f of fields) {
      columns.push({ label: f.label, field: f })
      if (SYSTEM_CHECKED_FIELDS.has(f.key)) {
        columns.push({ label: `${f.label} (system)`, field: f, system: true })
      }
    }
    columns.push({ label: 'System check' })
    const lastCol = columns.length

    ws.mergeCells(1, 1, 1, lastCol)
    const title = ws.getCell(1, 1)
    title.value = `Soroman — ${def.roleLabel} · ${opts.date}`
    title.font = { bold: true, size: 13 }

    ws.mergeCells(2, 1, 2, lastCol)
    const meta = ws.getCell(2, 1)
    meta.value = [
      `${typeRows.length} report${typeRows.length === 1 ? '' : 's'}`,
      opts.location !== 'all' ? `Location filter: ${opts.location}` : '',
      opts.pfi !== 'all' ? `PFI filter: ${opts.pfi}` : '',
    ].filter(Boolean).join('   ·   ')
    meta.font = { size: 9, color: { argb: 'FF6B7280' } }

    const headerRow = ws.getRow(4)
    headerRow.values = columns.map((c) => c.label)
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } }

    let cursor = 5
    for (const r of typeRows) {
      const src = checkSourceFor(r, live)
      const row = ws.getRow(cursor)
      row.values = columns.map((c) => {
        if (!c.field) {
          switch (c.label) {
            case 'PFI': return r.pfiNumber || ''
            case 'Location': return r.location?.trim() || ''
            case 'Submitted by': return r.submittedByName || ''
            case 'Status': return STATUS_LABEL[r.status] || r.status
            default: return systemCheck(r, fields, live)
          }
        }
        const f = c.field
        if (c.system) {
          const sv = src?.fields[f.key]
          return sv == null ? null : sv
        }
        // reportValue, not r[f.key]: the commission report's two outstanding
        // figures postdate the rows that still have to state them, and those
        // work out from what the row does carry.
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
              .map((c2) => `${c2.name || '—'} (${Number(c2.litres).toLocaleString()}L)`).join(', ')
            : null
        }
        if (v == null || v === '') return null
        return f.type === 'money' || f.type === 'number' ? Number(v) : String(v)
      })

      // Real numbers with a cell format, on the filed figure and the system's
      // alike — a System column that cannot be subtracted from the one beside
      // it is not much of a comparison.
      columns.forEach((c, i) => {
        const t = c.field?.type
        if (t !== 'money' && t !== 'number') return
        row.getCell(i + 1).numFmt = t === 'money' ? NGN : QTY
      })
      cursor++
    }

    ws.getColumn(1).width = 26
    ws.getColumn(2).width = 24
    ws.getColumn(3).width = 22
    ws.getColumn(4).width = 12
    for (let i = 5; i <= lastCol; i++) {
      const c = columns[i - 1]
      ws.getColumn(i).width = c.field?.key === 'remarks' ? 36 : c.system ? 16 : 20
    }
    ws.getColumn(lastCol).width = 52
    ws.views = [{ state: 'frozen', ySplit: 4 }]
  }

  // Every role empty means nothing was filed; a workbook with no sheets cannot
  // be written at all, so say so rather than throwing from ExcelJS.
  if (wb.worksheets.length === 0) {
    const ws = wb.addWorksheet('No reports')
    ws.getCell(1, 1).value = `No reports filed for ${opts.date}`
  }

  const buffer = await wb.xlsx.writeBuffer()
  return { buffer, filename: `Soroman_Reports_${opts.date}.xlsx` }
}


/**
 * The variance sentence for one filed report.
 *
 * Three states, and they are not two: figures that disagree, figures that
 * agree, and a report filed before the system began keeping its own copy.
 * That last one is not agreement — nobody checked — and a blank cell would
 * read as clean, so it says so.
 */
function systemCheck(
  r: DailyReportRow,
  fields: Array<{ key: string; label: string; type?: string }>,
  live?: Map<string, SystemActuals>,
): string {
  const src = checkSourceFor(r, live)
  if (!src) return 'Not checked'
  const off = variancesOn(src, fields.map((f) => f.key), (k) => reportValue(r, k))
  const when = src.when === 'now' ? ' (checked now, not on the day)' : ''
  if (!off.length) return `Agrees with the system${when}`
  return off
    .map((x) => {
      const label = fields.find((f) => f.key === x.key)?.label ?? x.key
      const dir = x.off.diff > 0 ? 'over' : 'under'
      return `${label}: filed ${x.off.typed.toLocaleString()} vs system ${x.off.system.toLocaleString()} (${dir} by ${Math.abs(x.off.diff).toLocaleString()})`
    })
    .join('; ') + when
}

/** Download button: build the workbook, hand it straight to the browser. */
export async function exportReportsHub(
  rows: DailyReportRow[],
  opts: { date: string; location: string; pfi: string },
  live?: Map<string, SystemActuals>,
) {
  const { buffer, filename } = await buildReportsHubWorkbook(rows, opts, live)
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
  rows: DailyReportRow[],
  opts: { date: string; location: string; pfi: string },
  recipients: string[],
  live?: Map<string, SystemActuals>,
): Promise<{ message: string }> {
  // The workbook goes up with it, so the email carries the very report on
  // screen — the same filters, the same rows, the same file the Download
  // button gives. The server attaches it beside the readable summary; the
  // summary is for reading on a phone, the workbook for working at a desk.
  const { buffer, filename } = await buildReportsHubWorkbook(rows, opts, live)
  const attachmentBase64 = await blobToBase64(new Blob([buffer]))

  const res = await api.post('/daily-reports/email', {
    recipients,
    reportDate: opts.date,
    location: opts.location,
    pfi: opts.pfi,
    reportCount: rows.length,
    filename,
    attachmentBase64,
  })
  return res.data as { message: string }
}

/** Base64 without the data-URL prefix, which is what the mail API wants. */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

// WhatsApp is switched off — the day goes out by email, which now carries the
// workbook itself. Line-commented rather than deleted: the server route and
// template are untouched, so this is one button away from returning.
//
//
// /**
//  * The day's trading as a WhatsApp message.
//  *
//  * No attachment and no workbook — this is read on a phone, where a spreadsheet
//  * is a file nobody opens. The server builds the text, so the message says the
//  * same thing however it was triggered.
//  */
// export interface WhatsappReportResult {
//   message: string
//   data?: {
//     preview?: boolean
//     channel?: 'template' | 'text'
//     templateName?: string | null
//     /** Resolved {{1}}, {{2}}, … in order. Empty when sending as plain text. */
//     parameters?: string[]
//     sent: string[]
//     failed: Array<{ to: string; error: string }>
//     skipped: string[]
//     body: string
//   }
// }
//
// export async function whatsappReportsHub(
//   opts: { date: string },
//   recipients: string[],
//   /**
//    * Resolve everything and send nothing.
//    *
//    * A template send fails outright when the parameter count does not match the
//    * body Meta approved, and the error arrives as an opaque code per recipient.
//    * Seeing the parameters first turns that into a comparison.
//    */
//   preview = false,
// ): Promise<WhatsappReportResult> {
//   const res = await api.post('/daily-reports/whatsapp', {
//     recipients,
//     reportDate: opts.date,
//     ...(preview ? { preview: true } : {}),
//   })
//   return res.data
// }
