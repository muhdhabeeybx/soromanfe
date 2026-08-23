import { Fragment, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { format } from 'date-fns'
import {
  Search, X, Loader2, Landmark, User, CreditCard,
  Hash, Clock, FileText, Info, Banknote, Droplets, TrendingUp,
  FileSpreadsheet, ArrowRight, Trash2, RefreshCw, Unlink,
} from 'lucide-react'

import { PageHeader } from '#/components/PageHeader'
import { StatCard, StatCardGrid } from '#/components/ui/stat-card'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { NativeSelect } from '#/components/ui/native-select'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '#/components/ui/table'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '#/components/ui/dialog'
import { PageLoader } from '#/components/PageLoader'
import { PageError } from '#/components/PageError'
import { PageEmpty } from '#/components/PageEmpty'
import { FilterBar } from '#/components/FilterBar'
import { MICRO, PANEL, PANEL_RAIL, PANEL_BODY } from '#/lib/panel'
import { cn } from '#/lib/utils'
import { naira } from '#/routes/pfi/-pfi-utils'
import { DATE_PRESETS, resolveRange, type DatePreset } from '#/routes/orders/-orders-utils'
import { routeGuard } from '#/lib/route-guard'
import {
  useFinanceReport, isPaystackFunding, fundingRecorder, fundingDepositor, fundingPaidAt, fundingReference,
  orderPaidInto, orderCompany,
  type FinanceReportOrder, type OrderFunding,
} from '#/lib/hooks/useFinanceReport'
import { useDepotsForFilter, usePfiList, type PfiWithFinancials } from '#/lib/hooks/usePfis'
import { useProductList } from '#/lib/hooks/useProducts'
import { RematchFundingDialog } from '#/components/RematchFundingDialog'
import { useDeleteOrder } from '#/lib/hooks/useOrders'
import { useUnmatchDeposit } from '#/lib/hooks/useDeposits'
import { useRoles } from '#/lib/hooks/useRoles'
import {
  exportFinanceReportExcel, exportFinanceReportPdf,
  FIRST_FUNDING_COLUMN_INDEX, SHARED_AMOUNT_COLUMN_INDEX, MIDDLE_BLANKS_AFTER_AMOUNT, TOTAL_COLUMN_COUNT,
  type FinanceReportFilters, type FinanceReportSummary, type PfiStockRow,
} from './-finance-report-export'

// The screen table mirrors the export's column set exactly (see COLUMNS in
// -finance-report-export.ts) — these derived counts are what make the
// funding sub-row's blank cells land under the right headers without a
// magic number to keep in sync by hand.
const LEADING_BLANKS_FOR_FUNDING_ROW = SHARED_AMOUNT_COLUMN_INDEX
const TRAILING_BLANKS_FOR_ORDER_ROW = TOTAL_COLUMN_COUNT - FIRST_FUNDING_COLUMN_INDEX

export const Route = createFileRoute('/confirmed-payments/')({
  beforeLoad: () => routeGuard('/confirmed-payments'),
  component: FinanceReportPage,
})

const ALL = ''

/** A depot or PFI as offered in a filter dropdown — shapes loose enough to cover both. */
type FilterOption = {
  id?: string | number
  _id?: string
  name?: string
  pfiNumber?: string
  locationId?: string | number | null
  locationName?: string
}

/** Some legacy rows carry `_id` instead of a numeric `id` — accept either. */
const idOf = (x: FilterOption) => String(x?.id ?? x?._id ?? '')

function Row({ label, value, icon: Icon }: { label: string; value: React.ReactNode; icon?: any }) {
  if (!value) return null
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground font-normal uppercase flex items-center gap-1.5">
        {Icon && <Icon className="size-3" />} {label}
      </p>
      <p className="text-sm font-semibold text-foreground">{value}</p>
    </div>
  )
}

function SummaryItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className={cn(MICRO, 'text-muted-foreground')}>{label}</p>
      <p className="mt-0.5 truncate text-sm font-semibold text-foreground">{value}</p>
    </div>
  )
}

/**
 * One funding entry — how the deposit behind this order's wallet balance
 * originally landed. Paystack is not a live integration; the gateway-specific
 * breakdown below is commented out on purpose and kept only for reference —
 * see isPaystackFunding.
 */
