import { format, parseISO, startOfDay, endOfDay, startOfWeek, endOfWeek,
  startOfMonth, endOfMonth, startOfYear, endOfYear, subDays, isWithinInterval } from 'date-fns'
import type { DeliveryCustomer, DeliverySale } from '#/lib/types'

export const toNum = (v: string | number | undefined | null): number => {
  if (v === undefined || v === null || v === '') return 0
  const n = Number(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

export const fmt = (n: number): string =>
  `₦${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export const fmtQty = (n: number): string =>
  n.toLocaleString(undefined, { maximumFractionDigits: 0 })

export const formatWithCommas = (v: string): string => {
  const cleaned = v.replace(/[^0-9.]/g, '')
  const parts = cleaned.split('.')
  const intPart = (parts[0] || '').replace(/^0+(?=\d)/, '')
  const formatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  if (parts.length > 1) return `${formatted}.${parts[1]}`
  return formatted
}

export const stripCommas = (v: string): string => v.replace(/,/g, '')

export const normalizeText = (v: string | undefined | null): string =>
  (v || '').trim().toLowerCase()

export const isFillingStation = (c: DeliveryCustomer | undefined | null): boolean =>
  c?.customerType === 'filling_station'

export const normalizeCycleDate = (dateValue: string | undefined | null): string => {
  if (!dateValue) return ''
  const raw = String(dateValue).trim()
  if (!raw) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  try { return format(parseISO(raw), 'yyyy-MM-dd') } catch { return raw.split('T')[0] || raw }
}

export const getCycleKey = (truckNum: string, dateLoaded: string | undefined | null): string =>
  `${(truckNum || '').trim().toUpperCase()}||${normalizeCycleDate(dateLoaded)}`

/** The shape of a truck allocation, as far as matching sales to it needs. */
export interface LoadingRef {
  truckNumber?: string | null
  dateAllocated?: string | null
  allocationCode?: string | null
}

/**
 * The sales-ledger entries belonging to one truck allocation.
 *
 * A cycle is keyed on truck + load date, so that is the first rule. But an
 * allocation carrying no date — every row that came over from the old system
 * has an empty `date_allocated` — matched nothing under that rule alone, and
 * the screens that read a rate off these entries showed a dash on rows that
 * plainly had sales against them. When there is no date, the truck decides,
 * narrowed to the allocation code when both sides carry one so a truck's
 * June trip is never read as its July one.
 */
export const salesForLoading = (sales: DeliverySale[], loading: LoadingRef): DeliverySale[] => {
  const plate = (loading.truckNumber || '').trim().toUpperCase()
  if (!plate) return []

  const onTruck = sales.filter(s => (s.truckNumber || '').trim().toUpperCase() === plate)
  if (onTruck.length === 0) return []

  const loadDate = normalizeCycleDate(loading.dateAllocated)
  if (loadDate) return onTruck.filter(s => normalizeCycleDate(s.dateLoaded) === loadDate)

  const code = (loading.allocationCode || '').trim().toUpperCase()
  if (!code) return onTruck
  const sameCode = onTruck.filter(s => (s.allocationCode || '').trim().toUpperCase() === code)
  return sameCode.length > 0 ? sameCode : onTruck
}

/**
 * The rate a cycle sold at, read off its sales entries.
 *
 * The highest rate on the cycle rather than the first: partial entries are
 * often saved with the rate left at zero and filled in later, and the same
 * rule already decides the rate the sales ledger itself displays.
 */
export const rateFromSales = (sales: DeliverySale[]): number =>
  sales.reduce((mx, s) => Math.max(mx, toNum(s.rate)), 0)

export const safeFormatDate = (d: string | null | undefined, fmtStr = 'dd MMM yyyy'): string => {
  if (!d) return '—'
  try { return format(parseISO(d), fmtStr) } catch { return d.split('T')[0] || d }
}

export type TimePreset = 'today' | 'yesterday' | 'week' | 'month' | 'year' | 'all' | 'custom'

export const getPresetRange = (preset: TimePreset): { from: Date | null; to: Date | null } => {
  const now = new Date()
  switch (preset) {
    case 'today': return { from: startOfDay(now), to: endOfDay(now) }
    case 'yesterday': { const y = subDays(now, 1); return { from: startOfDay(y), to: endOfDay(y) } }
    case 'week': return { from: startOfWeek(now, { weekStartsOn: 1 }), to: endOfWeek(now, { weekStartsOn: 1 }) }
    case 'month': return { from: startOfMonth(now), to: endOfMonth(now) }
    case 'year': return { from: startOfYear(now), to: endOfYear(now) }
    case 'all': return { from: null, to: null }
    case 'custom': return { from: null, to: null }
  }
}

export const matchesDateRange = (
  dateStr: string | undefined | null,
  from: Date | null,
  to: Date | null,
): boolean => {
  if (!dateStr || (!from && !to)) return true
  try {
    const d = typeof dateStr === 'string' ? parseISO(dateStr) : new Date(dateStr)
    if (from && to) return isWithinInterval(d, { start: startOfDay(from), end: endOfDay(to) })
    if (from) return d >= startOfDay(from)
    if (to) return d <= endOfDay(to)
    return true
  } catch {
    return true
  }
}

export const CODE_PALETTE = [
  { row: 'bg-sky-50/60 border-l-sky-300', badge: 'bg-sky-100 text-sky-800 border-sky-200' },
  { row: 'bg-emerald-50/60 border-l-emerald-300', badge: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  { row: 'bg-orange-50/60 border-l-orange-300', badge: 'bg-orange-100 text-orange-800 border-orange-200' },
  { row: 'bg-violet-50/60 border-l-violet-300', badge: 'bg-violet-100 text-violet-800 border-violet-200' },
  { row: 'bg-pink-50/60 border-l-pink-300', badge: 'bg-pink-100 text-pink-800 border-pink-200' },
  { row: 'bg-amber-50/60 border-l-amber-300', badge: 'bg-amber-100 text-amber-800 border-amber-200' },
  { row: 'bg-teal-50/60 border-l-teal-300', badge: 'bg-teal-100 text-teal-800 border-teal-200' },
  { row: 'bg-indigo-50/60 border-l-indigo-300', badge: 'bg-indigo-100 text-indigo-800 border-indigo-200' },
]

export const getCodeTheme = (code: string) => {
  if (!code) return null
  let hash = 0
  for (let i = 0; i < code.length; i++) hash = (hash * 31 + code.charCodeAt(i)) >>> 0
  return CODE_PALETTE[hash % CODE_PALETTE.length]
}
