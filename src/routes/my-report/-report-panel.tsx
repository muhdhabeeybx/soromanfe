import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format, subDays } from 'date-fns'
import { Loader2, Trash2, Pencil, Download, Plus, X } from 'lucide-react'

import api from '#/lib/api/http'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Textarea } from '#/components/ui/textarea'
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '#/components/ui/table'
import { PageEmpty } from '#/components/PageEmpty'
import { StatusChip } from '#/components/ui/status-chip'
import { MICRO, PANEL, PANEL_RAIL } from '#/lib/panel'
import { cn, getErrorMessage } from '#/lib/utils'
import { useToast } from '#/lib/hooks/useToast'
import { naira } from '#/routes/pfi/-pfi-utils'
import { NativeSelect } from '#/components/ui/native-select'
import { usePfiList, type PfiWithFinancials } from '#/lib/hooks/usePfis'
import { useBankAccounts } from '#/lib/hooks/useBankAccounts'
import { STATUS_TONE, allFields, type ReportDef, type FieldDef } from './-report-config'
import {
  useDayOrders, useGateTruckCounts, useYesterdayReport, usePfiDeposits,
  ordersForPfi, suggestPriceBands, sumQuantity, sumAmount, topCustomersFrom,
} from './-report-autofill'

const PAGE_SIZE = 10

const money = (v: unknown) => naira(Number(v ?? 0))
const num = (v: unknown) => Number(v ?? 0).toLocaleString()

/**
 * A column's value for the history table.
 *
 * Most read straight off the saved row. The commission report's outstanding
 * and remaining figures are derived instead of stored — a stored total drifts
 * the moment one of its inputs is corrected — so they are worked out here,
 * from the same arithmetic the form shows while filling it in. Blank, not 0,
 * when the figure they are measured against was never entered.
 */
const columnValue = (row: Record<string, unknown>, key: string): unknown => {
  const paid = Number(row.amountPaid ?? 0)
  if (key === 'commissionOutstanding') {
    return row.commissionDue == null ? '' : Number(row.commissionDue) - paid
  }
  if (key === 'fundsRemaining') {
    return row.fundsReceived == null ? '' : Number(row.fundsReceived) - paid
  }
  return row[key]
}

type Band = { price: string; litres: string }
type TopRow = { name: string; phone: string; litres: string }
const emptyTopRows = (): TopRow[] => Array.from({ length: 5 }, () => ({ name: '', phone: '', litres: '' }))

/** Empty string rather than 0, so an untouched number field stays blank.
 * Structured and computed fields live in their own state, not here. */
const blankForm = (def: ReportDef) => {
  const out: Record<string, string> = {
    reportDate: format(new Date(), 'yyyy-MM-dd'),
    location: '',
    pfiNumber: '',
  }
  for (const f of allFields(def)) {
    if (f.type === 'priceBands' || f.type === 'topCustomers' || f.computed) continue
    out[f.key] = ''
  }
  return out
}