function FundingCard({ funding, onUnmatch }: { funding: OrderFunding; onUnmatch?: () => void }) {
  const ps = (funding.paystackDetails || {}) as Record<string, any>
  const paystack = isPaystackFunding(funding)
  const recorder = fundingRecorder(funding) || null

  return (
    <div className="rounded-lg border border-warning/20 bg-warning/5 p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <Badge className="bg-warning/15 text-warning border-warning/30 font-normal">
          {paystack ? 'Legacy deposit record' : 'Manual Bank Transfer'}
        </Badge>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{naira(Number(funding.amount))}</span>
          {onUnmatch && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
              onClick={onUnmatch}
            >
              <Unlink className="size-3.5" />
              Unmatch
            </Button>
          )}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {/* Paystack gateway breakdown — kept for historical reference only,
        not rendered: Paystack is not a live payment integration here.
        {paystack && (
          <>
            <Row label="Sender name" value={ps.senderName} icon={Send} />
            <Row label="Sender bank" value={ps.senderBankName} icon={Landmark} />
            <Row label="Sender account" value={ps.senderAccountNumber} icon={CreditCard} />
            <Row label="Sender country" value={ps.senderCountry} icon={Globe} />
            <Row label="DVA (receiver) bank" value={ps.receiverBankName} icon={Landmark} />
            <Row label="DVA account number" value={ps.receiverAccountNumber} icon={CreditCard} />
            <Row label="DVA account name" value={ps.receiverAccountName} icon={User} />
            <Row label="Gateway status" value={ps.gatewayResponse || ps.status} icon={ShieldCheck} />
            <Row label="Currency" value={ps.currency} icon={Banknote} />
            <Row label="Fees" value={ps.fees != null ? naira(Number(ps.fees)) : undefined} />
            <Row label="Transaction ID" value={ps.transactionId} icon={Hash} />
            <Row label="Narration" value={ps.senderNarration} icon={FileText} />
          </>
        )} */}
        {!paystack && (
          <>
            <Row label="Depositor / payer" value={fundingDepositor(funding)} icon={User} />
            <Row label="Receiving bank" value={ps.bankName || ps.receiverBankName} icon={Landmark} />
            <Row label="Receiving account name" value={ps.accountName || ps.receiverAccountName} icon={User} />
            <Row label="Receiving account number" value={ps.accountNumber || ps.receiverAccountNumber} icon={CreditCard} />
            <Row
              label="Payment date"
              value={fundingPaidAt(funding) ? format(new Date(String(fundingPaidAt(funding))), 'd MMM yyyy') : undefined}
              icon={Clock}
            />
          </>
        )}
        <Row label="Deposit reference" value={fundingReference(funding)} icon={Hash} />
        <Row label="Recorded by" value={recorder} icon={User} />
      </div>
    </div>
  )
}

