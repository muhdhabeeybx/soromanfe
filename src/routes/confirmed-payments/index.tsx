import { Fragment, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { format } from 'date-fns'
import {
  Search, X, Loader2, Landmark, User,
  Hash, Clock, FileText, Info, Banknote, Droplets, TrendingUp,
  FileSpreadsheet, Wallet,
  ArrowUpCircle, ArrowDownCircle, Repeat, Scale, AlertTriangle, Trash2,
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
import { Label } from '#/components/ui/label'
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
  useFinanceReport, paymentRecorder, paymentPayer, paymentPaidInto, paymentDate, narrationText,
  transferOrigin, visiblePayments, legacyAmount,
  orderPaidInto, orderCompany,
  paymentBreakdown, isTransferLeg, isUnreconciled, isSystemDecided,
  useRemoveOrderPayment,
  CONFIRMATION_BASIS_LABEL, CONFIRMATION_BASIS_SHORT,
  type FinanceReportOrder, type OrderPayment, type ConfirmationBasis,
} from '#/lib/hooks/useFinanceReport'
import { useDepotsForFilter, usePfiList, type PfiWithFinancials } from '#/lib/hooks/usePfis'
import { useProductList } from '#/lib/hooks/useProducts'
import { OrderPaymentsDialog } from '#/components/OrderPaymentsDialog'
import { ConfirmOrderPaymentDialog } from '#/components/ConfirmOrderPaymentDialog'
import {
  exportFinanceReportExcel, exportFinanceReportPdf, REPORT_COLUMNS,
  type FinanceReportFilters, type FinanceReportSummary, type PfiStockRow,
} from './-finance-report-export'

// Which columns render right-aligned — the numeric ones. Everything else
// about the table's shape comes from REPORT_COLUMNS itself (see COLUMNS in
// -finance-report-export.ts), so the screen and the exports cannot drift.
const NUMERIC_COLUMNS = new Set(['qty', 'rate', 'salesValue', 'amount', 'transfers', 'differential', 'balance'])

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
 * One payment recorded against this order, as the bank statement has it.
 *
 * Every value below is a field on the payment row, copied from the statement
 * line when the payment was confirmed. The card this replaced had to decide,
 * per row, whether it was looking at a bank match, a wallet draw, a remainder
 * carried off another order's credit, or a legacy Paystack record — and it
 * decided by inspecting a free-text description and a JSON blob. Those
 * distinctions are now recorded, so the card reads them.
 */
function PaymentCard({ payment, onUnmatch }: { payment: OrderPayment; onUnmatch?: () => void }) {
  const transfer = isTransferLeg(payment)
  const outgoing = payment.source === 'transfer_out'
  const legacy = isUnreconciled(payment)
  const recorder = paymentRecorder(payment) || null

  return (
    <div className={cn(
      'rounded-lg border p-3',
      transfer ? 'border-blue-200 bg-blue-50/40 dark:border-blue-900 dark:bg-blue-950/20'
        : legacy ? 'border-warning/25 bg-warning/5'
          : 'border-foreground/15 bg-muted/20',
    )}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <Badge className={cn('font-normal', transfer
          ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-900'
          : legacy
            ? 'bg-warning/15 text-warning border-warning/30'
            : 'bg-success/15 text-success border-success/30')}>
          {outgoing ? `Surplus moved to ${payment.counterpartOrderRef || 'another order'}`
            : payment.source === 'transfer_in' ? `Surplus received from ${payment.counterpartOrderRef || 'another order'}`
              : legacy ? 'No bank record'
                : 'Bank statement match'}
        </Badge>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className={cn('text-sm font-semibold', payment.amount < 0 && 'text-info')}>
            {payment.amount < 0 ? `(${naira(Math.abs(payment.amount))})` : naira(payment.amount)}
          </span>
          {/*
            Unmatching lives here rather than on the report row itself: the
            table is scanned all day and a destructive control sitting in it is
            more hazard than help. Offered only where there is a statement line
            to give back — a legacy row has none, and a transfer leg has to be
            reversed as a whole movement so its two halves cannot come apart.
          */}
          {onUnmatch && payment.statementLineId != null && !isTransferLeg(payment) && (
            <Button
              type="button" variant="ghost" size="icon"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              aria-label="Unmatch this payment"
              title="Unmatch — returns the bank line to the pool"
              onClick={onUnmatch}
            >
              <Trash2 className="size-4" />
            </Button>
          )}
        </div>
      </div>

      {/*
        How this payment came to be on this order — stated on every card, not
        only the awkward ones, so the clean case is visibly clean rather than
        merely unmarked. A staff decision reads plainly; anything the software
        decided on its own is called out, because that is the set somebody has
        to go back through.
      */}
      <p className={cn(
        'mb-2 flex items-start gap-1.5 text-xs',
        isSystemDecided(payment.confirmationBasis) ? 'text-warning' : 'text-muted-foreground',
      )}>
        {isSystemDecided(payment.confirmationBasis) && <AlertTriangle className="mt-0.5 size-3 shrink-0" />}
        <span>
          {CONFIRMATION_BASIS_LABEL[payment.confirmationBasis] ?? 'Unknown'}
          {payment.confirmationBasis === 'transfer_auto' &&
            ' — converted from an old wallet draw by migration 0021, not made on the transfer screen.'}
          {payment.confirmationBasis === 'bank_inferred' &&
            ' — the statement line is real, but which order it settles was not recorded at the time.'}
          {payment.confirmationBasis === 'auto_allocated' &&
            ' — the oldest unspent credit was taken, for no recorded reason.'}
        </span>
      </p>

      {legacy ? (
        // Said plainly rather than left as empty cells. This order was
        // confirmed before payments were recorded against orders, so there is
        // no statement line to find — and an auditor needs to be told that,
        // not shown blanks they will spend an afternoon chasing.
        <p className="text-sm text-muted-foreground">
          This order was confirmed before payments were recorded against orders. The figure above
          is the order&apos;s own recorded amount paid, not a bank credit — there is nothing on a
          statement to match it to.
        </p>
      ) : transfer ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Row
            label={outgoing ? 'Where it went' : 'Where it came from'}
            value={payment.counterpartOrderRef || 'Another order'}
            icon={Repeat}
          />
          {/* The bank payment this money actually arrived as. A transfer leg
              has no statement line of its own, and without this the row says
              only that money moved — not which money, which is the first
              thing anyone reconciling asks. */}
          <Row label="Originally paid in by" value={payment.originDepositor || undefined} icon={User} />
          <Row label="Original bank reference" value={payment.originBankRefs || undefined} icon={Hash} />
          <Row
            label="Moved on"
            value={payment.createdAt ? format(new Date(payment.createdAt), 'd MMM yyyy') : undefined}
            icon={Clock}
          />
          <Row label="Reason" value={payment.transferReason || payment.note} icon={FileText} />
          <Row label="Recorded by" value={recorder || undefined} icon={User} />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Row label="Depositor / payer" value={paymentPayer(payment)} icon={User} />
          <Row label="Bank reference" value={payment.bankRef} icon={Hash} />
          <Row
            label="Payment date"
            value={payment.txnDate ? format(new Date(payment.txnDate), 'd MMM yyyy') : undefined}
            icon={Clock}
          />
          <Row label="Paid into" value={paymentPaidInto(payment)} icon={Landmark} />
          <Row label="Receiving account name" value={payment.accountName} icon={User} />
          <Row label="Recorded by" value={recorder || undefined} icon={User} />
        </div>
      )}

      {/*
        The narration, unabridged and labelled: it is what someone scanning the
        bank statement matches against by eye, and — printed next to the amount
        above — it is the only place the payer's own words survive.

        Those words are how the desk reads money in while it is still pending:
        who sent it and what they said it was for. Unlabelled, this line read
        as leftover data; the amount and the sentence together are the note.
      */}
      {narrationText(payment.narration) && !transfer && !legacy && (
        <p className="mt-2 text-xs break-words text-muted-foreground">
          <span className={cn(MICRO, 'mr-1.5 opacity-70')}>Narration</span>
          {narrationText(payment.narration)}
        </p>
      )}
      {/* And anything a person typed against the payment itself. */}
      {payment.note && !transfer && (
        <p className="mt-1 text-xs italic break-words text-muted-foreground">{payment.note}</p>
      )}
    </div>
  )
}

