import { Fragment, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { format } from 'date-fns'
import {
  Search, X, Loader2, Landmark, User, CreditCard,
  Hash, Clock, FileText, Info, Banknote, Droplets, TrendingUp,
  FileSpreadsheet, ArrowRight, RefreshCw, Unlink, Wallet,
  ArrowUpCircle, ArrowDownCircle, Repeat, Scale, AlertTriangle,
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
import { cn, toNum } from '#/lib/utils'
import { naira } from '#/routes/pfi/-pfi-utils'
import { DATE_PRESETS, resolveRange, type DatePreset } from '#/routes/orders/-orders-utils'
import { routeGuard } from '#/lib/route-guard'
import {
  useFinanceReport, isPaystackFunding, fundingRecorder, fundingDepositor, fundingPaidAt, fundingReference, fundingAmount,
  orderPaidInto, orderCompany, orderDifferential, orderAmountPaid,
  paymentBreakdown, isInternalTransfer, carriedFromOrder, fundingSource, walletOriginLabel,
  fundingApplied, transferOutLabel, transferAmount, untracedAmount, untracedReason, untracedLabel,
  walletStatementRows,
  type FinanceReportOrder, type OrderFunding, type StatementRow,
} from '#/lib/hooks/useFinanceReport'
import { useDepotsForFilter, usePfiList, type PfiWithFinancials } from '#/lib/hooks/usePfis'
import { useProductList } from '#/lib/hooks/useProducts'
import { RematchFundingDialog } from '#/components/RematchFundingDialog'
import { ConfirmOrderPaymentDialog } from '#/components/ConfirmOrderPaymentDialog'
import { useUnmatchDeposit } from '#/lib/hooks/useDeposits'
import {
  exportFinanceReportExcel, exportFinanceReportPdf, REPORT_COLUMNS,
  type FinanceReportFilters, type FinanceReportSummary, type PfiStockRow,
} from './-finance-report-export'

// Which columns render right-aligned — the numeric ones. Everything else
// about the table's shape comes from REPORT_COLUMNS itself (see COLUMNS in
// -finance-report-export.ts), so the screen and the exports cannot drift.
const NUMERIC_COLUMNS = new Set(['qty', 'rate', 'salesValue', 'amount', 'transfers', 'differential'])

export const Route = createFileRoute('/confirmed-payments/')({
  beforeLoad: () => routeGuard('/confirmed-payments'),
  component: FinanceReportPage,
})

/**
 * What the payment-status picker can ask for.
 *
 * 'received' is a client-side sentinel, not a server value: it means "don't
 * filter on payment status at all", which the server answers with Paid and
 * Part Paid together. Everything else is passed straight through.
 */
type PaymentFilter = 'received' | 'Paid' | 'Part Paid' | 'Unpaid' | 'all'

/** How each choice is named on an exported report's caption. */
const PAYMENT_FILTER_LABEL: Record<PaymentFilter, string> = {
  received: 'Money received (paid & part paid)',
  Paid: 'Paid in full',
  'Part Paid': 'Part paid',
  Unpaid: 'Unpaid',
  all: 'All',
}

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

/**
 * `tone` is only ever passed for a figure whose SIGN means something — a
 * differential, a shortfall. Everything else stays foreground, so red and
 * green never become decoration and always read as the same fact.
 */
/**
 * The report's colour language, defined once.
 *
 * Three meanings, and only these three, wherever a figure appears — the
 * table, this summary, and both exports:
 *
 *   red    money still owed
 *   green  money received beyond what was billed
 *   blue   money that moved inside the business, never through a bank
 *
 * Colour is never decoration here. A figure with no sign to carry stays
 * foreground, so red and green always mean the same thing at a glance.
 */
const TONE_CLASS = {
  plain: 'text-foreground',
  owed: 'text-destructive',
  over: 'text-accent',
  internal: 'text-blue-600 dark:text-blue-400',
} as const

const TONE_CHIP = {
  plain: 'bg-muted text-muted-foreground ring-border',
  owed: 'bg-destructive/10 text-destructive ring-destructive/20',
  over: 'bg-accent/10 text-accent ring-accent/20',
  internal: 'bg-blue-50 text-blue-700 ring-blue-100 dark:bg-blue-950 dark:text-blue-300 dark:ring-blue-900',
} as const

type Tone = keyof typeof TONE_CLASS

function SummaryItem({
  label,
  value,
  tone = 'plain',
  hint,
  icon: Icon,
}: {
  label: string
  value: React.ReactNode
  tone?: Tone
  hint?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon?: any
}) {
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      {Icon && (
        <span className={cn('mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset', TONE_CHIP[tone])}>
          <Icon className="size-3.5" />
        </span>
      )}
      <div className="min-w-0">
        <p className={cn(MICRO, 'text-muted-foreground')}>{label}</p>
        {/* Deliberately NOT truncated. These are money figures a person is
            checking against their own arithmetic — half of "11,008,487,207.00"
            is worse than a second line. */}
        <p className={cn('mt-0.5 text-sm font-semibold break-words', TONE_CLASS[tone])}>
          {value}
        </p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
    </div>
  )
}

/**
 * One funding entry — how the deposit behind this order's wallet balance
 * originally landed. Paystack is not a live integration; the gateway-specific
 * breakdown below is commented out on purpose and kept only for reference —
 * see isPaystackFunding.
 */
function FundingCard({ funding, orderId, onUnmatch }: { funding: OrderFunding; orderId: number; onUnmatch?: () => void }) {
  const ps = (funding.paystackDetails || {}) as Record<string, any>
  const paystack = isPaystackFunding(funding)
  const recorder = fundingRecorder(funding) || null
  const carried = carriedFromOrder(funding, orderId)
  const source = fundingSource(funding)
  const isWallet = source === 'wallet'
  const isTransferOut = source === 'transfer_out'
  // What the order took of it, where that is less than what arrived. Only a
  // bank payment larger than the order it was made for shows this, and it is
  // the sentence that explains the Differential column to whoever is holding
  // the statement.
  const received = fundingAmount(funding)
  const applied = fundingApplied(funding)
  const surplus = received - applied

  return (
    <div className={cn(
      'rounded-lg border p-3',
      isWallet ? 'border-blue-200 bg-blue-50/40 dark:border-blue-900 dark:bg-blue-950/20' : 'border-warning/20 bg-warning/5',
    )}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <Badge className={cn('font-normal', (carried || isWallet || isTransferOut)
          ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-900'
          : 'bg-warning/15 text-warning border-warning/30')}>
          {isTransferOut
            ? transferOutLabel(funding)
            : isWallet
              ? 'Drawn from wallet balance'
              : carried
                ? `Transfer from ${carried.ref}`
                : source === 'bank'
                  ? 'Bank statement match'
                  : paystack ? 'Legacy deposit record' : 'Manual Bank Transfer'}
        </Badge>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">
            {received < 0 ? `(${naira(Math.abs(received))})` : naira(received)}
          </span>
          {/* Unmatch — commented out, not removed. The handler, its confirm
              dialog and the mutation behind it are all still wired up below;
              only the way in is closed.
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
          )} */}
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
            {isTransferOut ? (
              <Row
                label="Where it went"
                value={
                  funding.toOrderRef
                    ? `Surplus moved to ${funding.toOrderRef} — it appears there as money received`
                    : 'Surplus moved to another order'
                }
                icon={Repeat}
              />
            ) : isWallet ? (
              <Row
                label="Source"
                value={`${walletOriginLabel(funding)}${fundingDepositor(funding) ? ` · originally paid in by ${fundingDepositor(funding)}` : ''}`}
                icon={Wallet}
              />
            ) : carried ? (
              <Row
                label="Source"
                value={`Remainder of ${fundingReference(funding) || 'a bank credit'}, which settled ${carried.ref}`}
                icon={Repeat}
              />
            ) : (
              <Row label="Depositor / payer" value={fundingDepositor(funding)} icon={User} />
            )}
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
      {/* Where a payment came in larger than the order it was made for. The
          money is not missing and it has not been rounded away — it is still
          the customer's, still under this reference, and it is the figure the
          Differential column is showing. */}
      {surplus > 0.005 && (
        <p className="mt-2 flex items-start gap-2 rounded-md bg-background/60 p-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          {naira(applied)} of this covered the order; {naira(surplus)} stayed in the customer's
          wallet under this reference.
        </p>
      )}
    </div>
  )
}

/**
 * The bank credits that paid for a wallet-funded order.
 *
 * Just the statement lines. The wallet hop that sits between the order and
 * these credits is real, but naming it — "paid from wallet", "transfer from
 * BALA" — is not what anybody reconciling against a bank statement is looking
 * for, so it is left out and the credits speak for themselves.
 */
function StatementSourceCard({ row }: { row: StatementRow }) {
  return (
    <div className="rounded-lg border border-foreground/15 bg-muted/20 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{row.depositor || '—'}</p>
          {/* The raw narration, unabridged: it is what someone scanning the
              bank statement matches against by eye. */}
          {row.narration && (
            <p className="mt-0.5 text-xs break-words text-muted-foreground">{row.narration}</p>
          )}
        </div>
        <span className="shrink-0 text-sm font-semibold">{naira(row.amount)}</span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
        {row.txnDate && <span>{format(new Date(row.txnDate), 'd MMM yyyy')}</span>}
        {row.reference && <span>Ref {row.reference}</span>}
      </div>
    </div>
  )
}

function OrderDetailDialog({ order, open, onOpenChange, onRematch, onUnmatch, onAddPayment }: { order: FinanceReportOrder | null; open: boolean; onOpenChange: (o: boolean) => void; onRematch?: () => void; onUnmatch?: (f: OrderFunding) => void; onAddPayment?: () => void }) {
  if (!order) return null

  // What is still owed. Prefer the server's figure; fall back to the
  // subtraction so this reads correctly against a response that predates it.
  const outstanding = order.outstandingAmount != null
    ? Number(order.outstandingAmount)
    : Math.max(0, Number(order.totalAmount || 0) - toNum(order.amountPaid))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{naira(Number(order.totalAmount))}</DialogTitle>
          <DialogDescription>
            {order.reference} · {order.customerName || 'Unknown customer'}
          </DialogDescription>
        </DialogHeader>

        {/* An order settled in instalments is finished off from here.
            The payable-orders desk only lists orders whose customer is
            already holding the WHOLE remaining balance, so a part-paid order
            drops off it the moment the first instalment drains the wallet —
            leaving nowhere to record the second. This is that somewhere. */}
        {outstanding > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-500/25 bg-blue-50 p-3 dark:bg-blue-950">
            <div className="min-w-0">
              <p className={cn(MICRO, 'text-blue-700 dark:text-blue-300')}>Still owed on this order</p>
              <p className="mt-0.5 text-lg font-semibold text-blue-700 tabular-nums dark:text-blue-300">
                {naira(outstanding)}
              </p>
              <p className="mt-0.5 text-xs text-blue-700/80 dark:text-blue-300/80">
                {naira(toNum(order.amountPaid))} of {naira(Number(order.totalAmount))} received so far
              </p>
            </div>
            {onAddPayment && (
              <Button size="sm" onClick={onAddPayment}>
                <Wallet data-icon="inline-start" />
                Add payment
              </Button>
            )}
          </div>
        )}

        <div className="divide-y divide-foreground/10">
          <div className="pb-3">
            {/* <p className={cn(MICRO, 'pb-1 text-muted-foreground')}>Order</p> */}
            <div className="grid gap-3 sm:grid-cols-2">
              <Row label="Reference" value={order.reference} />
              {/* <Row label="Status" value={order.status} /> */}
              <Row label="Date Confirmed" value={order.paymentConfirmedAt ? format(new Date(order.paymentConfirmedAt), 'd MMM yyyy, HH:mm') : undefined} />
              <Row label="Location" value={order.depotName} />
              <Row label="PFI" value={order.pfiNumber} />
              {/* <Row label="PFI location" value={order.pfiLocationName} /> */}
              <Row label="Product" value={order.productName} />
              <Row label="Quantity" value={order.quantity ? `${Number(order.quantity).toLocaleString()} L` : undefined} />
              {/* <Row label="Delivery type" value={order.deliveryType} /> */}
              {/* <Row label="Order DVA" value={[order.virtualAccountBank, order.virtualAccountNumber].filter(Boolean).join(' · ')} /> */}
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

          {/* Wallet before/after — commented out. The figures still come down
              on the order (walletBalanceBefore / walletBalanceAfter) if this
              is wanted back.
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
          */}

          <div className="py-3 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className={cn(MICRO, 'text-muted-foreground')}>
                Payment source{order.funding.length ? ` (${order.funding.length})` : ''}
              </p>
              {/* Re-match — commented out alongside Unmatch, same reasoning.
              {order.paymentStatus === 'Paid' && onRematch && (
                <Button variant="outline" size="sm" onClick={onRematch}>
                  <RefreshCw data-icon="inline-start" />
                  Re-match
                </Button>
              )} */}
            </div>
            {!order.fundingTracked ? (
              // An order paid from wallet balance writes no allocation row, so
              // it used to land on the "predates tracking" message even when it
              // was raised last week. Where the wallet credits behind it can be
              // traced, they are shown instead; the historical wording is kept
              // for orders that genuinely have nothing behind them.
              walletStatementRows(order).length ? (
                <div className="space-y-2">
                  {walletStatementRows(order).map((r) => (
                    <StatementSourceCard key={r.key} row={r} />
                  ))}
                </div>
              ) : (
                <p className="rounded-lg border border-foreground/15 bg-muted/40 p-3 text-sm text-muted-foreground">
                  {untracedReason(order) === 'pre-ledger'
                    ? `This order was confirmed before payment tracking began on 1 July 2026, so no payment was ever recorded against it. The ${naira(untracedAmount(order))} shown as paid is the order's own value, not a bank credit — there is nothing on a statement to match it to.`
                    : order.walletFunded
                      ? 'No statement credits could be matched to this payment.'
                      : 'No payment source has been recorded for this order.'}
                </p>
              )
            ) : (
              <>
                {order.funding.map((f) => (
                  <FundingCard
                    key={f.depositId}
                    funding={f}
                    orderId={order.id}
                    onUnmatch={onUnmatch ? () => onUnmatch(f) : undefined}
                  />
                ))}
                {order.unattributedAmount > 0 && (
                  <p className="flex items-start gap-2 rounded-lg border border-warning/25 bg-warning/5 p-3 text-sm text-warning">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                    {/* Not "paid from somewhere untraced" — nothing says this
                        was paid at all. The order was billed more than the
                        credits matched to it come to, and that difference is
                        now a shortfall rather than an assumption. */}
                    This order was billed {naira(Number(order.totalAmount))} but only{' '}
                    {naira(orderAmountPaid(order))} has been matched to it —{' '}
                    {naira(order.unattributedAmount)} has no payment record behind it and appears
                    on no statement line. It shows as a shortfall in Differential.
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
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  /**
   * Which orders count as money in.
   *
   * 'received' is the default and is NOT sent to the server — omitting the
   * filter is what the server reads as "Paid and Part Paid". The old default
   * sent 'Paid' explicitly, which once orders could be settled in instalments
   * meant every part payment quietly dropped out of the report: the money had
   * landed, the bank statement showed it, and this page did not.
   *
   * 'Paid' is still offered, because "settled in full" is a real question —
   * it is just a narrower one than "what came in".
   */
  const [paymentStatus, setPaymentStatus] = useState<PaymentFilter>('received')
  const [locationId, setLocationId] = useState(ALL)
  const [pfiId, setPfiId] = useState(ALL)
  const [productId, setProductId] = useState(ALL)
  const [viewing, setViewing] = useState<FinanceReportOrder | null>(null)
  /** An order with a balance outstanding, being topped up from this page. */
  const [payingBalance, setPayingBalance] = useState<FinanceReportOrder | null>(null)
  const [rematching, setRematching] = useState<FinanceReportOrder | null>(null)
  const [unmatching, setUnmatching] = useState<{ order: FinanceReportOrder; funding: OrderFunding } | null>(null)
  const unmatchDeposit = useUnmatchDeposit()
  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null)

  // A range, not a day. resolveRange already understood `to` — only the UI
  // was passing one date, so "this day to this day" was impossible to ask for
  // even though the API had always accepted it. An empty `to` still means the
  // single day in `from`, so picking one date behaves exactly as before.
  const range = useMemo(
    () => resolveRange(datePreset, {
      from: customFrom ? new Date(customFrom) : undefined,
      to: customTo ? new Date(customTo) : undefined,
    }),
    [datePreset, customFrom, customTo],
  )
  const dateFrom = range ? range.from.toISOString() : undefined
  const dateTo = range ? range.to.toISOString() : undefined
  const periodLabel = datePreset === 'custom'
    ? (customFrom
        // Same year on both ends reads better without repeating it.
        ? customTo && customTo !== customFrom
          ? `${format(new Date(customFrom), new Date(customFrom).getFullYear() === new Date(customTo).getFullYear() ? 'd MMM' : 'd MMM yyyy')} – ${format(new Date(customTo), 'd MMM yyyy')}`
          : format(new Date(customFrom), 'd MMM yyyy')
        : 'Custom range')
    : (DATE_PRESETS.find((p) => p.value === datePreset)?.label ?? 'All Time')

  const { data, isLoading, isError, error, refetch, isFetching } = useFinanceReport({
    search: search || undefined,
    dateFrom,
    dateTo,
    // Omitted on purpose for 'received' — see the state declaration above.
    paymentStatus: paymentStatus === 'received' ? undefined : paymentStatus,
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
    search || paymentStatus !== 'received' || locationId || pfiId || productId || datePreset !== 'today'
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

  /**
   * What the orders in view were paid — orderAmountPaid, summed, and nothing
   * else.
   *
   * This used to total the funding entries instead, which put it on a
   * different basis from the Differential column beside it and made the two
   * impossible to reconcile:
   *
   *   - a deposit split across orders was counted whole against each of them
   *     (FG11437 read 50m over its own sales value)
   *   - balance predating the allocation ledger appeared in no entry at all
   *   - an order with no allocation records — 5,742 of them across all time —
   *     contributed only whatever wallet credits could be traced, usually
   *     nothing, so a wide date range reported 228bn received against 634bn
   *     billed and a 406bn shortfall that does not exist
   *
   * orderAmountPaid answers one question per order — what was this order
   * paid — and every figure on the page now derives from it. The funding rows
   * beneath an order are evidence of where its money came from, not a
   * competing total: they can be fewer than the order was paid (an untraced
   * wallet balance) without either being wrong.
   *
   * Because it is per-order, nothing needs deduplicating: a payment shared
   * between two orders contributes its own slice to each.
   */
  const totalAmountPaid = useMemo(
    () => rows.reduce((sum, o) => sum + orderAmountPaid(o), 0),
    [rows],
  )

  // Summed from the per-order differentials rather than computed as
  // totalSalesValue − totalAmountPaid: those two are on different bases (the
  // paid figure counts each DEPOSIT once, the differential counts what each
  // ORDER was attributed), so subtracting the aggregates would not equal the
  // column it is supposed to total.
  const totalDifferential = useMemo(
    () => rows.reduce((sum, o) => sum + orderDifferential(o), 0),
    [rows],
  )

  /**
   * Where the difference between billed and received actually is.
   *
   * A net differential alone cannot be checked: on PFI 39/26 it was six
   * overpaid orders totalling 169,552.50 against 11bn billed, and nothing on
   * the page said so. Every figure below is derived from the same
   * orderDifferential the column uses, so it always adds back to the totals
   * beside it.
   */
  const breakdown = useMemo(() => paymentBreakdown(rows), [rows])

  const summary: FinanceReportSummary = {
    // The breakdown rides along so the exports print the same three figures
    // the screen shows, rather than a bare differential nobody can check.
    breakdown,
    count: totals?.count ?? 0,
    totalQuantity: totals?.totalQuantity ?? 0,
    totalSalesValue,
    totalAmountPaid,
    totalDifferential,
    initialStock: selectedPfi ? selectedPfi.startingQtyLitres ?? 0 : null,
    tankBalanceAfter: selectedPfi ? selectedPfi.financials?.remaining ?? 0 : null,
  }
  // An order isn't marked Paid until its wallet hold covers the total in
  // full, so this is normally 0 — nonzero only when a total was corrected
  // by hand after the order was already paid.
  const totalOutstanding = summary.totalSalesValue - summary.totalAmountPaid

  // Which PFIs the Stock Summary block covers.
  //
  // With one selected, that one alone: a report filtered to a single PFI was
  // still carrying a stock table for every other active PFI, which on export
  // reads as pages of figures the report is not about. It is listed whether
  // or not it is still active — having asked for it by name is reason enough
  // to see it, and an inactive one would otherwise leave the block empty.
  //
  // With none selected, every active PFI, exactly as before.
  const listedPfis = useMemo(
    () => (selectedPfi ? [selectedPfi] : pfis.filter((p) => p.status === 'active')),
    [pfis, selectedPfi],
  )

  // Period-sold is worked out from these same filtered rows rather than a
  // separate query — the two figures can never disagree about what counts as
  // "sold" this way. A row whose PFI isn't listed still counts toward the
  // reconciliation note below, just not as its own line in the block.
  const pfiStock: PfiStockRow[] = useMemo(() => {
    const soldByPfi = new Map<number, number>()
    for (const o of rows) {
      if (o.pfiId == null) continue
      soldByPfi.set(o.pfiId, (soldByPfi.get(o.pfiId) || 0) + Number(o.quantity || 0))
    }
    return listedPfis.map((p) => ({
      pfiNumber: p.pfiNumber,
      locationName: p.locationName || '—',
      productName: p.productName || '—',
      initialStock: p.startingQtyLitres ?? 0,
      volumeSoldPeriod: soldByPfi.get(Number(p.id ?? p._id)) || 0,
      volumeSoldAllTime: p.financials?.sold ?? 0,
      volumeRemaining: p.financials?.remaining ?? 0,
      revenue: p.financials?.revenue ?? 0,
    }))
  }, [listedPfis, rows])

  // Reconciles the Stock Summary block against the Total Quantity card: the
  // period-sold column only covers the PFIs listed, so litres sold on any
  // other one have to be added back separately to land on the same number.
  const reconciliationNote = useMemo(() => {
    const listedPfiIds = new Set(listedPfis.map((p) => Number(p.id ?? p._id)))
    const qtyOnUnlistedPfis = rows.reduce((sum, o) => {
      if (o.pfiId == null || listedPfiIds.has(o.pfiId)) return sum
      return sum + Number(o.quantity || 0)
    }, 0)
    const periodSoldOnListed = pfiStock.reduce((sum, p) => sum + p.volumeSoldPeriod, 0)
    if (search || productId) {
      return 'A search or product filter is active, so the period-sold total above and the Total Quantity card are not expected to match right now.'
    }
    // Filtered to one PFI, the block is about that PFI and the old wording —
    // "every PFI listed", "still active" — describes a list that is no longer
    // there. Both figures are stated so they can be read against each other.
    if (selectedPfi) {
      return `Filtered to ${selectedPfi.pfiNumber}, so this block covers that PFI alone — ${periodSoldOnListed.toLocaleString()} L sold this period, against the ${summary.totalQuantity.toLocaleString()} L on the Total Quantity card.`
    }
    return qtyOnUnlistedPfis > 0
      ? `Period sold on the PFIs listed (${periodSoldOnListed.toLocaleString()} L) plus ${qtyOnUnlistedPfis.toLocaleString()} L on PFIs no longer active accounts for the ${summary.totalQuantity.toLocaleString()} L on the Total Quantity card.`
      : `Period sold across every PFI listed accounts for the full ${summary.totalQuantity.toLocaleString()} L on the Total Quantity card — every order in view this period belongs to a PFI still active.`
  }, [listedPfis, selectedPfi, rows, pfiStock, search, productId, summary.totalQuantity])

  const exportFilters: FinanceReportFilters = {
    periodLabel,
    dateFrom: range ? format(range.from, 'yyyy-MM-dd') : '',
    dateTo: range ? format(range.to, 'yyyy-MM-dd') : '',
    paymentStatus: PAYMENT_FILTER_LABEL[paymentStatus],
    search,
    locationName,
    pfiNumber: selectedPfi?.pfiNumber || 'All PFIs',
    product: productName,
  }

  const clearFilters = () => {
    setSearch(''); setPaymentStatus('received'); setLocationId(ALL); setPfiId(ALL); setProductId(ALL)
    setDatePreset('today'); setCustomFrom(''); setCustomTo('')
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
        <NativeSelect className="w-40" value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value as any)}>
          <option value="received">Money received</option>
          <option value="Paid">Paid in full</option>
          <option value="Part Paid">Part paid</option>
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
              onClick={() => { setDatePreset(p.value); setCustomFrom(''); setCustomTo('') }}
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
        {/* From – To. Leaving To empty reports the single day in From. */}
        <div className="flex items-center gap-1.5">
          <Input
            type="date"
            value={customFrom}
            aria-label="From date"
            max={customTo || undefined}
            onChange={(e) => { setCustomFrom(e.target.value); setDatePreset('custom') }}
            className="w-40"
          />
          <span className="text-xs text-muted-foreground">to</span>
          <Input
            type="date"
            value={customTo}
            aria-label="To date"
            min={customFrom || undefined}
            onChange={(e) => {
              setCustomTo(e.target.value)
              setDatePreset('custom')
              // Picking only an end date is a half-stated range; anchor it to
              // the same day so the report is never silently unbounded.
              if (!customFrom) setCustomFrom(e.target.value)
            }}
            className="w-40"
          />
        </div>
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
        <div className={cn(PANEL_BODY, 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4')}>
          <SummaryItem icon={FileText} label="Number of orders" value={summary.count.toLocaleString()} />
          <SummaryItem icon={Clock} label="Period" value={periodLabel} />
          <SummaryItem icon={Droplets} label="Total quantity" value={`${summary.totalQuantity.toLocaleString()} L`} />
          <SummaryItem icon={Landmark} label="Location" value={locationName} />
          <SummaryItem icon={Hash} label="PFI" value={selectedPfi?.pfiNumber || 'All PFIs'} />
          <SummaryItem icon={Droplets} label="Product" value={productName} />
          <SummaryItem icon={Banknote} label="Total sales value" value={naira(summary.totalSalesValue)} />
          <SummaryItem icon={TrendingUp} label="Total amount paid" value={naira(summary.totalAmountPaid)} />

          {/*
            Overpaid, Unaccounted surplus and Internal transfers are commented
            out — Net Differential alone is the figure to read.

            They were split apart to stop a single "Overpaid" number claiming
            ₦234.9m was owed back to customers when ₦13,975,500 was actually in
            wallets. The split is correct, but three more figures on a page is
            three more things to reconcile, and most of what they were
            reporting is noise in records that predate the allocation ledger —
            duplicated legacy deposits (OG10190 carries two of each of its
            four rows), orders whose rate × litres disagrees with their stored
            total. Net Differential answers the question that matters without
            inviting the others.

            paymentBreakdown still computes all of it; restore any line below
            and it is correct and reconciles — shortTotal − (overpaidTotal +
            unaccountedTotal) === netDifferential.

          <SummaryItem
            icon={ArrowUpCircle}
            tone={breakdown.overpaidTotal > 0 ? 'over' : 'plain'}
            label="Overpaid (still in wallet)"
            value={naira(breakdown.overpaidTotal)}
            hint={
              breakdown.overpaidCount > 0
                ? `${breakdown.overpaidCount} order${breakdown.overpaidCount === 1 ? '' : 's'} · money still held`
                : undefined
            }
          />
          {breakdown.unaccountedTotal > 0 && (
            <SummaryItem
              icon={Info}
              label="Unaccounted surplus"
              value={naira(breakdown.unaccountedTotal)}
              hint={`${breakdown.unaccountedCount} order${breakdown.unaccountedCount === 1 ? '' : 's'} · pre-ledger credits, destination unrecorded`}
            />
          )}
          <SummaryItem
            icon={Repeat}
            tone={breakdown.internalCount > 0 ? 'internal' : 'plain'}
            label="Internal transfers"
            value={naira(breakdown.internalTotal)}
          />
          */}
          <SummaryItem
            icon={ArrowDownCircle}
            tone={breakdown.shortTotal > 0 ? 'owed' : 'plain'}
            label="Shortfall"
            value={naira(breakdown.shortTotal)}
            // hint={`${breakdown.shortCount} order${breakdown.shortCount === 1 ? '' : 's'} still owing`}
          />
          <SummaryItem
            icon={Scale}
            label="Net differential"
            value={
              Math.abs(summary.totalDifferential) < 0.005
                ? naira(0)
                : summary.totalDifferential > 0
                  ? naira(summary.totalDifferential)
                  : `(${naira(Math.abs(summary.totalDifferential))})`
            }
            tone={
              Math.abs(summary.totalDifferential) < 0.005
                ? 'plain'
                : summary.totalDifferential > 0
                  ? 'owed'
                  : 'over'
            }
            // hint={
            //   Math.abs(summary.totalDifferential) < 0.005
            //     ? `All ${breakdown.exactCount.toLocaleString()} orders reconcile exactly`
            //     : `Shortfall less overpaid · ${breakdown.exactCount.toLocaleString()} of ${summary.count.toLocaleString()} exact`
            // }
          />
          {selectedPfi && (
            <>
              <SummaryItem label="Tank quantity (PFI)" value={`${(summary.initialStock ?? 0).toLocaleString()} L`} />
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
                    <TableHead className="text-right">Tank Quantity</TableHead>
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
                  {REPORT_COLUMNS.map((c) => (
                    <TableHead
                      key={c.key}
                      className={cn(
                        c.key === 'sn' && 'w-10',
                        NUMERIC_COLUMNS.has(c.key) && 'text-right',
                      )}
                    >
                      {c.header}
                    </TableHead>
                  ))}
                  {/* Delete column commented out. Deleting an order is still
                      available from the Orders page; a destructive control in
                      a report people scan all day is more hazard than help.
                      The dialog that went with it is commented out below —
                      restore the two together. */}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((o, i) => {
                  const salesValue = Number(o.price) * Number(o.quantity || 0)
                  const company = orderCompany(o)
                  // Keyed by column so the cells follow REPORT_COLUMNS wherever
                  // it puts them — the order row fills the order columns, the
                  // funding sub-rows below fill the rest, and neither needs to
                  // know the other's positions.
                  const orderCells: Record<string, React.ReactNode> = {
                    sn: <span className="text-muted-foreground">{i + 1}</span>,
                    date: (
                      <span className="whitespace-nowrap text-muted-foreground">
                        {o.createdAt ? format(new Date(o.createdAt), 'd MMM yyyy') : '—'}
                      </span>
                    ),
                    ref: <span className="font-mono text-xs font-semibold whitespace-nowrap">{o.reference}</span>,
                    pfi: <span className="whitespace-nowrap font-medium">{o.pfiNumber || '—'}</span>,
                    customer: <span className="block max-w-[10rem] truncate font-medium">{o.customerName || '—'}</span>,
                    company: <span className="block max-w-[10rem] truncate text-muted-foreground">{company}</span>,
                    qty: <span className="whitespace-nowrap font-medium">{Number(o.quantity || 0).toLocaleString()}</span>,
                    product: <span className="text-muted-foreground">{o.productName || '—'}</span>,
                    rate: <span className="whitespace-nowrap">{naira(Number(o.price))}</span>,
                    salesValue: <span className="whitespace-nowrap font-semibold">{naira(salesValue)}</span>,
                    // Sales value less what this ORDER was attributed, not
                    // less the deposit figures listed beneath it — see
                    // orderDifferential. Positive is still owed, negative is
                    // overpaid, and a clean order reads as a quiet dash
                    // rather than a loud zero.
                    differential: (() => {
                      const d = orderDifferential(o)
                      if (Math.abs(d) < 0.005) return <span className="text-muted-foreground">—</span>
                      return (
                        <span className={cn('whitespace-nowrap font-semibold', d > 0 ? 'text-destructive' : 'text-accent')}>
                          {d > 0 ? naira(d) : `(${naira(Math.abs(d))})`}
                        </span>
                      )
                    })(),
                    paidInto: <span className="block max-w-[16rem] truncate text-muted-foreground">{orderPaidInto(o) || '—'}</span>,
                  }
                  return (
                    <Fragment key={o.id}>
                      <TableRow className="cursor-pointer" onClick={() => setViewing(o)}>
                        {REPORT_COLUMNS.map((c) => (
                          <TableCell key={c.key} className={cn(NUMERIC_COLUMNS.has(c.key) && 'text-right')}>
                            {c.scope === 'order' ? orderCells[c.key] : null}
                          </TableCell>
                        ))}
                      </TableRow>
                      {/* A wallet-funded order has no allocation to print, so
                          the bank credits behind it fill the same columns —
                          the statement lines and nothing else. */}
                      {!o.fundingTracked && walletStatementRows(o).map((r) => {
                        const cells: Record<string, React.ReactNode> = {
                          depositDate: (
                            <span className="whitespace-nowrap text-muted-foreground">
                              {r.txnDate ? format(new Date(r.txnDate), 'd MMM yyyy') : '—'}
                            </span>
                          ),
                          depositor: (
                            <span className="block max-w-[12rem] truncate" title={r.narration}>
                              {r.depositor || '—'}
                            </span>
                          ),
                          depositRef: <span className="block max-w-[10rem] truncate">{r.reference || '—'}</span>,
                          amount: <span className="whitespace-nowrap font-semibold">{naira(r.amount)}</span>,
                          // Who keyed the credit in. This printed the bank
                          // narration until the recorder was carried through
                          // the wallet trace, so a column headed Recorded By
                          // was naming the payer.
                          recordedBy: (
                            <span className="block max-w-[10rem] truncate">{r.recordedBy || '—'}</span>
                          ),
                        }
                        return (
                          <TableRow key={`${o.id}-stmt-${r.key}`} className="bg-muted/20 hover:bg-muted/30">
                            {REPORT_COLUMNS.map((c) => (
                              <TableCell key={c.key} className={cn(NUMERIC_COLUMNS.has(c.key) && 'text-right')}>
                                {c.scope === 'funding' ? cells[c.key] : null}
                              </TableCell>
                            ))}
                          </TableRow>
                        )
                      })}
                      {o.fundingTracked && o.funding.map((f) => {
                        // Money that never came through a bank. It has no
                        // statement line and no reference because none exists,
                        // which is indistinguishable from missing data unless
                        // it is said out loud — so it is said in blue.
                        // A recorded wallet transfer, or a remainder carried
                        // off another order's bank credit. Both are money that
                        // did not arrive from a bank on this order, so both
                        // read blue and neither pretends to a bank reference.
                        const source = fundingSource(f)
                        const carried = carriedFromOrder(f, o.id)
                        const internal = isInternalTransfer(f) || !!carried
                        // A wallet draw keeps the payer and the bank
                        // reference its balance arrived under — that is the
                        // whole reason it is traceable — and says in the
                        // reference column that it came out of balance rather
                        // than landing in the bank on this order's account.
                        const isWallet = source === 'wallet'
                        const isTransferOut = source === 'transfer_out'
                        const fundingCells: Record<string, React.ReactNode> = {
                          depositDate: (
                            <span className="whitespace-nowrap text-muted-foreground">
                              {fundingPaidAt(f) ? format(new Date(String(fundingPaidAt(f))), 'd MMM yyyy') : '—'}
                            </span>
                          ),
                          depositor: (
                            <span className={cn('flex items-center gap-1.5', internal && TONE_CLASS.internal)}>
                              {internal && <Repeat className="size-3 shrink-0" />}
                              <span className="block max-w-[11rem] truncate">
                                {isTransferOut
                                  ? transferOutLabel(f)
                                  : carried ? `TRF FROM ${carried.ref}` : fundingDepositor(f) || '—'}
                              </span>
                            </span>
                          ),
                          depositRef: (
                            <span
                              className={cn('block max-w-[10rem] truncate', internal && TONE_CLASS.internal)}
                              // The bank reference is still on the row for
                              // anyone tracing it — it is simply no longer
                              // presented as this order's own bank line.
                              title={
                                isWallet
                                  ? `Drawn from wallet balance that arrived as ${fundingReference(f) || 'an untraced credit'}`
                                  : carried
                                    ? `Remainder of ${fundingReference(f)}, which settled ${carried.ref}`
                                    : undefined
                              }
                            >
                              {isTransferOut
                                ? `to ${f.toOrderRef || 'another order'}`
                                : isWallet
                                  ? walletOriginLabel(f)
                                  : carried
                                    ? `off ${fundingReference(f) || 'credit'}`
                                    : internal ? 'Internal transfer' : fundingReference(f) || '—'}
                            </span>
                          ),
                          // Receipts only, always positive, so the column can
                          // be added straight down the page. A row that is
                          // purely money moving out leaves it empty.
                          amount: isTransferOut ? null : (
                            <span className={cn('whitespace-nowrap font-semibold', internal && TONE_CLASS.internal)}>
                              {naira(fundingAmount(f))}
                            </span>
                          ),
                          transfers: transferAmount(f) ? (
                            <span className={cn('whitespace-nowrap font-semibold', TONE_CLASS.internal)}>
                              {transferAmount(f) < 0
                                ? `(${naira(Math.abs(transferAmount(f)))})`
                                : naira(transferAmount(f))}
                            </span>
                          ) : null,
                          recordedBy: <span className="block max-w-[10rem] truncate">{fundingRecorder(f) || '—'}</span>,
                        }
                        return (
                          <TableRow
                            key={`${o.id}-funding-${f.depositId}`}
                            className={cn(
                              internal
                                ? 'bg-blue-50/60 hover:bg-blue-50 dark:bg-blue-950/30 dark:hover:bg-blue-950/50'
                                : 'bg-muted/20 hover:bg-muted/30',
                            )}
                          >
                            {REPORT_COLUMNS.map((c) => (
                              <TableCell key={c.key} className={cn(NUMERIC_COLUMNS.has(c.key) && 'text-right')}>
                                {c.scope === 'funding' ? fundingCells[c.key] : null}
                              </TableCell>
                            ))}
                          </TableRow>
                        )
                      })}
                      {/* Money the order was paid that no row above accounts
                          for. Without it the Amount Paid column came up short
                          of the total at the top of the page, which is the
                          first thing anyone checking against a statement
                          notices and the last thing they can explain. */}
                      {untracedAmount(o) > 0.005 && (() => {
                        const preLedger = untracedReason(o) === 'pre-ledger'
                        return (
                          <TableRow
                            key={`${o.id}-untraced`}
                            className={cn(
                              // Hatched grey for the pre-ledger era, so a row
                              // that can never be matched to a statement does
                              // not sit there looking like one that should be.
                              preLedger ? 'bg-muted/50 hover:bg-muted/60' : 'bg-muted/20 hover:bg-muted/30',
                            )}
                          >
                            {REPORT_COLUMNS.map((c) => (
                              <TableCell key={c.key} className={cn(NUMERIC_COLUMNS.has(c.key) && 'text-right')}>
                                {c.key === 'depositor' ? (
                                  <span className="italic text-muted-foreground">{untracedLabel(o)}</span>
                                ) : c.key === 'depositRef' ? (
                                  <span className="text-xs text-muted-foreground/80">
                                    {preLedger ? 'Before 1 Jul 2026 — nothing to match' : 'Not matched to a statement'}
                                  </span>
                                ) : c.key === 'amount' ? (
                                  <span className="whitespace-nowrap font-semibold text-muted-foreground">
                                    {naira(untracedAmount(o))}
                                  </span>
                                ) : null}
                              </TableCell>
                            ))}
                          </TableRow>
                        )
                      })()}
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
        onAddPayment={() => { setPayingBalance(viewing); setViewing(null) }}
      />

      {/* The same dialog the payable-orders desk uses — match a statement
          line, or draw from wallet balance, and confirm whatever has landed.
          Reused rather than rebuilt so an instalment is recorded through
          exactly the flow a first payment is, funding trail included. */}
      <ConfirmOrderPaymentDialog
        order={payingBalance}
        open={payingBalance !== null}
        onOpenChange={(o) => { if (!o) setPayingBalance(null) }}
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

{/* Delete dialog — commented out with the Delete column above; the
          column was its only trigger. Restore both together.
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
      </Dialog> */}
    </div>
  )
}
