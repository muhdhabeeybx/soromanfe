import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format, subDays } from 'date-fns'
import { Loader2, Trash2, Pencil, Download, Plus, X, Eye, RotateCcw } from 'lucide-react'

import api from '#/lib/api/http'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { NumberInput } from '#/components/ui/number-input'
import { Label } from '#/components/ui/label'
import { Textarea } from '#/components/ui/textarea'
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '#/components/ui/table'
import { PageEmpty } from '#/components/PageEmpty'
import { StatusChip } from '#/components/ui/status-chip'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '#/components/ui/dialog'
import { MICRO, PANEL, PANEL_RAIL } from '#/lib/panel'
import { cn, getErrorMessage } from '#/lib/utils'
import { useToast } from '#/lib/hooks/useToast'
import { naira } from '#/routes/pfi/-pfi-utils'
import { NativeSelect } from '#/components/ui/native-select'
import { usePfiList, type PfiWithFinancials } from '#/lib/hooks/usePfis'
import { useBankAccounts } from '#/lib/hooks/useBankAccounts'
import {
  STATUS_TONE, allFields, derivedFor, reportValue, bandTotals, COMPANY_WIDE, REPORTS,
  type ReportDef, type FieldDef, type ReportType,
} from './-report-config'
import {
  useDayOrders, useTruckCounts, useYesterdayReport, usePfiDeposits,
  ordersForPfi, loadedOrders, suggestPriceBands, sumQuantity, countCustomers, topCustomersFrom,
} from './-report-autofill'

const PAGE_SIZE = 1000

/** A dash, not a zero: a figure the report never carried is missing, not nil,
 * and printing ₦0.00 under it is the difference between "no answer" and "no
 * money". */
const blank = (v: unknown) => v == null || v === '' || Number.isNaN(Number(v))
const money = (v: unknown) => (blank(v) ? '—' : naira(Number(v)))
const num = (v: unknown) => (blank(v) ? '—' : Number(v).toLocaleString())
/** A volume with the batch's own unit — "45,000 Litres", "160 kg". */
const withUnit = (v: unknown, unit: string) => (blank(v) ? '—' : `${num(v)}${unit ? ` ${unit}` : ''}`)

type Band = { price: string; litres: string }
type TopRow = { name: string; phone: string; litres: string }
const emptyTopRows = (): TopRow[] => Array.from({ length: 5 }, () => ({ name: '', phone: '', litres: '' }))

/** Empty string rather than 0, so an untouched number field stays blank.
 * The two table fields keep their own state; every other field, derived ones
 * included, lives here and is saved from here. */
const blankForm = (def: ReportDef) => {
  const out: Record<string, string> = {
    reportDate: format(new Date(), 'yyyy-MM-dd'),
    location: '',
    pfiNumber: '',
  }
  for (const f of allFields(def)) {
    if (f.type === 'priceBands' || f.type === 'topCustomers') continue
    out[f.key] = ''
  }
  return out
}

/**
 * One line of the form.
 *
 * A derived field is an ordinary input that happens to arrive filled in. It
 * follows the figures behind it until somebody types their own number, and
 * from then on it is theirs — with a way back to the worked-out value, which
 * is the only thing an override needs that a plain field does not.
 */
function Field({
  field, value, onChange, unit, overridden, suggestion, onRestore,
}: {
  field: FieldDef
  value: string
  onChange: (v: string) => void
  unit?: string
  /** Hand-typed over a derivation that would have said something else. */
  overridden?: boolean
  /** What the derivation says, for the "back to" line. */
  suggestion?: string
  onRestore?: () => void
}) {
  return (
    <div className={cn('space-y-1.5', field.full && 'sm:col-span-2')}>
      <Label htmlFor={field.key}>{field.label}</Label>
      {field.type === 'textarea' ? (
        <Textarea id={field.key} rows={3} value={value} onChange={(e) => onChange(e.target.value)} />
      ) : field.type === 'number' || field.type === 'money' ? (
        // Money takes a decimal point; litres and counts do not. The unit or
        // the naira sign sits inside the field so the number is never bare.
        <div className="relative">
          <NumberInput
            id={field.key}
            allowDecimal={field.type === 'money'}
            value={value}
            onValueChange={onChange}
            className={cn(field.type === 'money' ? 'pl-7' : field.unit && unit ? 'pr-16' : undefined)}
          />
          {field.type === 'money' && (
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">₦</span>
          )}
          {field.type === 'number' && field.unit && unit && (
            <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted-foreground">{unit}</span>
          )}
        </div>
      ) : (
        <Input id={field.key} type="text" value={value} onChange={(e) => onChange(e.target.value)} />
      )}
      {overridden && onRestore ? (
        <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground/70">
          <span>Your figure, not the worked-out {suggestion ? formatValue(field, suggestion, unit) : 'one'}.</span>
          <button
            type="button" onClick={onRestore}
            className="inline-flex items-center gap-1 text-accent hover:underline"
          >
            <RotateCcw className="size-3" />
            Use it instead
          </button>
        </p>
      ) : (
        field.hint && <p className="text-xs text-muted-foreground/70">{field.hint}</p>
      )}
    </div>
  )
}

/** A raw field value the way the field itself reads — money, volume or count. */
const formatValue = (field: FieldDef, value: unknown, unit?: string) => (
  field.type === 'money' ? money(value) : field.unit && unit ? withUnit(value, unit) : num(value)
)