function OrderDetailDialog({ order, open, onOpenChange, onManagePayments, onAddPayment, onUnmatch }: { order: FinanceReportOrder | null; open: boolean; onOpenChange: (o: boolean) => void; onManagePayments?: () => void; onAddPayment?: () => void; onUnmatch?: (p: OrderPayment) => void }) {
  if (!order) return null

  // Straight off the server, which derives both from the order's payment rows.
  const outstanding = order.shortfall

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
                Payments{order.payments.length ? ` (${order.payments.length})` : ''}
              </p>
              {onManagePayments && (
                <Button variant="outline" size="sm" onClick={onManagePayments}>
                  <Repeat data-icon="inline-start" />
                  Manage
                </Button>
              )}
            </div>

            {order.payments.length === 0 ? (
              <p className="rounded-lg border border-foreground/15 bg-muted/40 p-3 text-sm text-muted-foreground">
                No payment has been recorded against this order.
              </p>
            ) : (
              order.payments.map((p) => (
                <PaymentCard
                  key={p.id}
                  payment={p}
                  onUnmatch={onUnmatch ? () => onUnmatch(p) : undefined}
                />
              ))
            )}

            {/* Money still owed. Distinct from a gap in the paperwork, which
                is what the old "unattributed" warning meant — that distinction
                confused the desk into hunting a missing statement line for a
                payment nobody had made yet. There is only one gap now, and it
                is a real one. */}
            {order.shortfall > 0.005 && (
              <p className="flex items-start gap-2 rounded-lg border border-warning/25 bg-warning/5 p-3 text-sm text-warning">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                This order was billed {naira(Number(order.totalAmount))} and{' '}
                {naira(order.received)} has been received against it — {naira(order.shortfall)} is
                still owed.
              </p>
            )}

            {/* Surplus sits on the order that received it, visibly, until
                somebody moves it. That is the whole point of the model: money
                stays attached to the order it was paid against. */}
            {order.surplus > 0.005 && (
              <p className="flex items-start gap-2 rounded-lg border border-info/25 bg-info/5 p-3 text-sm text-info">
                <Info className="mt-0.5 size-4 shrink-0" />
                {naira(order.surplus)} was received beyond this order&apos;s value and is held
                against it. Use Manage to move it to another order, if that is where it belongs.
              </p>
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
  /**
   * Whether the order has a bank statement line behind it.
   *
   * The control an external audit is actually run from: 'reconciled' is the
   * slice that can be checked against a statement, line by line, and
   * 'unreconciled' is everything confirmed before payments were recorded
   * against orders — which is most of the history and has no bank evidence at
   * all. Keeping them separable is the point; hiding the second behind a
   * plausible-looking funding trail is what the old report did.
   */
  const [reconciliation, setReconciliation] = useState<'' | 'reconciled' | 'unreconciled'>('')
  /**
   * WHO decided this order was paid — a different question from whether a bank
   * line exists, and the one behind most of the confusion on this page.
   *
   * An order can be "bank-matched" and still have had the order chosen for it
   * by migration 0021's tiebreak rather than by a person; and every transfer
   * currently on the report was converted out of an old wallet draw by that
   * same migration, not made by anyone on the transfer screen. 'system' is the
   * set nobody in the building can give an account of.
   */
  const [confirmationBasis, setConfirmationBasis] =
    useState<'' | 'system' | 'staff' | ConfirmationBasis>('')
  const [locationId, setLocationId] = useState(ALL)
  const [pfiId, setPfiId] = useState(ALL)
  const [productId, setProductId] = useState(ALL)
  const [viewing, setViewing] = useState<FinanceReportOrder | null>(null)
  /** An order with a balance outstanding, being topped up from this page. */
  const [payingBalance, setPayingBalance] = useState<FinanceReportOrder | null>(null)
  /** The order whose payments are being inspected or corrected. */
  const [managing, setManaging] = useState<FinanceReportOrder | null>(null)
  /**
   * A statement line being taken back off the order it was matched to.
   *
   * This was reachable only four clicks deep — row, detail dialog, Manage
   * payments, bin icon — which for the one thing people need in a hurry (they
   * matched a payment to the wrong order and can see it on this very page) is
   * three clicks too many. It is now on the payment row itself.
   */
  const [unmatching, setUnmatching] = useState<{ order: FinanceReportOrder; payment: OrderPayment } | null>(null)
  const [unmatchReason, setUnmatchReason] = useState('')
  const removePayment = useRemoveOrderPayment()
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
    reconciliation: reconciliation || undefined,
    confirmationBasis: confirmationBasis || undefined,
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
    search || paymentStatus !== 'received' || reconciliation || confirmationBasis ||
    locationId || pfiId || productId || datePreset !== 'today'
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
   * What the orders in view actually received — one sum over the payment rows
   * shown underneath them.
   *
   * There is nothing to deduplicate and no second basis to reconcile against.
   * A bank statement line belongs to exactly one order, and the Differential
   * column is the same subtraction on the same figures. The three earlier
   * attempts at this number each totalled something subtly different —
   * deposits, wallet traces, stored amounts — and disagreed with the column
   * beside them.
   *
   * Transfer legs are excluded. This is the figure the report is checked
   * against a bank statement with, so it has to be what the bank paid in, not
   * what an order was left holding after money moved between orders later.
   */
  const totalAmountPaid = useMemo(
    () => rows.reduce((sum, o) => sum + o.amountPaidIn, 0),
    [rows],
  )

  /** Sales value against the bank figure, before any transfer. */
  const totalDifferential = useMemo(
    () => rows.reduce((sum, o) => sum + o.differential, 0),
    [rows],
  )

  /** Money that moved between orders, netted, and what is left after it. */
  const totalTransferred = useMemo(
    () => rows.reduce((sum, o) => sum + o.netTransfers, 0),
    [rows],
  )
  const totalBalance = useMemo(() => rows.reduce((sum, o) => sum + o.balance, 0), [rows])

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
    totalTransferred,
    totalBalance,
    initialStock: selectedPfi ? selectedPfi.startingQtyLitres ?? 0 : null,
    tankBalanceAfter: selectedPfi ? selectedPfi.financials?.remaining ?? 0 : null,
  }
  // What is still genuinely outstanding once transfers are counted — the
  // Balance column, totalled. Distinct from totalDifferential, which is the
  // gap against the BANK before any transfer.
  const totalOutstanding = summary.totalBalance

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
    setSearch(''); setPaymentStatus('received'); setReconciliation(''); setLocationId(ALL)
    setPfiId(ALL); setProductId(ALL)
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
        {/* Bank evidence, or the absence of it. Filtered server-side over the
            same set the stat cards are computed from, so narrowing to what an
            audit can verify narrows the totals with it. */}
        <NativeSelect
          className="w-48"
          value={reconciliation}
          onChange={(e) => setReconciliation(e.target.value as any)}
        >
          <option value="">Bank-matched or not</option>
          <option value="reconciled">Bank-matched only</option>
          <option value="unreconciled">No bank record</option>
        </NativeSelect>
        {/* Who decided, as against whether a bank line exists. These are
            different questions and the page kept only being able to ask the
            first one — which is why a transfer nobody made read exactly like
            one somebody did. */}
        <NativeSelect
          className="w-56"
          value={confirmationBasis}
          onChange={(e) => setConfirmationBasis(e.target.value as any)}
        >
          <option value="">Confirmed by anyone</option>
          <option value="staff">Staff decisions only</option>
          <option value="system">System decided — needs review</option>
          <option value="bank_matched">{CONFIRMATION_BASIS_SHORT.bank_matched}</option>
          <option value="bank_inferred">{CONFIRMATION_BASIS_SHORT.bank_inferred}</option>
          <option value="auto_allocated">{CONFIRMATION_BASIS_SHORT.auto_allocated}</option>
          <option value="no_record">{CONFIRMATION_BASIS_SHORT.no_record}</option>
          <option value="transfer_auto">{CONFIRMATION_BASIS_SHORT.transfer_auto}</option>
          <option value="transfer_desk">{CONFIRMATION_BASIS_SHORT.transfer_desk}</option>
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
            Surplus, Transfers and Shortfall are all worth a card again.

            They were commented down to Net Differential alone because the old
            breakdown could not tell real money from a bookkeeping artefact: it
            once claimed ₦234.9m was owed back to customers when ₦13,975,500
            was actually held, the rest being pre-ledger credits whose
            remainder had long since paid for other orders. Three figures
            nobody could act on is worse than one.

            Surplus is now `received − order value`, where received is the sum
            of the payment rows printed underneath the order. There is no
            artefact left in it: it is money that arrived, it is on that order,
            and it is either moved to another order or refunded. So it is
            something the desk can work through, and it gets a card.
          */}
          <SummaryItem
            icon={ArrowUpCircle}
            tone={breakdown.surplusTotal > 0 ? 'over' : 'plain'}
            label="Surplus held on orders"
            value={naira(breakdown.surplusTotal)}
            hint={
              breakdown.surplusCount > 0
                ? `${breakdown.surplusCount} order${breakdown.surplusCount === 1 ? '' : 's'} · move or refund`
                : undefined
            }
          />
          <SummaryItem
            icon={Repeat}
            tone={breakdown.transferCount > 0 ? 'internal' : 'plain'}
            label="Moved between orders"
            value={naira(breakdown.transferTotal)}
            hint={
              breakdown.transferCount > 0
                ? `${breakdown.transferCount} leg${breakdown.transferCount === 1 ? '' : 's'}`
                : undefined
            }
          />
          {/*
            The figure an external audit actually turns on: how much of what is
            on this page can be checked against a bank statement at all. An
            order with no statement line behind it was confirmed before
            payments were recorded against orders, and the report says so
            rather than filling its bank columns with a plausible guess.
          */}
          <SummaryItem
            icon={Landmark}
            tone={breakdown.unreconciledCount > 0 ? 'owed' : 'plain'}
            label="Bank-verifiable orders"
            value={`${breakdown.reconciledCount.toLocaleString()} of ${summary.count.toLocaleString()}`}
            hint={
              breakdown.unreconciledCount > 0
                ? `${breakdown.unreconciledCount.toLocaleString()} with no statement line behind them`
                : 'Every order matches a bank statement line'
            }
          />
          {/*
            The question "who decided this?", which the report could not answer
            at all until migration 0023 recorded it. It is deliberately next to
            Bank-verifiable and deliberately not the same figure: an order can
            have a real statement line behind it AND have had that line
            attributed to it by a migration's tiebreak rather than by a person.
          */}
          <SummaryItem
            icon={AlertTriangle}
            tone={(totals?.systemDecidedCount ?? 0) > 0 ? 'owed' : 'plain'}
            label="System-decided orders"
            value={`${(totals?.systemDecidedCount ?? 0).toLocaleString()} of ${summary.count.toLocaleString()}`}
            hint={
              (totals?.systemDecidedCount ?? 0) > 0
                ? 'Nobody chose how these were funded — the software did. Filter to them above.'
                : 'Every payment here was a recorded staff decision'
            }
          />
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
                    // Sales value against the BANK figure, before any transfer
                    // — see orderDifferential. Positive is still owed, negative
                    // is more received than the order was worth, and a clean
                    // order reads as a quiet dash rather than a loud zero.
                    differential: (() => {
                      const d = o.differential
                      if (Math.abs(d) < 0.005) return <span className="text-muted-foreground">—</span>
                      return (
                        <span className={cn('whitespace-nowrap font-semibold', d > 0 ? 'text-destructive' : 'text-accent')}>
                          {d > 0 ? naira(d) : `(${naira(Math.abs(d))})`}
                        </span>
                      )
                    })(),
                    /**
                     * What is left once the bank figure and the transfers are
                     * both accounted for. On a settled order this is a dash
                     * whichever route its money took — so a clean day reads as
                     * a column of dashes, and anything that is not a dash is a
                     * real gap somebody has to close.
                     */
                    balance: (() => {
                      const b = o.balance
                      if (Math.abs(b) < 0.005) return <span className="text-muted-foreground">—</span>
                      return (
                        <span className={cn('whitespace-nowrap font-semibold', b > 0 ? 'text-destructive' : 'text-accent')}>
                          {b > 0 ? naira(b) : `(${naira(Math.abs(b))})`}
                        </span>
                      )
                    })(),
                    paidInto: <span className="block max-w-[16rem] truncate text-muted-foreground">{orderPaidInto(o) || '—'}</span>,
                  }

                  /**
                   * Money with no bank record behind it, carried on the ORDER
                   * row instead of a sub-row of its own.
                   *
                   * Every order confirmed before payments were tracked has one
                   * of these, and printing each as its own line put ~5,700
                   * identical "no bank record" rows into the report. The fact
                   * is worth stating once, quietly, on the order it belongs
                   * to — and the amount has to stay in the Amount Paid column
                   * either way, or that column stops summing to the total
                   * printed above it.
                   */
                  const legacy = legacyAmount(o)
                  const legacyCells: Record<string, React.ReactNode> = legacy > 0 ? {
                    amount: <span className="whitespace-nowrap font-semibold text-muted-foreground">{naira(legacy)}</span>,
                    depositRef: (
                      <span className="text-xs whitespace-nowrap text-muted-foreground/70">
                        No bank record
                      </span>
                    ),
                  } : {}

                  return (
                    <Fragment key={o.id}>
                      <TableRow className="cursor-pointer" onClick={() => setViewing(o)}>
                        {REPORT_COLUMNS.map((c) => (
                          <TableCell key={c.key} className={cn(NUMERIC_COLUMNS.has(c.key) && 'text-right')}>
                            {c.scope === 'order' ? orderCells[c.key] : (legacyCells[c.key] ?? null)}
                          </TableCell>
                        ))}
                      </TableRow>
                      {/* One sub-row per payment worth printing.
                          Legacy rows are not printed — see visiblePayments;
                          their amount rides on the order row above, so the
                          Amount Paid column still sums to what came in. */}
                      {visiblePayments(o).map((p) => {
                        // Money that moved between orders rather than arriving
                        // from a bank. It has no statement line of its own, so
                        // it names the bank payment it came out of instead of
                        // leaving three columns blank and reading as corrupt.
                        const internal = isTransferLeg(p)
                        const when = paymentDate(p)
                        const origin = transferOrigin(p)
                        const paymentCells: Record<string, React.ReactNode> = {
                          depositDate: (
                            <span className={cn('whitespace-nowrap text-muted-foreground', internal && TONE_CLASS.internal)}>
                              {when.date ? format(new Date(when.date), 'd MMM yyyy') : '—'}
                            </span>
                          ),
                          depositor: (
                            <span className={cn('flex items-center gap-1.5', internal && TONE_CLASS.internal)}>
                              {internal && <Repeat className="size-3 shrink-0" />}
                              <span className="block max-w-[11rem] truncate" title={p.narration || p.transferReason || undefined}>
                                {paymentPayer(p) || '—'}
                              </span>
                            </span>
                          ),
                          depositRef: (
                            <span
                              className={cn('block max-w-[15rem] truncate', internal && TONE_CLASS.internal)}
                              title={internal ? (origin || p.transferReason || undefined) : undefined}
                            >
                              {internal ? origin : (p.bankRef || '—')}
                            </span>
                          ),
                          // Receipts only, always positive, so the column can
                          // be added straight down the page. A transfer leg
                          // leaves it empty and lands in Transfers instead.
                          amount: internal ? null : (
                            <span className="whitespace-nowrap font-semibold">{naira(p.amount)}</span>
                          ),
                          transfers: internal ? (
                            <span className={cn('whitespace-nowrap font-semibold', TONE_CLASS.internal)}>
                              {p.amount < 0 ? `(${naira(Math.abs(p.amount))})` : naira(p.amount)}
                            </span>
                          ) : null,
                          recordedBy: <span className="block max-w-[10rem] truncate">{paymentRecorder(p) || '—'}</span>,
                        }
                        return (
                          <TableRow
                            key={`${o.id}-payment-${p.id}`}
                            className={cn(
                              internal
                                ? 'bg-blue-50/60 hover:bg-blue-50 dark:bg-blue-950/30 dark:hover:bg-blue-950/50'
                                : 'bg-muted/20 hover:bg-muted/30',
                            )}
                          >
                            {REPORT_COLUMNS.map((c) => (
                              <TableCell key={c.key} className={cn(NUMERIC_COLUMNS.has(c.key) && 'text-right')}>
                                {c.scope === 'funding' ? paymentCells[c.key] : null}
                              </TableCell>
                            ))}
                          </TableRow>
                        )
                      })}
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
        onManagePayments={() => { setManaging(viewing); setViewing(null) }}
        onAddPayment={() => { setPayingBalance(viewing); setViewing(null) }}
        onUnmatch={(p) => {
          if (!viewing) return
          setUnmatching({ order: viewing, payment: p })
          setUnmatchReason('')
        }}
      />

      {/* The same dialog the payable-orders desk uses — match the statement
          line(s) that paid for the order. Reused rather than rebuilt so an
          instalment is recorded through exactly the flow a first payment is. */}
      <ConfirmOrderPaymentDialog
        order={payingBalance}
        open={payingBalance !== null}
        onOpenChange={(o) => { if (!o) setPayingBalance(null) }}
      />

      {/* Inspecting and correcting what is recorded against one order: remove
          a payment matched to the wrong order (its statement line goes back to
          the pool), or move surplus to the order it belongs on. Replaced a
          Re-match dialog and a separate Unmatch confirm, both of which worked
          by moving wallet balance around. */}
      <OrderPaymentsDialog
        order={managing}
        open={managing !== null}
        onOpenChange={(o) => { if (!o) setManaging(null) }}
      />

      {/*
        Unmatching a statement line straight from the report.

        The line goes back to the unmatched pool and the order is recomputed, so
        the correction is: unmatch here, then open the RIGHT order and confirm it
        against the same line. Nothing about the line itself changes — it keeps
        its date, payer, reference and amount, because it is the bank's record
        and not ours to edit.
      */}
      <Dialog
        open={unmatching !== null}
        onOpenChange={(o) => { if (!o) { setUnmatching(null); setUnmatchReason('') } }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Unmatch this payment from {unmatching?.order.reference}?</DialogTitle>
            <DialogDescription>
              {unmatching && (
                <>
                  {naira(unmatching.payment.amount)}
                  {unmatching.payment.bankRef ? ` · ${unmatching.payment.bankRef}` : ''}
                  {paymentPayer(unmatching.payment) ? ` · ${paymentPayer(unmatching.payment)}` : ''}
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <p className="rounded-lg border border-foreground/15 bg-muted/30 p-3 text-sm text-muted-foreground">
              The bank line goes back to the unmatched pool, and this order is
              recalculated without it. Open the order it really belongs to and
              confirm it there — the line keeps its date, payer, reference and
              amount, so it will be exactly where you left it.
            </p>

            {/* An order mid-pipeline is the case worth stopping on: the money
                coming off may be what released it. */}
            {unmatching && ['Released', 'Loading', 'Completed'].includes(unmatching.order.status) && (
              <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-warning">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>
                  This order is <strong>{unmatching.order.status}</strong> — tickets may already
                  have been issued against it. Taking this payment off may leave it short of its
                  own value.
                </span>
              </p>
            )}

            <div className="space-y-1.5">
              <Label className={cn(MICRO, 'text-muted-foreground')}>Why (required)</Label>
              <Input
                autoFocus
                value={unmatchReason}
                onChange={(e) => setUnmatchReason(e.target.value)}
                placeholder="Matched to the wrong order"
                onKeyDown={(e) => { if (e.key === 'Enter' && unmatchReason.trim().length >= 3) e.currentTarget.blur() }}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setUnmatching(null); setUnmatchReason('') }}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={unmatchReason.trim().length < 3 || removePayment.isPending}
              onClick={async () => {
                if (!unmatching) return
                try {
                  await removePayment.mutateAsync({
                    orderId: unmatching.order.id,
                    paymentId: unmatching.payment.id,
                    reason: unmatchReason.trim(),
                  })
                  setUnmatching(null)
                  setUnmatchReason('')
                } catch {
                  // The mutation raises its own toast. The dialog stays open
                  // with the reason intact so it can be retried.
                }
              }}
            >
              {removePayment.isPending && <Loader2 className="mr-1.5 size-4 animate-spin" />}
              Unmatch and return to pool
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
