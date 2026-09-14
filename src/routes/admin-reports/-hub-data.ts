import { useQueries } from '@tanstack/react-query'
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
  /** Null when the batch on the report could not be resolved — see below. */
  fields: Record<string, number> | null
  /** Set when a named batch did not resolve, so nothing may be compared. */
  unresolvedPfi?: string
}

/**
 * The field keys the system can speak to at all.
 *
 * Everything else on a report — remarks, price bands, a named customer — is
 * the filer's own observation with nothing in the database to check it
 * against, and a column headed "System" beside one would imply otherwise.
 */
export const SYSTEM_CHECKED_FIELDS = new Set([
  'orderCount', 'customerCount', 'litresSold', 'receivedStock',
  'totalSalesAmount', 'avgPrice', 'truckCount', 'trucksEntered', 'trucksLoaded',
  'fundsReceived', 'commissionDue', 'amountPaid',
])

export function actualsOf(r: DailyReportRow): SystemActuals | null {
  const a = r.systemActuals as SystemActuals | null | undefined
  return a && typeof a === 'object' && a.fields ? a : null
}

/**
 * The figures to check a report against, and when they were taken.
 *
 * Two sources, and the difference is worth carrying rather than hiding:
 *
 *   'day' — the snapshot stored on the report when it was submitted. The real
 *           answer, because it cannot drift as orders are cancelled and
 *           payments rematched.
 *   'now' — a live read, for every report filed before snapshots existed.
 *           Still the right comparison to show, since the alternative is a
 *           page full of "unchecked" that nobody can act on, but it is
 *           checking today's book against an older sheet and is labelled so.
 */
export type CheckSource = { fields: Record<string, number>; when: 'day' | 'now' } | null

export function checkSourceFor(
  r: DailyReportRow,
  live?: Map<string, SystemActuals>,
): CheckSource {
  const stored = actualsOf(r)
  if (stored?.fields) return { fields: stored.fields, when: 'day' }

  /**
   * A report with no batch on it has nothing to be checked against.
   *
   * It must NOT fall through to a company-wide read: every such report would
   * then be compared to the same whole-day figure, so five locations would all
   * read "system 36" and the comparison would quietly become a lie. Unchecked
   * is the honest answer.
   */
  const key = (r.pfiNumber || '').trim().toUpperCase()
  if (!key) return null

  const l = live?.get(key)
  return l?.fields ? { fields: l.fields, when: 'now' } : null
}

/** How far one stated figure sits from the system's own, or null if it agrees
 *  (or there is nothing to check it against). */
export function varianceOf(src: CheckSource, key: string, typed: unknown) {
  if (!src) return null
  return variance(typed == null ? '' : String(typed), src.fields[key])
}

/** Every figure on one report that disagrees, worst first — the row summary. */
export function variancesOn(src: CheckSource, keys: string[], valueOf: (k: string) => unknown) {
  return keys
    .map((k) => ({ key: k, off: varianceOf(src, k, valueOf(k)) }))
    .filter((x): x is { key: string; off: NonNullable<ReturnType<typeof varianceOf>> } => !!x.off)
    .sort((a, b) => Math.abs(b.off.diff) - Math.abs(a.off.diff))
}

/**
 * A live system read per PFI for one date.
 *
 * One request per distinct batch on the page, not per report: several roles
 * file against the same batch on the same day, and they must all be checked
 * against the same figures or the Hub would report a variance that depends on
 * who is reading it.
 *
 * Keyed by UPPERCASED PFI NUMBER because that is what a filed report stores —
 * it holds the batch's name as text, not its id.
 */
export function useLiveActuals(date: string, pfiNumbers: string[]) {
  return useQueries({
    queries: pfiNumbers.map((pfiNumber) => ({
      queryKey: ['daily-report-actuals', date, 'by-number', pfiNumber],
      queryFn: async (): Promise<SystemActuals> => {
        const res = await api.get('/daily-reports/actuals', { params: { date, pfiNumber } })
        return res.data.data.actuals as SystemActuals
      },
      enabled: !!date && !!pfiNumber,
      staleTime: 60_000,
    })),
    // `combine` rather than a useMemo over the results array: the array is new
    // every render, so memoising on it would rebuild the Map each time and
    // re-run every table's own memo underneath. Query holds this one stable
    // until the data actually changes.
    combine: (results) => {
      const map = new Map<string, SystemActuals>()
      results.forEach((r, i) => {
        // A batch that did not resolve answers with null fields; storing it
        // would present nothing as something.
        if (r.data?.fields) map.set(pfiNumbers[i].trim().toUpperCase(), r.data)
      })
      return map
    },
  })
}
