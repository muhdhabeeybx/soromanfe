import api from '#/lib/api/http'
import type { DailyReportStatus, ReportType } from '#/routes/my-report/-report-config'
import { variance } from '#/routes/my-report/-report-autofill'

export type { DailyReportStatus }

/** A row from `/daily-reports`. Only the fields every view of this page
 * touches by name are typed; role-specific figures are read by field key
 * off the index signature, driven by each type's own field list. */
export type DailyReportRow = {
  id: number
  reportType: ReportType
  reportDate: string
  location: string
  pfiNumber: string
  submittedByName: string
  status: DailyReportStatus
  reviewedByName: string | null
  reviewComment: string | null
  [key: string]: unknown
}

const PAGE_LIMIT = 100

/**
 * Every report filed on one date, across every location and role.
 *
 * The server caps a page at 100 and this asks for every page — a busy day
 * across several locations can outgrow one page, and the Hub needs the whole
 * day to group and total correctly, not just whatever fit in the first 100.
 */
export async function fetchDailyReportsForDate(date: string): Promise<DailyReportRow[]> {
  const all: DailyReportRow[] = []
  let page = 1
  while (true) {
    const res = await api.get('/daily-reports', {
      params: { dateFrom: date, dateTo: date, page, limit: PAGE_LIMIT, sort: 'location', order: 'asc' },
    })
    const { reports, pagination } = res.data.data as {
      reports: DailyReportRow[]
      pagination?: { pages?: number }
    }
    all.push(...reports)
    if (!pagination?.pages || page >= pagination.pages || reports.length < PAGE_LIMIT) break
    page++
  }
  return all
}

/**
 * What the system held for this report's PFI and date, captured at the moment
 * it was submitted.
 *
 * Captured rather than recomputed on read: orders get cancelled, payments
 * rematched, batches reassigned, so a report opened in November recomputed
 * against today's book would show a variance that changes every time somebody
 * looks. The question the Hub answers is whether the sheet agreed with the
 * system ON THE DAY.
 *
 * Null on every report filed before the snapshot existed. That is "nobody
 * checked", not "it agreed" — the Hub must not render those as clean.
 */
export type SystemActuals = {
  date: string
  pfiId: number | null
  fields: Record<string, number>
}

export function actualsOf(r: DailyReportRow): SystemActuals | null {
  const a = r.systemActuals as SystemActuals | null | undefined
  return a && typeof a === 'object' && a.fields ? a : null
}

/** How far one stated figure sits from the system's own, or null if it agrees
 *  (or was never checked). */
export function varianceOf(r: DailyReportRow, key: string, typed: unknown) {
  const a = actualsOf(r)
  if (!a) return null
  return variance(typed == null ? '' : String(typed), a.fields[key])
}

/** Every figure on one report that disagrees, worst first — the row summary. */
export function variancesOn(r: DailyReportRow, keys: string[], valueOf: (k: string) => unknown) {
  return keys
    .map((k) => ({ key: k, off: varianceOf(r, k, valueOf(k)) }))
    .filter((x): x is { key: string; off: NonNullable<ReturnType<typeof varianceOf>> } => !!x.off)
    .sort((a, b) => Math.abs(b.off.diff) - Math.abs(a.off.diff))
}