function Field({ field, value, onChange }: { field: FieldDef; value: string; onChange: (v: string) => void }) {
  return (
    <div className={cn('space-y-1.5', field.full && 'sm:col-span-2')}>
      <Label htmlFor={field.key}>{field.label}</Label>
      {field.type === 'textarea' ? (
        <Textarea id={field.key} rows={3} value={value} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <Input
          id={field.key}
          type={field.type === 'number' || field.type === 'money' ? 'number' : 'text'}
          inputMode={field.type === 'number' || field.type === 'money' ? 'numeric' : undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {field.hint && <p className="text-xs text-muted-foreground/70">{field.hint}</p>}
    </div>
  )
}

function ComputedField({ field, value }: { field: FieldDef; value: string }) {
  return (
    <div className={cn('space-y-1.5', field.full && 'sm:col-span-2')}>
      <Label>{field.label}</Label>
      <div className="flex h-9 items-center rounded-lg border border-dashed border-foreground/20 bg-muted/30 px-2.5 text-sm">
        {value === '' ? '—' : field.type === 'money' ? money(value) : num(value)}
      </div>
      <p className="text-xs text-muted-foreground/70">Computed — not editable.</p>
    </div>
  )
}

/**
 * A day can sell at several prices. Add one row per price; litres sold and
 * the total are summed from the rows rather than typed separately, so the
 * two can never disagree.
 */
function PriceBandsEditor({ bands, onChange }: { bands: Band[]; onChange: (b: Band[]) => void }) {
  const [price, setPrice] = useState('')
  const [litres, setLitres] = useState('')

  const add = () => {
    if (!price || !litres) return
    onChange([...bands, { price, litres }])
    setPrice('')
    setLitres('')
  }
  const remove = (i: number) => onChange(bands.filter((_, idx) => idx !== i))

  const totalLitres = bands.reduce((s, b) => s + Number(b.litres || 0), 0)
  const totalAmount = bands.reduce((s, b) => s + Number(b.litres || 0) * Number(b.price || 0), 0)

  return (
    <div className="space-y-2 sm:col-span-2">
      <Label>Today's price(s)</Label>
      {bands.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-foreground/15">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Price</th>
                <th className="px-3 py-2 text-left">Litres</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {bands.map((b, i) => (
                <tr key={i} className="border-t border-foreground/10">
                  <td className="px-3 py-1.5">{money(Number(b.price))}</td>
                  <td className="px-3 py-1.5">{num(Number(b.litres))}</td>
                  <td className="px-3 py-1.5 text-right">{money(Number(b.price) * Number(b.litres))}</td>
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
            <tfoot>
              <tr className="border-t border-foreground/15 bg-muted/20 font-medium">
                <td className="px-3 py-1.5" colSpan={2}>Litres sold today: {num(totalLitres)}</td>
                <td className="px-3 py-1.5 text-right" colSpan={2}>Total: {money(totalAmount)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Price / litre</Label>
          <Input
            type="number" inputMode="numeric" className="w-32"
            value={price} onChange={(e) => setPrice(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Qty sold at this price</Label>
          <Input
            type="number" inputMode="numeric" className="w-36"
            value={litres} onChange={(e) => setLitres(e.target.value)}
          />
        </div>
        <Button type="button" variant="outline" size="sm" onClick={add} disabled={!price || !litres}>
          <Plus data-icon="inline-start" />
          Add price
        </Button>
      </div>
      <p className="text-xs text-muted-foreground/70">
        Add a row for every price the product sold at today — litres sold and the total are added up automatically.
      </p>
    </div>
  )
}

function TopCustomersEditor({ rows, onChange }: { rows: TopRow[]; onChange: (r: TopRow[]) => void }) {
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
              <th className="px-3 py-2 text-right">Litres</th>
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
                  <Input
                    type="number" value={r.litres} onChange={(e) => set(i, { litres: e.target.value })}
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

export function ReportPanel({ def }: { def: ReportDef }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [form, setForm] = useState(() => blankForm(def))
  const [bands, setBands] = useState<Band[]>([])
  const [topRows, setTopRows] = useState<TopRow[]>(() => (def.type === 'it_compliance' ? emptyTopRows() : []))
  const [editingId, setEditingId] = useState<number | null>(null)
  const [page, setPage] = useState(1)
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null)

  // Only active batches can be reported against, and every PFI carries its
  // own location and remaining balance — so location and opening stock are
  // derived from the pick rather than typed, which is what kept them
  // disagreeing with the PFI ledger.
  const { data: pfiData } = usePfiList({ status: 'active', limit: 200 })
  const activePfis = (pfiData?.pfis ?? []) as PfiWithFinancials[]
  const pfi = activePfis.find((p) => p.pfiNumber === form.pfiNumber)

  const { data: bankAccounts = [] } = useBankAccounts({ status: 'Active' })

  // Everything below is suggestion data — fetched for whichever roles use it,
  // and only ever pre-fills a field the user hasn't touched yet. Nothing here
  // runs while editing an existing report: those values are history, not a
  // fresh guess.
  const isNew = editingId === null
  const needsDayOrders = isNew && def.type !== 'commissions'
  const { data: dayOrders } = useDayOrders(form.reportDate, needsDayOrders)
  const pfiOrders = useMemo(() => ordersForPfi(dayOrders || [], pfi?.id), [dayOrders, pfi?.id])

  const gateEnabled = isNew && def.type === 'security_gate' && !!form.location
  const { data: gateCounts } = useGateTruckCounts(dayOrders, form.location, form.reportDate, gateEnabled)

  const depositsEnabled = isNew && def.type === 'sales_manager' && !!pfi
  const { data: pfiDeposits } = usePfiDeposits(pfi?.id, depositsEnabled)

  const yesterday = format(subDays(new Date(`${form.reportDate || format(new Date(), 'yyyy-MM-dd')}T00:00:00`), 1), 'yyyy-MM-dd')
  const yesterdayEnabled = def.type === 'product_manager' && !!form.location && !!form.pfiNumber
  const { data: yesterdayReport } = useYesterdayReport(def.type, form.location, form.pfiNumber, yesterday, yesterdayEnabled)

  // ── Suggestions: each effect only ever fills a field that is still blank ──

  useEffect(() => {
    if (!isNew || !pfi || pfi.financials?.remaining == null) return
    if (def.type !== 'sales_manager' && def.type !== 'product_manager') return
    setForm((f) => (f.openingStock === '' ? { ...f, openingStock: String(pfi.financials.remaining) } : f))
  }, [pfi?.id, isNew, def.type])

  useEffect(() => {
    if (!isNew || !pfi || def.type !== 'sales_manager' || bankAccounts.length === 0) return
    const match = bankAccounts.find((a) => a.depotIds?.map(Number).includes(Number(pfi.locationId)))
      || bankAccounts.find((a) => a.isDefault)
    if (!match) return
    setForm((f) => (f.bankName === '' ? { ...f, bankName: match.bankName, accountNumber: match.accountNumber } : f))
  }, [pfi?.id, bankAccounts, isNew, def.type])

  useEffect(() => {
    if (!isNew || !pfi || def.type !== 'sales_manager' || bands.length > 0) return
    const suggested = suggestPriceBands(pfiOrders)
    if (suggested.length) setBands(suggested.map((b) => ({ price: String(b.price), litres: String(b.litres) })))
  }, [pfi?.id, pfiOrders, isNew, def.type, bands.length])

  useEffect(() => {
    if (!isNew || !pfi || def.type !== 'product_manager') return
    const qty = sumQuantity(pfiOrders)
    if (!qty) return
    setForm((f) => (f.litresSold === '' ? { ...f, litresSold: String(qty) } : f))
  }, [pfi?.id, pfiOrders, isNew, def.type])

  useEffect(() => {
    if (!isNew || def.type !== 'it_compliance' || !dayOrders) return
    const scoped = pfi ? pfiOrders : dayOrders
    // Nothing real to suggest yet — e.g. the date just changed and this is
    // the empty result for a day with no orders so far. Writing a hard '0'
    // here would permanently block a later, real count from ever landing,
    // since the field would no longer read as blank.
    if (scoped.length === 0) return
    const qty = sumQuantity(scoped)
    setForm((f) => ({
      ...f,
      orderCount: f.orderCount === '' ? String(scoped.length) : f.orderCount,
      litresSold: f.litresSold === '' ? String(qty) : f.litresSold,
      avgPrice: f.avgPrice === '' && qty ? String(sumAmount(scoped) / qty) : f.avgPrice,
    }))
    setTopRows((rows) => {
      if (rows.some((r) => r.name.trim())) return rows
      const top = topCustomersFrom(scoped)
      if (!top.length) return rows
      const converted: TopRow[] = top.map((t) => (
        { name: t.name, phone: t.phone, litres: t.litres ? String(t.litres) : '' }
      ))
      return [...converted, ...emptyTopRows()].slice(0, 5)
    })
  }, [pfi?.id, dayOrders, isNew, def.type])

  useEffect(() => {
    if (!gateCounts || !isNew) return
    setForm((f) => ({
      ...f,
      trucksEntered: f.trucksEntered === '' ? String(gateCounts.entered) : f.trucksEntered,
      truckCount: f.truckCount === '' ? String(gateCounts.exited) : f.truckCount,
    }))
  }, [gateCounts, isNew])

  useEffect(() => {
    if (!pfiDeposits || !isNew) return
    const all = pfiDeposits.reduce((s, d) => s + Number(d.amount || 0), 0)
    const today = pfiDeposits
      .filter((d) => d.createdAt && d.createdAt.slice(0, 10) === form.reportDate)
      .reduce((s, d) => s + Number(d.amount || 0), 0)
    setForm((f) => ({
      ...f,
      totalInflow: f.totalInflow === '' ? String(all) : f.totalInflow,
      amountPaid: f.amountPaid === '' ? String(today) : f.amountPaid,
    }))
  }, [pfiDeposits, isNew, form.reportDate])

  // ── Computed: derived purely from other values, never typed directly ──

  const computed = useMemo(() => {
    const out: Record<string, string> = {}
    if (def.type === 'sales_manager') {
      const litres = bands.reduce((s, b) => s + Number(b.litres || 0), 0)
      const amount = bands.reduce((s, b) => s + Number(b.litres || 0) * Number(b.price || 0), 0)
      out.litresSold = bands.length ? String(litres) : ''
      out.totalSalesAmount = bands.length ? String(amount) : ''
      out.differentials = form.amountPaid !== '' && bands.length ? String(Number(form.amountPaid) - amount) : ''
    }
    if (def.type === 'product_manager') {
      const opening = Number(form.openingStock || 0)
      const received = Number(form.receivedStock || 0)
      const loaded = Number(form.litresSold || 0)
      out.tankBalance = form.openingStock !== '' || form.receivedStock !== '' || form.litresSold !== ''
        ? String(opening + received - loaded)
        : ''
    }
    if (def.type === 'commissions') {
      const paid = Number(form.amountPaid || 0)
      // Blank until the figure they are measured against is entered — an
      // outstanding of "0" against an unfilled Commission due reads as
      // settled when nothing is known yet.
      out.commissionOutstanding = form.commissionDue !== ''
        ? String(Number(form.commissionDue || 0) - paid)
        : ''
      out.fundsRemaining = form.fundsReceived !== ''
        ? String(Number(form.fundsReceived || 0) - paid)
        : ''
    }
    return out
  }, [
    def.type, bands, form.amountPaid, form.openingStock, form.receivedStock,
    form.litresSold, form.commissionDue, form.fundsReceived,
  ])

  // Filtered by type in SQL and paged by the server — one page number, not the
  // two the upstream version used, which skipped records on every "next".
  const { data, isLoading } = useQuery({
    queryKey: ['daily-reports', def.type, page],
    queryFn: async () => {
      const res = await api.get('/daily-reports', {
        params: { reportType: def.type, page, limit: PAGE_SIZE },
      })
      return res.data.data as { reports: any[]; pagination?: { total: number; pages?: number } }
    },
  })

  const rows = data?.reports ?? []
  const total = data?.pagination?.total ?? rows.length
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const reset = () => {
    setForm(blankForm(def))
    setBands([])
    setTopRows(def.type === 'it_compliance' ? emptyTopRows() : [])
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
        if (v === '') continue
        payload[k] = numericKeys.has(k) ? Number(v) : v
      }
      for (const f of allFields(def)) {
        if (!f.computed) continue
        const v = computed[f.key]
        if (v === undefined || v === '') continue
        payload[f.key] = Number(v)
      }
      if (def.type === 'sales_manager') {
        payload.priceBands = bands
          .filter((b) => b.price !== '' && b.litres !== '')
          .map((b) => ({ price: Number(b.price), litres: Number(b.litres) }))
      }
      if (def.type === 'it_compliance') {
        payload.topCustomers = topRows
          .filter((r) => r.name.trim())
          .map((r) => ({ name: r.name.trim(), phone: r.phone.trim(), litres: Number(r.litres || 0) }))
      }
      return editingId
        ? (await api.patch(`/daily-reports/${editingId}`, payload)).data
        : (await api.post('/daily-reports', payload)).data
    },
    onSuccess: (res) => {
      toast.success(res?.message || (editingId ? 'Report updated' : 'Report submitted'))
      qc.invalidateQueries({ queryKey: ['daily-reports', def.type] })
      reset()
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const remove = useMutation({
    retry: false,
    mutationFn: async (id: number) => (await api.delete(`/daily-reports/${id}`)).data,
    onSuccess: () => {
      toast.success('Report deleted')
      qc.invalidateQueries({ queryKey: ['daily-reports', def.type] })
      setConfirmDelete(null)
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const edit = (r: any) => {
    const next = blankForm(def)
    next.reportDate = String(r.reportDate ?? '').slice(0, 10)
    next.location = r.location ?? ''
    next.pfiNumber = r.pfiNumber ?? ''
    for (const f of allFields(def)) {
      if (f.type === 'priceBands' || f.type === 'topCustomers' || f.computed) continue
      next[f.key] = r[f.key] == null ? '' : String(r[f.key])
    }
    setForm(next)
    if (def.type === 'sales_manager') {
      const loaded = Array.isArray(r.priceBands) ? r.priceBands : []
      setBands(loaded.map((b: any) => ({ price: String(b.price ?? ''), litres: String(b.litres ?? '') })))
    }
    if (def.type === 'it_compliance') {
      const loaded = Array.isArray(r.topCustomers) ? r.topCustomers : []
      const padded = [...loaded, ...emptyTopRows()].slice(0, 5)
      setTopRows(padded.map((c: any) => ({
        name: c.name ?? '', phone: c.phone ?? '', litres: c.litres != null && c.litres !== '' ? String(c.litres) : '',
      })))
    }
    setEditingId(r.id)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  /**
   * Download is a separate action, not a side effect of saving.
   *
   * Upstream every submit *and every edit* silently dropped a PDF into the
   * user's downloads, so correcting a typo left a second file behind.
   */
  const download = async (r: any) => {
    const { jsPDF } = await import('jspdf')
    const autoTable = (await import('jspdf-autotable')).default
    const doc = new jsPDF()

    doc.setFillColor(0, 86, 60)
    doc.rect(0, 0, 210, 26, 'F')
    doc.setTextColor(255).setFontSize(13)
    doc.text('SOROMAN ENERGY LIMITED', 14, 12)
    doc.setFontSize(9).text(def.pdfTitle.toUpperCase(), 14, 19)

    doc.setTextColor(0).setFontSize(9)
    doc.text(`Generated ${format(new Date(), 'd MMM yyyy, HH:mm')}`, 14, 34)

    const body: string[][] = [
      ['Date', r.reportDate ? format(new Date(r.reportDate), 'd MMM yyyy') : '—'],
      ['Location', r.location || '—'],
      ['PFI', r.pfiNumber || '—'],
      ['Submitted by', r.submittedByName || '—'],
    ]
    for (const f of allFields(def)) {
      if (f.type === 'priceBands') {
        for (const b of (Array.isArray(r.priceBands) ? r.priceBands : [])) {
          body.push([`Price ${money(b.price)}`, `${num(b.litres)} L`])
        }
        continue
      }
      if (f.type === 'topCustomers') {
        (Array.isArray(r.topCustomers) ? r.topCustomers : []).forEach((c: any, i: number) => {
          body.push([`Top customer #${i + 1}`, `${c.name || '—'} · ${c.phone || '—'} · ${num(c.litres)} L`])
        })
        continue
      }
      // columnValue, not r[f.key]: the commission report's outstanding and
      // remaining figures are derived rather than stored, and reading the row
      // directly would silently drop them from the PDF.
      const v = columnValue(r, f.key)
      if (v == null || v === '') continue
      body.push([f.label, f.type === 'money' ? money(v) : String(v)])
    }

    autoTable(doc, { startY: 40, body, styles: { fontSize: 9, cellPadding: 2.5 } })
    const stamp = r.reportDate ? format(new Date(r.reportDate), 'yyyyMMdd') : 'report'
    doc.save(`${def.filePrefix}_${(r.location || 'ALL').replace(/\s+/g, '')}_${stamp}.pdf`)
  }

  const ready = form.reportDate !== '' && (def.requireLocation === false || form.location.trim() !== '')

  return (
    <div className="space-y-6">
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
                placeholder="Choose a PFI, or type it"
                onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground/70">
                {form.pfiNumber ? "From the PFI." : 'Filled in when you pick a PFI.'}
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
                    return <PriceBandsEditor key={f.key} bands={bands} onChange={setBands} />
                  }
                  if (f.type === 'topCustomers') {
                    return <TopCustomersEditor key={f.key} rows={topRows} onChange={setTopRows} />
                  }
                  if (f.computed) {
                    return <ComputedField key={f.key} field={f} value={computed[f.key] ?? ''} />
                  }
                  return (
                    <Field
                      key={f.key}
                      field={f}
                      value={form[f.key] ?? ''}
                      onChange={(v) => setForm((prev) => ({ ...prev, [f.key]: v }))}
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

      <section className={PANEL}>
        <div className={PANEL_RAIL}>
          <span className={cn(MICRO, 'text-muted-foreground')}>Your submissions</span>
          {total > 0 && <span className="text-sm text-muted-foreground">{total} filed</span>}
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="animate-spin" /></div>
        ) : rows.length === 0 ? (
          <PageEmpty title="No reports submitted yet" description="Fill the form above to file your first one." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead className="hidden md:table-cell">PFI</TableHead>
                  {def.columns.map((c) => (
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
                    {def.columns.map((c) => {
                      const v = columnValue(r, c.key)
                      return (
                        <TableCell key={c.key} className={c.align === 'right' ? 'text-right' : undefined}>
                          {c.money ? money(v) : num(v)}
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
    </div>
  )
}