function OrderDetailDialog({ order, open, onOpenChange, onRematch, onUnmatch }: { order: FinanceReportOrder | null; open: boolean; onOpenChange: (o: boolean) => void; onRematch?: () => void; onUnmatch?: (f: OrderFunding) => void }) {
  if (!order) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{naira(Number(order.totalAmount))}</DialogTitle>
          <DialogDescription>
            {order.reference} · {order.customerName || 'Unknown customer'}
          </DialogDescription>
        </DialogHeader>

        <div className="divide-y divide-foreground/10">
          <div className="pb-3">
            <p className={cn(MICRO, 'pb-1 text-muted-foreground')}>Order</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Row label="Reference" value={order.reference} />
              <Row label="Status" value={order.status} />
              <Row label="Confirmed" value={order.paymentConfirmedAt ? format(new Date(order.paymentConfirmedAt), 'd MMM yyyy, HH:mm') : undefined} />
              <Row label="Location" value={order.depotName} />
              <Row label="PFI" value={order.pfiNumber} />
              <Row label="PFI location" value={order.pfiLocationName} />
              <Row label="Product" value={order.productName} />
              <Row label="Quantity" value={order.quantity ? `${Number(order.quantity).toLocaleString()} L` : undefined} />
              <Row label="Delivery type" value={order.deliveryType} />
              <Row label="Order DVA" value={[order.virtualAccountBank, order.virtualAccountNumber].filter(Boolean).join(' · ')} />
            </div>
          </div>

          <div className="py-3">
            <p className={cn(MICRO, 'pb-1 text-muted-foreground')}>Customer</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Row label="Name" value={order.customerName} />
              <Row label="Phone" value={order.customerPhone} />
              <Row label="Email" value={order.customerEmail} />
              <Row label="Company" value={order.customerCompanyName} />
              <Row label="Standing DVA" value={[order.customerVirtualAccountBank, order.customerVirtualAccountNumber].filter(Boolean).join(' · ')} />
            </div>
          </div>

          <div className="py-3">
            <p className={cn(MICRO, 'pb-1 text-muted-foreground')}>Wallet</p>
            {order.walletBalanceBefore == null ? (
              <p className="rounded-lg border border-foreground/15 bg-muted/40 p-3 text-sm text-muted-foreground">
                This order predates wallet-hold tracking — before/after balances aren't available.
              </p>
            ) : (
              <div className="grid grid-cols-3 items-center rounded-lg border border-foreground/15 bg-muted/30 p-3">
                <div className="text-center">
                  <p className="text-xs text-muted-foreground uppercase">Before</p>
                  <p className="mt-0.5 text-sm font-semibold text-foreground">{naira(order.walletBalanceBefore)}</p>
                </div>
                <div className="flex flex-col items-center gap-0.5 border-x border-foreground/10 px-2 text-center">
                  <ArrowRight className="size-3.5 text-muted-foreground" />
                  <p className="text-xs font-semibold text-destructive">-{naira(Number(order.totalAmount))}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-muted-foreground uppercase">After</p>
                  <p className="mt-0.5 text-sm font-semibold text-foreground">{naira(order.walletBalanceAfter)}</p>
                </div>
              </div>
            )}
          </div>

          <div className="py-3 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className={cn(MICRO, 'text-muted-foreground')}>
                Payment source{order.funding.length ? ` (${order.funding.length})` : ''}
              </p>
              {order.paymentStatus === 'Paid' && onRematch && (
                <Button variant="outline" size="sm" onClick={onRematch}>
                  <RefreshCw data-icon="inline-start" />
                  Re-match
                </Button>
              )}
            </div>
            {!order.fundingTracked ? (
              <p className="rounded-lg border border-foreground/15 bg-muted/40 p-3 text-sm text-muted-foreground">
                Payment source not tracked — this order was paid before detailed payment tracking began.
              </p>
            ) : (
              <>
                {order.funding.map((f) => (
                  <FundingCard
                    key={f.depositId}
                    funding={f}
                    onUnmatch={onUnmatch ? () => onUnmatch(f) : undefined}
                  />
                ))}
                {order.unattributedAmount > 0 && (
                  <p className="rounded-lg border border-foreground/15 bg-muted/40 p-3 text-sm text-muted-foreground flex items-center gap-2">
                    <Info className="size-4 shrink-0" />
                    {naira(order.unattributedAmount)} of this payment came from wallet balance that predates detailed tracking.
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function FinanceReportPage() {
  const [search, setSearch] = useState('')
  const [datePreset, setDatePreset] = useState<DatePreset>('today')
  const [customDate, setCustomDate] = useState('')
  const [paymentStatus, setPaymentStatus] = useState<'Paid' | 'Unpaid' | 'all'>('Paid')
  const [locationId, setLocationId] = useState(ALL)
  const [pfiId, setPfiId] = useState(ALL)
  const [productId, setProductId] = useState(ALL)
  const [viewing, setViewing] = useState<FinanceReportOrder | null>(null)
  const [deleting, setDeleting] = useState<FinanceReportOrder | null>(null)
  const [rematching, setRematching] = useState<FinanceReportOrder | null>(null)
  const [unmatching, setUnmatching] = useState<{ order: FinanceReportOrder; funding: OrderFunding } | null>(null)
  const unmatchDeposit = useUnmatchDeposit()
  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null)
  const { isSuperAdmin: canDelete } = useRoles()
  const deleteOrderMutation = useDeleteOrder()

  const range = useMemo(
    () => resolveRange(datePreset, { from: customDate ? new Date(customDate) : undefined }),
    [datePreset, customDate],
  )
  const dateFrom = range ? range.from.toISOString() : undefined
  const dateTo = range ? range.to.toISOString() : undefined
  const periodLabel = datePreset === 'custom'
    ? (customDate ? format(new Date(customDate), 'd MMM yyyy') : 'Custom date')
    : (DATE_PRESETS.find((p) => p.value === datePreset)?.label ?? 'All Time')

  const { data, isLoading, isError, error, refetch, isFetching } = useFinanceReport({
    search: search || undefined,
    dateFrom,
    dateTo,
    paymentStatus,
    depotId: locationId || undefined,
    pfiId: pfiId || undefined,
    productId: productId || undefined,
  })

  const { data: depots = [] } = useDepotsForFilter()
  const { data: pfiData } = usePfiList({ limit: 500 })
  const pfis: PfiWithFinancials[] = useMemo(() => pfiData?.pfis || [], [pfiData])
  const { data: productData } = useProductList()
  const products: Array<{ id?: string | number; _id?: string; name?: string }> = useMemo(() => {
    if (!productData) return []
    return Array.isArray(productData) ? productData : productData.products || []
  }, [productData])

  // Once a location is picked, only PFIs at that location are worth offering.
  const pfiOptions = useMemo(() => {
    if (!locationId) return pfis
    return pfis.filter((p) => String(p.locationId ?? '') === String(locationId))
  }, [pfis, locationId])

  const rows = useMemo(() => data?.orders || [], [data])
  const totals = data?.totals
  const hasFilters = !!(
    search || paymentStatus !== 'Paid' || locationId || pfiId || productId || datePreset !== 'today'
  )

  const selectedDepot = useMemo(() => depots.find((d) => idOf(d) === locationId), [depots, locationId])
  const selectedPfi = useMemo(() => pfis.find((p) => idOf(p) === pfiId), [pfis, pfiId])
  const selectedProduct = useMemo(() => products.find((p) => idOf(p) === productId), [products, productId])

  // A location can be implied by the PFI alone — "location of the PFI
  // selected" should still read correctly with no location filter set.
  const locationName = selectedDepot?.name || selectedPfi?.locationName || 'All locations'
  const productName = selectedProduct?.name || selectedPfi?.productName || 'All products'

  // Rows are the whole filtered set (no pagination), so summing them here is
  // exactly the aggregate a backend query would produce — no separate
  // endpoint needed for figures useFinanceReport's own totals don't cover.
  const totalSalesValue = useMemo(
    () => rows.reduce((sum, o) => sum + Number(o.price || 0) * Number(o.quantity || 0), 0),
    [rows],
  )

  const summary: FinanceReportSummary = {
    count: totals?.count ?? 0,
    totalQuantity: totals?.totalQuantity ?? 0,
    totalSalesValue,
    totalAmountPaid: totals?.totalAmount ?? 0,
    initialStock: selectedPfi ? selectedPfi.startingQtyLitres ?? 0 : null,
    tankBalanceAfter: selectedPfi ? selectedPfi.financials?.remaining ?? 0 : null,
  }
  // An order isn't marked Paid until its wallet hold covers the total in
  // full, so this is normally 0 — nonzero only when a total was corrected
  // by hand after the order was already paid.
  const totalOutstanding = summary.totalSalesValue - summary.totalAmountPaid

  // Every active PFI, period-sold worked out from these same filtered rows
  // rather than a separate query — the two figures can never disagree about
  // what counts as "sold" this way. A row whose PFI has since finished (and
  // so isn't in the active list) still counts toward the reconciliation
  // note below, just not as its own line in the block.
  const pfiStock: PfiStockRow[] = useMemo(() => {
    const soldByPfi = new Map<number, number>()
    for (const o of rows) {
      if (o.pfiId == null) continue
      soldByPfi.set(o.pfiId, (soldByPfi.get(o.pfiId) || 0) + Number(o.quantity || 0))
    }
    return pfis
      .filter((p) => p.status === 'active')
      .map((p) => ({
        pfiNumber: p.pfiNumber,
        locationName: p.locationName || '—',
        productName: p.productName || '—',
        initialStock: p.startingQtyLitres ?? 0,
        volumeSoldPeriod: soldByPfi.get(Number(p.id ?? p._id)) || 0,
        volumeSoldAllTime: p.financials?.sold ?? 0,
        volumeRemaining: p.financials?.remaining ?? 0,
        revenue: p.financials?.revenue ?? 0,
      }))
  }, [pfis, rows])

  // Reconciles the Stock Summary block against the Total Quantity card: the
  // period-sold column only covers active PFIs, so litres sold on a PFI
  // that has since finished (or was otherwise dropped from the active list)
  // have to be added back separately to land on the same number.
  const reconciliationNote = useMemo(() => {
    const listedPfiIds = new Set(pfis.filter((p) => p.status === 'active').map((p) => Number(p.id ?? p._id)))
    const qtyOnUnlistedPfis = rows.reduce((sum, o) => {
      if (o.pfiId == null || listedPfiIds.has(o.pfiId)) return sum
      return sum + Number(o.quantity || 0)
    }, 0)
    const periodSoldOnListed = pfiStock.reduce((sum, p) => sum + p.volumeSoldPeriod, 0)
    if (search || productId) {
      return 'A search or product filter is active, so the period-sold total above and the Total Quantity card are not expected to match right now.'
    }
    return qtyOnUnlistedPfis > 0
      ? `Period sold on the PFIs listed (${periodSoldOnListed.toLocaleString()} L) plus ${qtyOnUnlistedPfis.toLocaleString()} L on PFIs no longer active accounts for the ${summary.totalQuantity.toLocaleString()} L on the Total Quantity card.`
      : `Period sold across every PFI listed accounts for the full ${summary.totalQuantity.toLocaleString()} L on the Total Quantity card — every order in view this period belongs to a PFI still active.`
  }, [pfis, rows, pfiStock, search, productId, summary.totalQuantity])

  const exportFilters: FinanceReportFilters = {
    periodLabel,
    dateFrom: range ? format(range.from, 'yyyy-MM-dd') : '',
    dateTo: range ? format(range.to, 'yyyy-MM-dd') : '',
    paymentStatus: paymentStatus === 'all' ? 'All' : paymentStatus,
    search,
    locationName,
    pfiNumber: selectedPfi?.pfiNumber || 'All PFIs',
    product: productName,
  }

  const clearFilters = () => {
    setSearch(''); setPaymentStatus('Paid'); setLocationId(ALL); setPfiId(ALL); setProductId(ALL)
    setDatePreset('today'); setCustomDate('')
  }

  const runExport = async (kind: 'excel' | 'pdf') => {
    if (!rows.length) return
    setExporting(kind)
    try {
      if (kind === 'excel') await exportFinanceReportExcel(rows, summary, exportFilters, pfiStock)
      else await exportFinanceReportPdf(rows, summary, exportFilters, pfiStock)
    } finally {
      setExporting(null)
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        eyebrow="Finance"
        title="Finance Report"
        description="Every confirmed payment, order by order — the customer, the order, and the wallet it drew from."
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => runExport('excel')} disabled={!rows.length || exporting !== null}>
              {exporting === 'excel' ? <Loader2 className="animate-spin" /> : <FileSpreadsheet data-icon="inline-start" />}
              Excel
            </Button>
            <Button size="sm" variant="outline" onClick={() => runExport('pdf')} disabled={!rows.length || exporting !== null}>
              {exporting === 'pdf' ? <Loader2 className="animate-spin" /> : <FileText data-icon="inline-start" />}
              PDF
            </Button>
          </div>
        }
      />

      {!isLoading && !isError && totals && (
        <StatCardGrid count={3}>
          <StatCard
            icon={<Droplets />} label="Total Quantity" value={`${summary.totalQuantity.toLocaleString()} L`}
            description={`${totals.count.toLocaleString()} order${totals.count === 1 ? '' : 's'} · ${periodLabel}`}
          />
          <StatCard icon={<Banknote />} label="Sales Value" value={naira(summary.totalSalesValue)} />
          <StatCard
            tone={totalOutstanding > 0 ? 'red' : 'green'}
            icon={<TrendingUp />} label="Amount Paid" value={naira(summary.totalAmountPaid)}
            description={totalOutstanding > 0 ? `${naira(totalOutstanding)} balance outstanding` : undefined}
          />
        </StatCardGrid>
      )}

      <FilterBar>
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search reference, customer, company, location, PFI or payment reference…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <NativeSelect className="w-36" value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value as any)}>
          <option value="Paid">Paid</option>
          <option value="Unpaid">Unpaid</option>
          <option value="all">All</option>
        </NativeSelect>
        <NativeSelect
          className="w-44"
          value={locationId}
          onChange={(e) => { setLocationId(e.target.value); setPfiId(ALL) }}
        >
          <option value={ALL}>All locations</option>
          {depots.map((d) => (
            <option key={idOf(d)} value={idOf(d)}>{d.name}</option>
          ))}
        </NativeSelect>
        <NativeSelect
          className="w-48"
          value={pfiId}
          onChange={(e) => {
            const nextPfiId = e.target.value
            setPfiId(nextPfiId)
            // Picking a PFI directly (without a location filter already set)
            // should still populate the location it belongs to.
            if (nextPfiId) {
              const chosen = pfis.find((p) => idOf(p) === nextPfiId)
              if (chosen?.locationId != null) setLocationId(String(chosen.locationId))
            }
          }}
        >
          <option value={ALL}>All PFIs</option>
          {pfiOptions.map((p) => (
            <option key={idOf(p)} value={idOf(p)}>{p.pfiNumber}</option>
          ))}
        </NativeSelect>
        <NativeSelect className="w-40" value={productId} onChange={(e) => setProductId(e.target.value)}>
          <option value={ALL}>All products</option>
          {products.map((p) => (
            <option key={idOf(p)} value={idOf(p)}>{p.name}</option>
          ))}
        </NativeSelect>
        <div className="flex flex-wrap items-center gap-2">
          {DATE_PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => { setDatePreset(p.value); setCustomDate('') }}
              className={cn(
                'rounded-full border px-3 py-1 text-xs transition-colors duration-250 ease-luxe outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                datePreset === p.value
                  ? 'border-accent/40 bg-accent/10 text-accent'
                  : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        <Input
          type="date"
          value={customDate}
          aria-label="Custom date"
          onChange={(e) => { setCustomDate(e.target.value); setDatePreset('custom') }}
          className="w-40"
        />
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X data-icon="inline-start" />
            Clear
          </Button>
        )}
      </FilterBar>

      <section className={PANEL}>
        <div className={PANEL_RAIL}>
          <span className={MICRO}>Report summary</span>
          {isFetching && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
        </div>
        <div className={cn(PANEL_BODY, 'grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6')}>
          <SummaryItem label="Number of orders" value={summary.count.toLocaleString()} />
          <SummaryItem label="Period" value={periodLabel} />
          <SummaryItem label="Total quantity" value={`${summary.totalQuantity.toLocaleString()} L`} />
          <SummaryItem label="Location" value={locationName} />
          <SummaryItem label="PFI" value={selectedPfi?.pfiNumber || 'All PFIs'} />
          <SummaryItem label="Product" value={productName} />
          <SummaryItem label="Total sales value" value={naira(summary.totalSalesValue)} />
          <SummaryItem label="Total amount paid" value={naira(summary.totalAmountPaid)} />
          {selectedPfi && (
            <>
              <SummaryItem label="Initial stock (PFI)" value={`${(summary.initialStock ?? 0).toLocaleString()} L`} />
              <SummaryItem label="Tank balance after (PFI)" value={`${(summary.tankBalanceAfter ?? 0).toLocaleString()} L`} />
            </>
          )}
        </div>
      </section>

      {!isLoading && !isError && pfiStock.length > 0 && (
        <section className={PANEL}>
          <div className={PANEL_RAIL}>
            <span className={MICRO}>PFI Stock Summary</span>
          </div>
          <div className={cn(PANEL_BODY, 'space-y-3')}>
            <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              Sold counts confirmed customer orders only. {reconciliationNote}
            </p>
            <div className="overflow-x-auto rounded-lg border border-foreground/15">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>PFI</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Initial Stock</TableHead>
                    <TableHead className="text-right">Volume Sold (Period)</TableHead>
                    <TableHead className="text-right">Total Volume Sold</TableHead>
                    <TableHead className="text-right">Volume Remaining</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pfiStock.map((p) => (
                    <TableRow key={p.pfiNumber}>
                      <TableCell className="font-semibold text-accent">{p.pfiNumber}</TableCell>
                      <TableCell className="text-muted-foreground">{p.locationName}</TableCell>
                      <TableCell className="text-muted-foreground">{p.productName}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">{p.initialStock.toLocaleString()} L</TableCell>
                      <TableCell className="text-right whitespace-nowrap font-medium">{p.volumeSoldPeriod.toLocaleString()} L</TableCell>
                      <TableCell className="text-right whitespace-nowrap">{p.volumeSoldAllTime.toLocaleString()} L</TableCell>
                      <TableCell className={cn('text-right whitespace-nowrap', p.volumeRemaining < 0 && 'text-destructive')}>
                        {p.volumeRemaining.toLocaleString()} L
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">{naira(p.revenue)}</TableCell>
                    </TableRow>
                  ))}
                  {/* Only the period-sold column is totalled — initial stock
                      and remaining are per-PFI positions in mixed batches,
                      summing them across PFIs would not mean anything. */}
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableCell colSpan={4} className="text-xs text-muted-foreground">
                      Total ({pfiStock.length} PFI{pfiStock.length === 1 ? '' : 's'})
                    </TableCell>
                    <TableCell className="text-right font-semibold whitespace-nowrap">
                      {pfiStock.reduce((s, p) => s + p.volumeSoldPeriod, 0).toLocaleString()} L
                    </TableCell>
                    <TableCell colSpan={3} />
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </div>
        </section>
      )}

      <div className={cn(PANEL)}>
        {isLoading ? (
          <PageLoader message="Loading finance report…" />
        ) : isError ? (
          <PageError message={(error as any)?.message || 'Failed to load'} onRetry={() => refetch()} />
        ) : rows.length === 0 ? (
          <PageEmpty
            icon={<Banknote />}
            title={hasFilters ? 'No payments match those filters' : 'No confirmed payments yet'}
            description={hasFilters ? 'Try widening the search, date range or location/PFI filters.' : 'Confirmed payments will show up here as orders are paid.'}
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">S/N</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Order Reference</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead className="text-right">Qty (Litres)</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right">Sales Value</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Payment Date</TableHead>
                  <TableHead className="text-right">Amount Paid</TableHead>
                  <TableHead>Paid Into</TableHead>
                  <TableHead>Depositor / Payer</TableHead>
                  <TableHead>Deposit Reference</TableHead>
                  <TableHead>Deposit Date</TableHead>
                  <TableHead>Recorded By</TableHead>
                  {canDelete && <TableHead className="text-right">Delete</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((o, i) => {
                  const salesValue = Number(o.price) * Number(o.quantity || 0)
                  const company = orderCompany(o)
                  return (
                  <Fragment key={o.id}>
                    <TableRow className="cursor-pointer" onClick={() => setViewing(o)}>
                      <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {o.createdAt ? format(new Date(o.createdAt), 'd MMM yyyy') : '—'}
                      </TableCell>
                      <TableCell className="font-mono text-xs font-semibold whitespace-nowrap">{o.reference}</TableCell>
                      <TableCell className="max-w-[10rem] truncate font-medium">{o.customerName || '—'}</TableCell>
                      {/* Blank, not a dash, when the customer has no company
                          saved — never the order's own typed-in company. */}
                      <TableCell className="max-w-[10rem] truncate text-muted-foreground">{company}</TableCell>
                      <TableCell className="text-right font-medium whitespace-nowrap">{Number(o.quantity || 0).toLocaleString()}</TableCell>
                      <TableCell className="text-muted-foreground">{o.productName || '—'}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">{naira(Number(o.price))}</TableCell>
                      <TableCell className="text-right whitespace-nowrap font-medium">{naira(salesValue)}</TableCell>
                      <TableCell className="max-w-[10rem] truncate text-muted-foreground">{o.depotName || '—'}</TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {o.paymentConfirmedAt ? format(new Date(o.paymentConfirmedAt), 'd MMM yyyy') : '—'}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap font-semibold">{naira(Number(o.totalAmount))}</TableCell>
                      <TableCell className="max-w-[16rem] truncate text-muted-foreground">{orderPaidInto(o) || '—'}</TableCell>
                      {Array.from({ length: TRAILING_BLANKS_FOR_ORDER_ROW }).map((_, blankIdx) => (
                        <TableCell key={blankIdx} />
                      ))}
                      {canDelete && (
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          <Button
                            variant="ghost" size="icon-sm"
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => setDeleting(o)}
                          >
                            <Trash2 />
                            <span className="sr-only">Delete {o.reference}</span>
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                    {o.fundingTracked && o.funding.map((f) => (
                      <TableRow key={`${o.id}-funding-${f.depositId}`} className="bg-muted/20 hover:bg-muted/30">
                        <TableCell colSpan={LEADING_BLANKS_FOR_FUNDING_ROW} />
                        <TableCell className="text-right whitespace-nowrap">{naira(Number(f.amount))}</TableCell>
                        {Array.from({ length: MIDDLE_BLANKS_AFTER_AMOUNT }).map((_, blankIdx) => (
                          <TableCell key={blankIdx} />
                        ))}
                        <TableCell className="max-w-[10rem] truncate">{fundingDepositor(f) || '—'}</TableCell>
                        <TableCell className="max-w-[10rem] truncate">{fundingReference(f) || '—'}</TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {fundingPaidAt(f) ? format(new Date(String(fundingPaidAt(f))), 'd MMM yyyy') : '—'}
                        </TableCell>
                        <TableCell className="max-w-[10rem] truncate">{fundingRecorder(f) || '—'}</TableCell>
                        {canDelete && <TableCell />}
                      </TableRow>
                    ))}
                  </Fragment>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <OrderDetailDialog
        order={viewing}
        open={!!viewing}
        onOpenChange={(o) => !o && setViewing(null)}
        onRematch={() => { setRematching(viewing); setViewing(null) }}
        onUnmatch={(f) => viewing && setUnmatching({ order: viewing, funding: f })}
      />

      <RematchFundingDialog
        order={rematching}
        open={rematching !== null}
        onOpenChange={(o) => { if (!o) setRematching(null) }}
      />

      {/* Detach one statement match so its line can go to the order it really
          belongs to. Distinct from Re-match: this leaves the order with less
          funding rather than swapping a replacement in, so the server refuses
          it whenever that money is what a live order's hold is holding — which
          is most of the time here. The copy says so up front rather than
          letting the refusal be the first the user hears of it. */}
      <Dialog open={unmatching != null} onOpenChange={(open) => !open && setUnmatching(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unmatch this payment?</DialogTitle>
            <DialogDescription>
              {unmatching && (
                <>
                  This takes {naira(Number(unmatching.funding.amount))}
                  {fundingDepositor(unmatching.funding) ? ` from ${fundingDepositor(unmatching.funding)}` : ''} off{' '}
                  {unmatching.order.reference} and back out of the wallet, returning its bank
                  statement line to the unmatched pool so it can be matched elsewhere.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <p className="rounded-lg border border-foreground/15 bg-muted/40 p-3 text-sm text-muted-foreground">
            If this money is what currently funds a live order, this will be refused — nothing
            will change. Use <span className="font-semibold text-foreground">Re-match</span> on
            that order instead, which swaps the correct line in rather than leaving it unfunded.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUnmatching(null)} disabled={unmatchDeposit.isPending}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              disabled={unmatchDeposit.isPending}
              onClick={async () => {
                if (!unmatching) return
                try {
                  await unmatchDeposit.mutateAsync({ id: unmatching.funding.depositId })
                  setUnmatching(null)
                } catch {
                  // Refused — the hook has already surfaced the server's own
                  // message. The dialog stays open so the reason sits next to
                  // the action it explains.
                }
              }}
            >
              {unmatchDeposit.isPending && <Loader2 className="animate-spin" />}
              Unmatch payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Names what goes with it — the same delete the Orders page offers,
          reachable here too since this is often where a mistaken payment is
          first noticed. */}
      <Dialog open={deleting != null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deleting?.reference}?</DialogTitle>
            <DialogDescription>
              This permanently removes the order and everything attached to it — its tickets,
              allocated trucks, commissions, wallet holds and stock movements. Only the audit
              entry survives. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>Keep it</Button>
            <Button
              variant="destructive"
              disabled={deleteOrderMutation.isPending}
              onClick={async () => {
                if (!deleting) return
                await deleteOrderMutation.mutateAsync(deleting.id)
                setDeleting(null)
              }}
            >
              Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