/**
 * A day can sell at several prices: one row per price.
 *
 * Every cell is editable, and the rows arrive filled in from the day's own
 * orders. They used to be add-only — a wrong figure had to be deleted and
 * re-keyed — and on the compliance sheet nothing seeded them at all, so the
 * volume and value the whole report exists to state came out as zero.
 */
function PriceBandsEditor({ bands, onChange, unit }: { bands: Band[]; onChange: (b: Band[]) => void; unit?: string }) {
  const set = (i: number, patch: Partial<Band>) => {
    const next = [...bands]
    next[i] = { ...next[i], ...patch }
    onChange(next)
  }
  const remove = (i: number) => onChange(bands.filter((_, idx) => idx !== i))

  const totals = bandTotals(bands)

  return (
    <div className="space-y-2 sm:col-span-2">
      <Label>Today's price(s)</Label>
      <div className="overflow-hidden rounded-lg border border-foreground/15">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Price / litre</th>
              <th className="px-3 py-2 text-left">Qty sold at this price</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {bands.length === 0 ? (
              <tr className="border-t border-foreground/10">
                <td className="px-3 py-3 text-muted-foreground" colSpan={4}>
                  No price added yet.
                </td>
              </tr>
            ) : bands.map((b, i) => (
              <tr key={i} className="border-t border-foreground/10">
                <td className="p-1">
                  <NumberInput
                    allowDecimal value={b.price} onValueChange={(v) => set(i, { price: v })}
                    className="h-8 border-0 bg-transparent shadow-none focus-visible:ring-1"
                  />
                </td>
                <td className="p-1">
                  <NumberInput
                    value={b.litres} onValueChange={(v) => set(i, { litres: v })}
                    className="h-8 border-0 bg-transparent shadow-none focus-visible:ring-1"
                  />
                </td>
                <td className="px-3 py-1.5 text-right">{money(Number(b.price || 0) * Number(b.litres || 0))}</td>
                <td className="px-1">
                  <button
                    type="button" onClick={() => remove(i)}
                    className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  >
                    <X className="size-3.5" />
                    <span className="sr-only">Remove</span>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          {totals.count > 0 && (
            <tfoot>
              <tr className="border-t border-foreground/15 bg-muted/20 font-medium">
                <td className="px-3 py-1.5" colSpan={2}>
                  Total volume: {withUnit(totals.litres, unit || 'Litres')}
                </td>
                <td className="px-3 py-1.5 text-right" colSpan={2}>Total: {money(totals.value)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground/70">
          Suggested from today's orders — one row per price the product sold at. The volume, value and
          average price below follow these rows.
        </p>
        <Button
          type="button" variant="outline" size="sm"
          onClick={() => onChange([...bands, { price: '', litres: '' }])}
        >
          <Plus data-icon="inline-start" />
          Add price
        </Button>
      </div>
    </div>
  )
}

function TopCustomersEditor({ rows, onChange, unit }: { rows: TopRow[]; onChange: (r: TopRow[]) => void; unit?: string }) {
  const set = (i: number, patch: Partial<TopRow>) => {
    const next = [...rows]
    next[i] = { ...next[i], ...patch }
    onChange(next)
  }
  return (
    <div className="space-y-2 sm:col-span-2">
      <Label>Top 5 customers of the day</Label>
      <div className="overflow-hidden rounded-lg border border-foreground/15">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="w-10 px-3 py-2 text-left">S/N</th>
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-left">Phone number</th>
              <th className="px-3 py-2 text-right">{unit || 'Litres'}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-foreground/10">
                <td className="px-3 text-muted-foreground">{i + 1}</td>
                <td className="p-1">
                  <Input
                    value={r.name} onChange={(e) => set(i, { name: e.target.value })}
                    className="h-8 border-0 bg-transparent shadow-none focus-visible:ring-1"
                  />
                </td>
                <td className="p-1">
                  <Input
                    value={r.phone} onChange={(e) => set(i, { phone: e.target.value })}
                    className="h-8 border-0 bg-transparent shadow-none focus-visible:ring-1"
                  />
                </td>
                <td className="p-1">
                  <NumberInput
                    value={r.litres} onValueChange={(v) => set(i, { litres: v })}
                    className="h-8 border-0 bg-transparent text-right shadow-none focus-visible:ring-1"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground/70">Suggested from today's orders — adjust any row before filing.</p>
    </div>
  )
}

export function ReportPanel({
  def,
  historyOnly = false,
  initialEdit = null,
  onRequestEdit,
}: {
  def: ReportDef
  historyOnly?: boolean
  /** A report handed over from another tab, to be loaded into this form. */
  initialEdit?: any | null
  /** Ask the page to switch to `type` and open `report` there. */
  onRequestEdit?: (type: ReportType, report: any) => void
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const [form, setForm] = useState(() => blankForm(def))
  const [bands, setBands] = useState<Band[]>([])
  const [topRows, setTopRows] = useState<TopRow[]>(() => (def.type === 'it_compliance' ? emptyTopRows() : []))
  const [editingId, setEditingId] = useState<number | null>(null)
  const [page, setPage] = useState(1)
  /**
   * There is no type filter. "Your submissions" means everything you filed.
   *
   * This was once filtered to the active tab's type, with a checkbox to widen
   * it. The tabs are built from the roles you hold today and what you filed is
   * history, so the two drift the moment anyone is reassigned — on live data
   * that hid 52 of 414 reports, two people seeing none of their own at all.
   * A checkbox was the wrong remedy: nobody looking at an empty list thinks to
   * tick one.
   *
   * The server scopes to the caller regardless, so this only ever spans a
   * person's OWN records, never anyone else's.
   */
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null)
  /** id of the handed-over report already loaded, so it loads exactly once. */
  const [loadedHandoff, setLoadedHandoff] = useState<number | null>(null)
  /** The report open in the read view. */
  const [viewing, setViewing] = useState<any | null>(null)
  /**
   * Derived fields the filer has typed their own number into. Those stop
   * following the arithmetic behind them until "Use it instead" is pressed.
   */
  const [overrides, setOverrides] = useState<Record<string, boolean>>({})
  /** The last value each derived field was auto-filled with, so a figure this
   * panel did not put there is never quietly wiped. */
  const autoFilled = useRef<Record<string, string>>({})

  // Only active batches can be reported against, and every PFI carries its
  // own location and remaining balance — so location and opening stock are
  // derived from the pick rather than typed, which is what kept them
  // disagreeing with the PFI ledger.
  const { data: pfiData } = usePfiList({ status: 'active', limit: 200 })
  const activePfis = (pfiData?.pfis ?? []) as PfiWithFinancials[]
  const pfi = activePfis.find((p) => p.pfiNumber === form.pfiNumber)

  /**
   * The unit a volume is counted in, taken from the batch's own product —
   * Litres for the fuels, kg for cooking gas. Falls back to Litres, which is
   * what every non-LPG batch uses, rather than showing a bare number.
   */
  const unitOf = (p?: { productUnit?: string | null }) => p?.productUnit || 'Litres'
  const formUnit = unitOf(pfi)
  const unitForRow = (row: { pfiNumber?: string | null }) =>
    unitOf(activePfis.find((p) => p.pfiNumber === row.pfiNumber))

  const { data: bankAccounts = [] } = useBankAccounts({ status: 'Active' })

  // Everything below is suggestion data — fetched for whichever roles use it,
  // and only ever pre-fills a field the user hasn't touched yet. Nothing here
  // runs while editing an existing report: those values are history, not a
  // fresh guess.
  const isNew = editingId === null
  /** Whether this report carries one of the two table fields. Both used to be
   * checked for by name — `def.type === 'sales_manager'` — which is how the
   * compliance sheet's price rows came to be collected on screen and then
   * dropped on the way to the server. */
  const defHasField = (type: FieldDef['type']) => allFields(def).some((f) => f.type === type)
  // Every report reads the day's orders now. Commissions was the one type left
  // out, and it filed customer and order counts by hand as a result — all
  // eight of them blank on live data.
  const { data: dayOrders } = useDayOrders(form.reportDate, isNew)
  /**
   * The orders this report is about.
   *
   * A PFI's own, when one is picked. Compliance and commissions may be filed
   * for the whole company, and then it is the day itself; the roles that
   * require a PFI never reach the wider list, because their suggestions are
   * gated on having one.
   */
  const scopedOrders = useMemo(
    () => (pfi ? ordersForPfi(dayOrders || [], pfi.id) : dayOrders || []),
    [dayOrders, pfi?.id],
  )
  /** The gate reports on a place, not on a batch — every truck through it,
   * whichever PFI the product belonged to. */
  const locationOrders = useMemo(
    () => (dayOrders || []).filter((o) => (o.depotName || o.state) === form.location),
    [dayOrders, form.location],
  )

  const gateEnabled = isNew && def.type === 'security_gate' && !!form.location
  const { data: gateCounts } = useTruckCounts(
    gateEnabled ? loadedOrders(locationOrders) : undefined, form.reportDate, gateEnabled,
  )

  // Trucks for the three sheets that count them per batch. Always PFI-scoped:
  // this is a request per order, and a company-wide day is not a shape worth
  // asking the API for.
  const pfiTrucksEnabled = isNew && !!pfi
    && ['sales_manager', 'product_manager', 'commissions'].includes(def.type)
  const { data: pfiTrucks } = useTruckCounts(
    pfiTrucksEnabled ? loadedOrders(scopedOrders) : undefined, form.reportDate, pfiTrucksEnabled,
  )

  const depositsEnabled = isNew && !!pfi && ['sales_manager', 'commissions'].includes(def.type)
  const { data: pfiDeposits } = usePfiDeposits(pfi?.id, depositsEnabled)

  const yesterday = format(subDays(new Date(`${form.reportDate || format(new Date(), 'yyyy-MM-dd')}T00:00:00`), 1), 'yyyy-MM-dd')
  // The sales manager settles yesterday's gap on today's sheet, so it reads
  // the same row the location manager reads for yesterday's remarks.
  const yesterdayEnabled = ['product_manager', 'sales_manager'].includes(def.type)
    && !!form.location && !!form.pfiNumber
  const { data: yesterdayReport } = useYesterdayReport(def.type, form.location, form.pfiNumber, yesterday, yesterdayEnabled)

  // ── Suggestions: each effect only ever fills a field that is still blank ──

  /** Fill in what is still empty, leave everything else exactly as typed. */
  const suggest = (values: Record<string, string | undefined>) => {
    setForm((f) => {
      let next = f
      for (const [key, value] of Object.entries(values)) {
        if (value == null || value === '' || f[key] !== '') continue
        next = next === f ? { ...f } : next
        next[key] = value
      }
      return next
    })
  }

  useEffect(() => {
    if (!isNew || !pfi || pfi.financials?.remaining == null) return
    if (def.type !== 'sales_manager' && def.type !== 'product_manager') return
    suggest({ openingStock: String(pfi.financials.remaining) })
  }, [pfi?.id, isNew, def.type])

  useEffect(() => {
    if (!isNew || !pfi || def.type !== 'sales_manager' || bankAccounts.length === 0) return
    // By PFI first. Matching on the PFI's location could not tell two PFIs at
    // one location apart and silently handed both the first account it found —
    // which is exactly the case that needed them to differ. The location match
    // stays as a fallback for accounts assigned before this was per-PFI.
    const match = bankAccounts.find((a) => a.pfiIds?.map(Number).includes(Number(pfi.id)))
      || bankAccounts.find((a) => a.depotIds?.map(Number).includes(Number(pfi.locationId)))
      || bankAccounts.find((a) => a.isDefault)
    if (!match) return
    setForm((f) => (f.bankName === '' ? { ...f, bankName: match.bankName, accountNumber: match.accountNumber } : f))
  }, [pfi?.id, bankAccounts, isNew, def.type])

  /**
   * The price table, seeded from what the day actually sold at.
   *
   * Both sheets that carry one get it. Compliance never did, and since its
   * volume, value and average price are read off this table, every compliance
   * report filed since it was introduced went out at 0 litres and ₦0 — 101 of
   * 105 on live data, with not one price row saved between them.
   */
  useEffect(() => {
    if (!isNew || !dayOrders || !defHasField('priceBands')) return
    // Compliance may be filed for the whole company; the sales manager's sheet
    // is always about one batch, so it waits for the pick.
    if (def.type === 'sales_manager' && !pfi) return
    if (bands.some((b) => b.price !== '' || b.litres !== '')) return
    const suggested = suggestPriceBands(scopedOrders)
    if (suggested.length) setBands(suggested.map((b) => ({ price: String(b.price), litres: String(b.litres) })))
  }, [pfi?.id, scopedOrders, isNew, def.type])

  useEffect(() => {
    if (!isNew || !pfi || def.type !== 'product_manager') return
    // Ordered and loaded are two different questions on this sheet, and
    // answering both with every order made the pair meaningless.
    const ordered = sumQuantity(scopedOrders)
    const loaded = sumQuantity(loadedOrders(scopedOrders))
    suggest({
      receivedStock: ordered ? String(ordered) : '',
      litresSold: loaded ? String(loaded) : '',
    })
  }, [pfi?.id, scopedOrders, isNew, def.type])

  useEffect(() => {
    if (!isNew || !dayOrders) return
    if (def.type !== 'it_compliance' && def.type !== 'commissions') return
    // Nothing real to suggest yet — e.g. the date just changed and this is
    // the empty result for a day with no orders so far. Writing a hard '0'
    // here would permanently block a later, real count from ever landing,
    // since the field would no longer read as blank.
    if (scopedOrders.length === 0) return
    suggest({
      orderCount: String(scopedOrders.length),
      customerCount: String(countCustomers(scopedOrders)),
      // Compliance takes its volume from the price rows above instead.
      litresSold: def.type === 'commissions' ? String(sumQuantity(scopedOrders)) : '',
    })
    if (def.type !== 'it_compliance') return
    setTopRows((rows) => {
      if (rows.some((r) => r.name.trim())) return rows
      const top = topCustomersFrom(scopedOrders)
      if (!top.length) return rows
      const converted: TopRow[] = top.map((t) => (
        { name: t.name, phone: t.phone, litres: t.litres ? String(t.litres) : '' }
      ))
      return [...converted, ...emptyTopRows()].slice(0, 5)
    })
  }, [pfi?.id, scopedOrders, isNew, def.type])

  useEffect(() => {
    if (!gateCounts || !isNew) return
    suggest({
      trucksEntered: String(gateCounts.entered),
      truckCount: String(gateCounts.exited),
    })
  }, [gateCounts, isNew])

  useEffect(() => {
    if (!pfiTrucks || !isNew || !pfiTrucks.loaded) return
    suggest({ truckCount: String(pfiTrucks.loaded) })
  }, [pfiTrucks, isNew])

  useEffect(() => {
    if (!pfiDeposits || !isNew) return
    const all = pfiDeposits.reduce((s, d) => s + Number(d.amount || 0), 0)
    const today = pfiDeposits
      .filter((d) => d.createdAt && d.createdAt.slice(0, 10) === form.reportDate)
      .reduce((s, d) => s + Number(d.amount || 0), 0)
    suggest(def.type === 'commissions'
      ? { fundsReceived: String(today) }
      : { totalInflow: String(all), amountPaid: String(today) })
  }, [pfiDeposits, isNew, def.type, form.reportDate])

  useEffect(() => {
    if (!isNew || def.type !== 'sales_manager' || yesterdayReport?.differentials == null) return
    // Yesterday's gap is settled on today's sheet: short one way is a deficit
    // to pay, over the other is a surplus to return. Only ever one of the two.
    const gap = Number(yesterdayReport.differentials)
    if (!gap) return
    suggest(gap < 0
      ? { yesterdayDeficitPayment: String(Math.abs(gap)) }
      : { yesterdaySurplusPayment: String(gap) })
  }, [yesterdayReport, isNew, def.type])

  // ── Derived: worked out from the rest of the sheet, and still yours to edit ──

  const derived = useMemo(
    () => derivedFor(def.type, { ...form, priceBands: bands }),
    [def.type, form, bands],
  )

  /**
   * Keep the derived boxes in step with the figures behind them.
   *
   * Only where the filer has not typed their own number — an override is
   * theirs until they ask for the worked-out figure back. A derivation that
   * has nothing to say leaves the box alone unless this is the value it put
   * there itself, so a figure filed before the arithmetic existed (or typed
   * during a moment when the day's orders had not loaded) is never wiped.
   */
  useEffect(() => {
    const patch: Record<string, string> = {}
    for (const [key, value] of Object.entries(derived)) {
      if (overrides[key]) continue
      const current = form[key] ?? ''
      if (current === value) continue
      if (value === '' && current !== '' && current !== autoFilled.current[key]) continue
      patch[key] = value
    }
    if (Object.keys(patch).length === 0) return
    autoFilled.current = { ...autoFilled.current, ...patch }
    setForm((f) => ({ ...f, ...patch }))
  }, [derived, overrides, form])

  /** Typing in a derived box makes the figure yours. */
  const setField = (field: FieldDef, value: string) => {
    if (field.derived) setOverrides((o) => (o[field.key] ? o : { ...o, [field.key]: true }))
    setForm((f) => ({ ...f, [field.key]: value }))
  }

  /** …and this hands it back to the arithmetic. */
  const restoreField = (key: string) => {
    setOverrides((o) => {
      const next = { ...o }
      delete next[key]
      return next
    })
    const value = derived[key] ?? ''
    autoFilled.current[key] = value
    setForm((f) => ({ ...f, [key]: value }))
  }

  /**
   * Paged by the server — one page number, not the two the upstream version
   * used, which skipped records on every "next".
   */
  const { data, isLoading } = useQuery({
    // No def.type in the key: every panel shows the same set, so they share
    // one cache entry instead of refetching identical data per tab.
    queryKey: ['daily-reports', 'mine', page],
    queryFn: async () => {
      const res = await api.get('/daily-reports', {
        params: { page, limit: PAGE_SIZE },
      })
      return res.data.data as { reports: any[]; pagination?: { total: number; pages?: number } }
    },
  })

  const rows = data?.reports ?? []
  const total = data?.pagination?.total ?? rows.length
  /**
   * The per-type metric columns only mean anything when every row is that
   * type. Across a mixed list they read off keys a foreign row does not have
   * and print a column of dashes under a heading like "Litres sold", which
   * looks like missing data rather than a column that does not apply. So they
   * are shown only when the list is actually of one type; the row's own
   * figures stay reachable through its PDF.
   */
  const mixed = new Set(rows.map((r) => r.reportType)).size > 1
  const metricColumns = mixed ? [] : def.columns
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const reset = () => {
    setForm(blankForm(def))
    setBands([])
    setTopRows(defHasField('topCustomers') ? emptyTopRows() : [])
    setOverrides({})
    autoFilled.current = {}
    setEditingId(null)
  }

  const save = useMutation({
    retry: false,
    mutationFn: async () => {
      const payload: Record<string, unknown> = { reportType: def.type }
      const numericKeys = new Set(
        allFields(def).filter((f) => f.type === 'number' || f.type === 'money').map((f) => f.key),
      )
      for (const [k, v] of Object.entries(form)) {
        if (v === '' || v == null) continue
        if (!numericKeys.has(k)) {
          payload[k] = v
          continue
        }
        // Never post a NaN. JSON turns it into null, the API coerces that to
        // 0, and a figure nobody typed lands on the report as zero — which is
        // how compliance sheets came to record a day's trading at ₦0.
        const parsed = Number(v)
        if (Number.isFinite(parsed)) payload[k] = parsed
      }
      // The paper form's own tables, saved as tables. Driven by the field list
      // rather than by report type, so a sheet that grows one is not silently
      // left out — which is exactly what happened to compliance's price rows:
      // collected on screen, summarised, and then dropped on the way out.
      if (defHasField('priceBands')) {
        payload.priceBands = bands
          .filter((b) => b.price !== '' || b.litres !== '')
          .map((b) => ({ price: Number(b.price || 0), litres: Number(b.litres || 0) }))
      }
      if (defHasField('topCustomers')) {
        payload.topCustomers = topRows
          .filter((r) => r.name.trim())
          .map((r) => ({ name: r.name.trim(), phone: r.phone.trim(), litres: Number(r.litres || 0) }))
      }
      // A whole-company report still needs somewhere to file itself: location
      // is NOT NULL and the API requires it, so leaving it out failed the
      // whole submission on a form that calls the field optional.
      if (!String(payload.location ?? '').trim()) payload.location = COMPANY_WIDE
      return editingId
        ? (await api.patch(`/daily-reports/${editingId}`, payload)).data
        : (await api.post('/daily-reports', payload)).data
    },
    onSuccess: (res) => {
      toast.success(res?.message || (editingId ? 'Report updated' : 'Report submitted'))
      qc.invalidateQueries({ queryKey: ['daily-reports'] })
      reset()
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const remove = useMutation({
    retry: false,
    mutationFn: async (id: number) => (await api.delete(`/daily-reports/${id}`)).data,
    onSuccess: () => {
      toast.success('Report deleted')
      qc.invalidateQueries({ queryKey: ['daily-reports'] })
      setConfirmDelete(null)
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  /**
   * Load a row into the form.
   *
   * A report of another type is handed to the tab that owns it instead. The
   * form is built from `def` and the save posts `reportType: def.type`, so
   * editing a foreign row here would not merely show the wrong fields — it
   * would rewrite that report as this panel's type and blank every figure the
   * two layouts do not share. Now that the list spans every type, that path
   * is reachable from any tab, so it is closed rather than guarded.
   */
  const edit = (r: any) => {
    if (r.reportType && r.reportType !== def.type) {
      if (onRequestEdit) onRequestEdit(r.reportType as ReportType, r)
      else toast.error(`This is a ${REPORTS[r.reportType as ReportType]?.roleLabel || r.reportType} report — open that tab to edit it`)
      return
    }
    const next = blankForm(def)
    next.reportDate = String(r.reportDate ?? '').slice(0, 10)
    next.location = r.location === COMPANY_WIDE ? '' : r.location ?? ''
    next.pfiNumber = r.pfiNumber ?? ''
    for (const f of allFields(def)) {
      if (f.type === 'priceBands' || f.type === 'topCustomers') continue
      next[f.key] = r[f.key] == null ? '' : String(r[f.key])
    }
    const loadedBands: Band[] = defHasField('priceBands')
      ? (Array.isArray(r.priceBands) ? r.priceBands : [])
        .map((b: any) => ({ price: String(b.price ?? ''), litres: String(b.litres ?? '') }))
      : []
    setForm(next)
    setBands(loadedBands)
    if (defHasField('topCustomers')) {
      const loaded = Array.isArray(r.topCustomers) ? r.topCustomers : []
      const padded = [...loaded, ...emptyTopRows()].slice(0, 5)
      setTopRows(padded.map((c: any) => ({
        name: c.name ?? '', phone: c.phone ?? '', litres: c.litres != null && c.litres !== '' ? String(c.litres) : '',
      })))
    }
    /**
     * A figure that was filed as something other than the arithmetic is one
     * somebody meant, so it opens as an override rather than being recomputed
     * away the moment the form loads. Everything else keeps following its
     * inputs, so correcting a price row still moves the totals with it.
     */
    const asFiled = derivedFor(def.type, { ...next, priceBands: loadedBands })
    const kept: Record<string, boolean> = {}
    for (const f of allFields(def)) {
      if (!f.derived || next[f.key] === '' || !asFiled[f.key]) continue
      if (Number(next[f.key]) !== Number(asFiled[f.key])) kept[f.key] = true
    }
    setOverrides(kept)
    autoFilled.current = { ...asFiled }
    setEditingId(r.id)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  /**
   * The definition that describes a given row.
   *
   * The row's own type, never the tab's. The list spans every type a person
   * has filed, so reading a row through the active panel's definition puts it
   * against the wrong field set entirely — which is how a foreign report used
   * to come out of the PDF button with half its figures missing and labels
   * belonging to another report.
   */
  const defFor = (r: any): ReportDef => REPORTS[r.reportType as ReportType] ?? def

  /**
   * A report as label/value lines, in filing order.
   *
   * One assembly, read by both the PDF and the view dialog, so the document
   * someone downloads and the one they are looking at can never disagree
   * about what the report says.
   */
  const reportLines = (r: any): Array<[string, string]> => {
    const d = defFor(r)
    const lines: Array<[string, string]> = [
      ['Date', r.reportDate ? format(new Date(r.reportDate), 'd MMM yyyy') : '—'],
      ['Location', r.location || '—'],
      ['PFI', r.pfiNumber || '—'],
      ['Submitted by', r.submittedByName || '—'],
    ]
    const unit = unitForRow(r)
    for (const f of allFields(d)) {
      if (f.type === 'priceBands') {
        for (const b of (Array.isArray(r.priceBands) ? r.priceBands : [])) {
          // The batch's own unit, not a hardcoded "L" — a cooking gas report
          // reads in kg and always did on screen.
          lines.push([`Price ${money(b.price)}`, withUnit(b.litres, unit)])
        }
        continue
      }
      if (f.type === 'topCustomers') {
        (Array.isArray(r.topCustomers) ? r.topCustomers : []).forEach((c: any, i: number) => {
          lines.push([`Top customer #${i + 1}`, `${c.name || '—'} · ${c.phone || '—'} · ${withUnit(c.litres, unit)}`])
        })
        continue
      }
      // reportValue, not r[f.key]: a commission report filed before the two
      // outstanding figures had columns of their own still has everything
      // needed to state them, and reading the row directly drops them.
      const v = reportValue(r, f.key)
      if (v == null || v === '') continue
      lines.push([f.label, f.type === 'money' ? money(v) : f.unit ? withUnit(v, unit) : String(v)])
    }
    return lines
  }

  /**
   * Download is a separate action, not a side effect of saving.
   *
   * Upstream every submit *and every edit* silently dropped a PDF into the
   * user's downloads, so correcting a typo left a second file behind.
   */
  const download = async (r: any) => {
    const d = defFor(r)
    const { jsPDF } = await import('jspdf')
    const autoTable = (await import('jspdf-autotable')).default
    const doc = new jsPDF()

    doc.setFillColor(0, 86, 60)
    doc.rect(0, 0, 210, 26, 'F')
    doc.setTextColor(255).setFontSize(13)
    doc.text('SOROMAN ENERGY LIMITED', 14, 12)
    doc.setFontSize(9).text(d.pdfTitle.toUpperCase(), 14, 19)

    doc.setTextColor(0).setFontSize(9)
    doc.text(`Generated ${format(new Date(), 'd MMM yyyy, HH:mm')}`, 14, 34)

    autoTable(doc, {
      startY: 40,
      body: reportLines(r).map(([k, v]) => [k, v]),
      styles: { fontSize: 9, cellPadding: 2.5 },
    })
    const stamp = r.reportDate ? format(new Date(r.reportDate), 'yyyyMMdd') : 'report'
    doc.save(`${d.filePrefix}_${(r.location || 'ALL').replace(/\s+/g, '')}_${stamp}.pdf`)
  }

  // A report handed over from another tab. Loaded once, on arrival: `edit`
  // now records which derived figures were filed as overrides, and doing that
  // during render writes it twice under StrictMode.
  useEffect(() => {
    if (!initialEdit || initialEdit.id === loadedHandoff || initialEdit.reportType !== def.type) return
    setLoadedHandoff(initialEdit.id)
    edit(initialEdit)
  }, [initialEdit, loadedHandoff, def.type])

  const ready = form.reportDate !== '' && (def.requireLocation === false || form.location.trim() !== '')

  return (
    <div className="space-y-6">
      {!historyOnly && (
      <section className={PANEL}>
        <div className={PANEL_RAIL}>
          <span className={cn(MICRO, 'text-muted-foreground')}>
            {editingId ? 'Editing report' : def.title}
          </span>
          {editingId && (
            <Button variant="ghost" size="sm" onClick={reset}>
              <X data-icon="inline-start" />
              Cancel edit
            </Button>
          )}
        </div>

        <div className="space-y-6 p-6">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="reportDate">Date</Label>
              <Input
                id="reportDate" type="date" value={form.reportDate}
                max={format(new Date(), 'yyyy-MM-dd')}
                onChange={(e) => setForm((f) => ({ ...f, reportDate: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pfiNumber">PFI{def.requireLocation === false && ' (optional)'}</Label>
              <NativeSelect
                id="pfiNumber"
                value={form.pfiNumber}
                onChange={(e) => {
                  const picked = activePfis.find((p) => p.pfiNumber === e.target.value)
                  setForm((f) => ({
                    ...f,
                    pfiNumber: e.target.value,
                    // A PFI always has a location, so filling it by hand only
                    // creates a second answer that can disagree.
                    location: picked?.locationName || f.location,
                  }))
                }}
              >
                <option value="">
                  {def.requireLocation === false ? 'Whole company (no single PFI)' : 'Select an active PFI…'}
                </option>
                {activePfis.map((p) => (
                  <option key={p.id} value={p.pfiNumber}>{p.pfiNumber}</option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="location">Location{def.requireLocation === false && ' (optional)'}</Label>
              <Input
                id="location"
                value={form.location}
                readOnly={!!form.pfiNumber}
                placeholder={def.requireLocation === false ? COMPANY_WIDE : 'Choose a PFI, or type it'}
                onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground/70">
                {form.pfiNumber
                  ? 'From the PFI.'
                  : def.requireLocation === false
                    ? `Filled in when you pick a PFI. Left empty, this files as ${COMPANY_WIDE}.`
                    : 'Filled in when you pick a PFI.'}
              </p>
            </div>
          </div>

          {def.type === 'product_manager' && yesterdayReport?.remarks && (
            <div className="rounded-lg border border-dashed border-foreground/20 bg-muted/30 p-3 text-sm">
              <p className={cn(MICRO, 'mb-1 text-muted-foreground')}>Remarks from yesterday</p>
              <p className="text-foreground/90">{yesterdayReport.remarks}</p>
            </div>
          )}

          {def.sections.map((section) => (
            <div key={section.label} className="space-y-3">
              <p className={cn(MICRO, 'border-b border-foreground/10 pb-2 text-muted-foreground')}>
                {section.label}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {section.fields.map((f) => {
                  if (f.type === 'priceBands') {
                    return <PriceBandsEditor key={f.key} bands={bands} onChange={setBands} unit={formUnit} />
                  }
                  if (f.type === 'topCustomers') {
                    return <TopCustomersEditor key={f.key} rows={topRows} onChange={setTopRows} unit={formUnit} />
                  }
                  const suggestion = f.derived ? derived[f.key] ?? '' : ''
                  return (
                    <Field
                      key={f.key}
                      field={f}
                      value={form[f.key] ?? ''}
                      onChange={(v) => setField(f, v)}
                      unit={formUnit}
                      overridden={!!overrides[f.key] && suggestion !== '' && suggestion !== (form[f.key] ?? '')}
                      suggestion={suggestion}
                      onRestore={() => restoreField(f.key)}
                    />
                  )
                })}
              </div>
            </div>
          ))}

          <div className="flex items-center justify-end gap-2 border-t border-foreground/10 pt-4">
            {!ready && (
              <p className="mr-auto text-xs text-muted-foreground">
                {def.requireLocation === false
                  ? 'A date is needed before this can be filed.'
                  : 'A date and location are needed before this can be filed.'}
              </p>
            )}
            <Button disabled={!ready || save.isPending} onClick={() => save.mutate()}>
              {save.isPending && <Loader2 className="animate-spin" />}
              {editingId ? 'Save changes' : 'Submit report'}
            </Button>
          </div>
        </div>
      </section>
      )}

      <section className={PANEL}>
        <div className={PANEL_RAIL}>
          <span className={cn(MICRO, 'text-muted-foreground')}>Your submissions</span>
          {total > 0 && <span className="text-sm text-muted-foreground">{total} filed</span>}
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="animate-spin" /></div>
        ) : rows.length === 0 ? (
          <PageEmpty
            title="Nothing filed yet"
            description={historyOnly
              ? 'Nothing has been filed under your account.'
              : 'Fill the form above to file your first one.'}
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead className="hidden md:table-cell">PFI</TableHead>
                  <TableHead>Type</TableHead>
                  {metricColumns.map((c) => (
                    <TableHead key={c.key} className={c.align === 'right' ? 'text-right' : undefined}>
                      {c.label}
                    </TableHead>
                  ))}
                  <TableHead>Staff</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap">
                      {r.reportDate ? format(new Date(r.reportDate), 'd MMM yyyy') : '—'}
                    </TableCell>
                    <TableCell>{r.location || '—'}</TableCell>
                    <TableCell className="hidden md:table-cell text-muted-foreground">
                      {r.pfiNumber || '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap">
                      {REPORTS[r.reportType as ReportType]?.roleLabel || r.reportType || '—'}
                    </TableCell>
                    {metricColumns.map((c) => {
                      const v = reportValue(r, c.key)
                      return (
                        <TableCell key={c.key} className={c.align === 'right' ? 'text-right' : undefined}>
                          {c.money ? money(v) : c.unit ? withUnit(v, unitForRow(r)) : num(v)}
                        </TableCell>
                      )
                    })}
                    <TableCell className="max-w-[10rem] truncate">{r.submittedByName || '—'}</TableCell>
                    <TableCell>
                      <StatusChip
                        tone={STATUS_TONE[r.status as keyof typeof STATUS_TONE] ?? 'inert'}
                        title={r.status === 'rejected' && r.reviewComment ? r.reviewComment : undefined}
                      >
                        {r.status || 'submitted'}
                      </StatusChip>
                    </TableCell>
                    <TableCell className="text-right">
                      {confirmDelete === r.id ? (
                        <span className="inline-flex items-center gap-2 text-xs">
                          Delete?
                          <button
                            className="text-destructive hover:underline"
                            onClick={() => remove.mutate(r.id)}
                          >
                            Yes
                          </button>
                          <button className="hover:underline" onClick={() => setConfirmDelete(null)}>
                            No
                          </button>
                        </span>
                      ) : (
                        <div className="flex items-center justify-end gap-0.5">
                          {/* Only a submitted report can still be amended — once a
                              manager has reviewed it, the API rejects a PATCH, so
                              the button disappears rather than round-tripping an
                              error. */}
                          <Button variant="ghost" size="icon-sm" title="View" onClick={() => setViewing(r)}>
                            <Eye /><span className="sr-only">View</span>
                          </Button>
                          {r.status === 'submitted' && (
                            <Button variant="ghost" size="icon-sm" title="Edit" onClick={() => edit(r)}>
                              <Pencil /><span className="sr-only">Edit</span>
                            </Button>
                          )}
                          <Button variant="ghost" size="icon-sm" title="Download PDF" onClick={() => download(r)}>
                            <Download /><span className="sr-only">Download</span>
                          </Button>
                          <Button
                            variant="ghost" size="icon-sm" title="Delete"
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => setConfirmDelete(r.id)}
                          >
                            <Trash2 /><span className="sr-only">Delete</span>
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Hidden entirely on a single page, rather than showing a dead pager. */}
        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-foreground/10 p-3">
            <span className="text-xs text-muted-foreground">
              Page {page} of {pages} · {total} reports
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        )}
      </section>

      {/*
        Reading a report was the one thing this page could not do. You could
        edit it, delete it, or download it as a PDF — so the only way to check
        what you had filed was to open the form that overwrites it, or to put a
        file on disk. Both are worse than looking.

        Rendered through the ROW's definition, not the tab's, so a report of
        another type reads against its own fields rather than against a layout
        it was never filed under.
      */}
      <Dialog open={viewing !== null} onOpenChange={(o) => { if (!o) setViewing(null) }}>
        <DialogContent className="max-h-[88svh] overflow-y-auto sm:max-w-[560px]">
          {viewing && (
            <>
              <DialogHeader>
                <DialogTitle>{defFor(viewing).title}</DialogTitle>
                <DialogDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span>
                    {viewing.reportDate ? format(new Date(viewing.reportDate), 'd MMM yyyy') : '—'}
                    {viewing.location ? ` · ${viewing.location}` : ''}
                  </span>
                  <StatusChip tone={STATUS_TONE[viewing.status as keyof typeof STATUS_TONE] ?? 'inert'}>
                    {viewing.status || 'submitted'}
                  </StatusChip>
                </DialogDescription>
              </DialogHeader>

              {/* A rejection's reason is the whole point of opening the report,
                  so it leads rather than sitting in a tooltip on the chip. */}
              {viewing.status === 'rejected' && viewing.reviewComment && (
                <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
                  <span className="font-medium">Sent back:</span> {viewing.reviewComment}
                </p>
              )}

              <dl className="divide-y divide-foreground/10">
                {reportLines(viewing).map(([label, value]) => (
                  <div key={label} className="flex items-start justify-between gap-4 py-2">
                    <dt className="text-sm text-muted-foreground">{label}</dt>
                    <dd className="text-right text-sm font-medium">{value}</dd>
                  </div>
                ))}
              </dl>

              <DialogFooter className="gap-2 sm:gap-2">
                <div className="mr-auto flex items-center gap-2">
                  {viewing.status === 'submitted' && (
                    <Button
                      variant="outline"
                      onClick={() => { const r = viewing; setViewing(null); edit(r) }}
                    >
                      <Pencil data-icon="inline-start" />
                      Edit
                    </Button>
                  )}
                  <Button variant="outline" onClick={() => download(viewing)}>
                    <Download data-icon="inline-start" />
                    PDF
                  </Button>
                  <Button
                    variant="ghost"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => { setConfirmDelete(viewing.id); setViewing(null) }}
                  >
                    <Trash2 data-icon="inline-start" />
                    Delete
                  </Button>
                </div>
                <Button variant="ghost" onClick={() => setViewing(null)}>Close</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
