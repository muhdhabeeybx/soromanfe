import { useState } from 'react'
import { format } from 'date-fns'
import {
  Loader2, Plus, Trash2, AlertTriangle, Download, TriangleAlert, Info,
} from 'lucide-react'

import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '#/components/ui/dialog'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Badge } from '#/components/ui/badge'
import { MICRO, PANEL } from '#/lib/panel'
import { cn } from '#/lib/utils'
import {
  usePfiDetail, useAddPfiExpense, useDeleteExpense,
  type PfiFinancials,
} from '#/lib/hooks/usePfis'
import { useCreateVendor } from '#/lib/hooks/useVendors'
import { VendorField, type VendorFieldValue } from '#/components/VendorField'
import {
  naira, qty, pct, moneyTone, unitNames, SurplusDeficit, SellThroughBar, profitCaveat,
  pfiStatusLabel,
} from '#/routes/pfi/-pfi-utils'

/**
 * A label/value line in the detail dialog.
 *
 * Every value used to render at font-normal, so a section of eight rows had
 * nothing to land on and the figures that matter — landing cost, balance —
 * read exactly like the ones that don't.
 *
 * `emphasis` is the one figure a section is really about; `tone` is reserved
 * for values whose SIGN or state means something, so colour never becomes
 * decoration.
 */
function Row({
  label, value, tone, hint, emphasis = false, divider = false,
}: {
  label: string
  value: React.ReactNode
  tone?: string
  hint?: string
  emphasis?: boolean
  /** Rules a subtotal off from the lines that feed it. */
  divider?: boolean
}) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-4 py-2',
        divider && 'border-t border-foreground/15',
      )}
    >
      <div className="min-w-0">
        <p className={cn('text-sm', emphasis ? 'font-medium text-foreground' : 'text-muted-foreground')}>
          {label}
        </p>
        {hint && <p className="text-xs leading-tight text-muted-foreground/60">{hint}</p>}
      </div>
      <p
        className={cn(
          'shrink-0 tabular-nums',
          emphasis ? 'text-base font-semibold' : 'text-sm font-medium',
          tone || 'text-foreground',
        )}
      >
        {value}
      </p>
    </div>
  )
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-3 border-b border-foreground/10 pb-2">
        <p className={cn(MICRO, 'text-muted-foreground')}>{title}</p>
        {action}
      </div>
      <div className="divide-y divide-foreground/5">{children}</div>
    </div>
  )
}

/**
 * The headline quantities.
 *
 * Coastal shows two, side by side, because conflating them is the classic
 * error: you are billed for the BL figure and can only sell what measured into
 * the tank. Gantry has one quantity and no second figure to confuse it with,
 * so the slot goes to the ticket count instead of to a blank BL box.
 */
function QuantityPair({ f, unit, tickets }: {
  f: PfiFinancials
  unit?: string | null
  tickets?: number | null
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {f.isGantry ? (
        <>
          <div className={cn(PANEL, 'p-3')}>
            <p className={cn(MICRO, 'text-muted-foreground')}>Quantity</p>
            <p className="mt-1 text-lg font-semibold">{qty(f.tankQtyLitres, unit)}</p>
          </div>
          <div className={cn(PANEL, 'p-3')}>
            <p className={cn(MICRO, 'text-muted-foreground')}>Tickets</p>
            <p className="mt-1 text-lg font-semibold">
              {tickets == null ? '—' : tickets.toLocaleString('en-NG')}
            </p>
          </div>
        </>
      ) : (
        <>
          <div className={cn(PANEL, 'p-3')}>
            <p className={cn(MICRO, 'text-muted-foreground')}>BL quantity</p>
            <p className="mt-1 text-lg font-semibold">{qty(f.blQtyLitres, unit)}</p>
            {/* <p className="mt-0.5 text-xs leading-tight text-muted-foreground/70">
              From the shipping papers — what you pay for
            </p> */}
          </div>
          <div className={cn(PANEL, 'p-3')}>
            <p className={cn(MICRO, 'text-muted-foreground')}>Tank quantity</p>
            <p className="mt-1 text-lg font-semibold">{qty(f.tankQtyLitres, unit)}</p>
            {/* <p className="mt-0.5 text-xs leading-tight text-muted-foreground/70">
              Measured on discharge — what you sell from
            </p> */}
          </div>
        </>
      )}
    </div>
  )
}

export function PfiDetailDialog({
  pfiId, open, onOpenChange, onDownloadReport,
}: {
  pfiId: number | null
  open: boolean
  onOpenChange: (o: boolean) => void
  onDownloadReport?: (id: number) => void
}) {
  const { data, isLoading } = usePfiDetail(open ? pfiId : null)
  const addExpense = useAddPfiExpense()
  const deleteExpense = useDeleteExpense()
  const createVendor = useCreateVendor()

  const [draft, setDraft] = useState({ description: '', vendor: '', vendor_id: '', amount: '', bank: '' })
  const [saveNewVendor, setSaveNewVendor] = useState(true)
  const ready = draft.description.trim() && Number(draft.amount) > 0

  const submit = async () => {
    if (!pfiId) return

    let vendorId = draft.vendor_id ? Number(draft.vendor_id) : null
    if (!vendorId && draft.vendor.trim() && saveNewVendor) {
      try {
        const savedVendor = await createVendor.mutateAsync({ name: draft.vendor.trim() })
        vendorId = savedVendor?.id ? Number(savedVendor.id) : null
      } catch {
        // The vendor failed to save — the expense still goes through.
      }
    }

    await addExpense.mutateAsync({
      pfiId,
      data: {
        description: draft.description,
        vendor: draft.vendor,
        vendor_id: vendorId,
        amount: Number(draft.amount),
        bank_paid_from: draft.bank,
      },
    })
    setDraft({ description: '', vendor: '', vendor_id: '', amount: '', bank: '' })
    setSaveNewVendor(true)
  }

  const pfi = data?.pfi
  const f = pfi?.financials
  const caveat = f ? profitCaveat(f) : null
  const isGantry = !!f?.isGantry
  // Every quantity below is in the product's own unit — an LPG batch is
  // tonnes, and printing " L" after a tonnage is just a wrong figure.
  const unit = unitNames(pfi?.productUnit)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-3xl">
        {isLoading || !pfi || !f ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <DialogHeader>
              <div className="flex flex-wrap items-center gap-2">
                <DialogTitle className="break-all font-semibold">{pfi.pfiNumber}</DialogTitle>
                <Badge variant={pfi.status === 'active' ? 'default' : 'secondary'}>
                  {pfiStatusLabel(pfi.status)}
                </Badge>
                <Badge variant="outline">{isGantry ? 'Gantry' : 'Coastal'}</Badge>
              </div>
              <DialogDescription>
                {[pfi.productName, pfi.locationName].filter(Boolean).join(' · ') || 'No product or location set'}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-6">
              <QuantityPair f={f} unit={pfi.productUnit} tickets={pfi.ticketCount} />

              {/* A deficit is a real cost and nothing else in the system says so. */}
              {/* {f.deficitCost != null && (
                <div className="flex items-start gap-2.5 rounded-lg border border-destructive/25 bg-destructive/5 p-3">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
                  <div className="min-w-0 text-sm">
                    <p className="font-normal text-destructive">
                      Deficit of {litres(Math.abs(f.surplusDeficitLitres ?? 0))} — {naira(f.deficitCost)}
                    </p>
                    <p className="text-muted-foreground">
                      You were charged for the BL quantity but only the tank quantity arrived. That
                      gap is money spent on product you can never sell.
                    </p>
                  </div>
                </div>
              )} */}

              <Section title="Stock Details">
                {/* Sold means paid for, not loaded out — the same rule the
                    finance report uses, so the two always agree. */}
                <Row
                  label="Total Quantity Sold"
                  hint="Orders with payment confirmed"
                  value={qty(f.sold, pfi.productUnit)}
                  emphasis
                />
                <Row label="Quantity Remaining" value={qty(f.remaining, pfi.productUnit)} />
                {/* Only worth showing when loading is behind payment, which
                    is the case the two figures exist to tell apart. */}
                {f.movementQty > 0 && f.sold - f.movementQty > 0 && (
                  <Row
                    label="Sold but Unloaded"
                    hint="Paid for but not yet ticketed"
                    value={qty(f.sold - f.movementQty, pfi.productUnit)}
                    tone="text-warning"
                  />
                )}
                <div className="py-2.5">
                  <p className="mb-1.5 text-sm text-muted-foreground">Sales Progress</p>
                  <SellThroughBar value={f.sellThrough} />
                </div>
              </Section>

              <Section title="Financials">
                <Row
                  label={`Price per ${unit.singular.toLowerCase()}`} value={naira(f.pricePerLitre)}
                />
                <Row
                  label={isGantry ? 'PFI Value' : 'PFI (Cargo) Value'} value={naira(f.pfiValue)}
                  // hint="BL quantity × price per litre"
                />
                {isGantry && (
                  <Row
                    label="Number of Tickets"
                    value={pfi.ticketCount == null ? '—' : pfi.ticketCount.toLocaleString('en-NG')}
                  />
                )}
                <Row
                  label={`Total Expenses`}
                  // label={`Total Expenses (${data.expenses.length} line${data.expenses.length === 1 ? '' : 's'})`}
                  value={naira(f.totalExpenses)}
                />
                {f.pendingExpenses > 0 && (
                  <Row
                    label="Pending Expenses"
                    hint="Outside the cost above"
                    value={naira(f.pendingExpenses)}
                    tone="text-warning"
                  />
                )}
                {/* A credit reduces what the batch cost, so it reads as a gain
                    rather than as another cost line — and it is shown BEFORE
                    the total, so the total is the last figure in the column
                    and is the one everything below divides. */}
                {f.creditBalance > 0 && (
                  <>
                    <Row label="Cost before credit" value={naira(f.totalCost)} divider />
                    <Row
                      label={isGantry ? 'Credit Note' : 'Credit Balance'}
                      value={`-${naira(f.creditBalance)}`}
                      tone="text-accent"
                    />
                  </>
                )}
                <Row
                  label="Total Cost"
                  value={naira(f.grandTotalCost)}
                  divider={f.creditBalance === 0}
                  hint={f.creditBalance > 0 ? 'After the credit above' : undefined}
                />
                {/* Total Cost ÷ the billed quantity — the same Total Cost
                    printed two lines above, so the arithmetic on this panel
                    can be checked by eye. It divided the credit-adjusted
                    figure before, which meant that on any batch carrying a
                    credit note the two numbers on screen simply did not
                    reconcile and there was no way to tell that from here. */}
                <Row
                  label={`Landing cost/${unit.singular.toLowerCase()}`}
                  hint={`Total cost ÷ ${isGantry ? 'quantity' : 'BL quantity'}`}
                  value={naira(f.landingCostPerLitre)}
                  emphasis
                />
                {/* Only worth showing when the two bases actually differ —
                    which is exactly when there was a discharge shortage, and
                    the gap between them is what that shortage cost. */}
                {!isGantry
                  && f.landingCostPerLitreTank != null
                  && f.landingCostPerLitre != null
                  && Math.abs(f.landingCostPerLitreTank - f.landingCostPerLitre) >= 0.01 && (
                  <Row
                    label="— against tank quantity"
                    hint={`What it really cost per ${unit.singular.toLowerCase()} that landed`}
                    value={naira(f.landingCostPerLitreTank)}
                    tone="text-warning"
                  />
                )}
                <Row
                  label={isGantry ? 'Sales Value' : 'Total Revenue'}
                  // label={`Total Revenue (${pfi.orderCount} order${pfi.orderCount === 1 ? '' : 's'})`}
                  value={naira(f.revenue)}
                  tone="text-accent"
                  divider
                  hint={isGantry ? 'Orders on this PFI with payment confirmed' : undefined}
                  // hint="Invoiced value on paid, released, loading and completed orders"
                />
                <Row
                  label="Balance" value={naira(f.profitLoss)} tone={moneyTone(f.profitLoss)}
                  emphasis
                />
                <Row label="Margin" value={pct(f.margin)} tone={moneyTone(f.margin)} />
                {/* Only coastal measures twice, so only coastal can have a gap. */}
                {!isGantry && (
                  <Row
                    label="Surplus/Deficit"
                    value={<SurplusDeficit litres={f.surplusDeficitLitres} unit={pfi.productUnit} />}
                  />
                )}
              </Section>

              {/* The most important thing on the page when a batch is in flight. */}
              {caveat && (
                <div className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/5 p-3">
                  <Info className="mt-0.5 size-4 shrink-0 text-warning" />
                  <div className="min-w-0 text-sm">
                    <p className="font-normal text-warning">Balance is not meaningful yet</p>
                    <p className="text-muted-foreground">{caveat}</p>
                    {/* {f.costOfSold != null && (
                      <p className="mt-1.5 text-muted-foreground">
                        Cost of the portion actually sold: <span className="font-normal">{naira(f.costOfSold)}</span>
                        {f.marginOnSold != null && (
                          <> · margin on that portion <span className={cn('font-normal', moneyTone(f.marginOnSold))}>{pct(f.marginOnSold)}</span></>
                        )}
                      </p>
                    )} */}
                  </div>
                </div>
              )}

              {/* Closing figures are typed by hand while the system computes the
                  same quantities. Show both so the gap is visible. */}
              {pfi.status === 'finished' && (
                <Section title="Closure">
                  <Row label="Closed on" value={pfi.closureDate ? format(new Date(pfi.closureDate), 'd MMM yyyy') : '—'} />
                  <Row label="Confirmed By" value={pfi.closureHandler || '—'} />
                  <Row label="Bank" value={pfi.closureBank || '—'} />
                  <Row label="Total Inflow" value={naira(Number(pfi.totalInflow) || null)} />
                  <Row
                    label="Purchase cost" value={naira(Number(pfi.purchaseCost) || null)}
                    // hint={`System computes ${naira(f.pfiValue)}`}
                    tone={
                      Number(pfi.purchaseCost) > 0 && f.pfiValue != null &&
                      Math.abs(Number(pfi.purchaseCost) - f.pfiValue) >= 0.01
                        ? 'text-warning' : undefined
                    }
                  />
                  <Row
                    label="Aggregate expenses" value={naira(Number(pfi.aggregateExpenses) || null)}
                    // hint={`System computes ${naira(f.totalExpenses)}`}
                    tone={
                      Number(pfi.aggregateExpenses) > 0 &&
                      Math.abs(Number(pfi.aggregateExpenses) - f.totalExpenses) >= 0.01
                        ? 'text-warning' : undefined
                    }
                  />
                  {pfi.closureRemarks && <Row label="Remarks" value={pfi.closureRemarks} />}
                </Section>
              )}

              {/* ── How each figure was reached ───────────────────────────
                  Collapsed by default: the panel above is what people come
                  here for, and this is what they need the first time — or the
                  time a number looks wrong and the question is which sum
                  produced it. The formulas arrive from the server, from the
                  same file that does the arithmetic, so they cannot drift
                  away from what was actually computed. */}
              {(data.explain?.length ?? 0) > 0 && (
                <details className="rounded-lg border border-foreground/10 bg-muted/20">
                  <summary className="cursor-pointer px-4 py-3 text-sm font-medium hover:bg-muted/40 rounded-lg">
                    How each figure is worked out
                  </summary>
                  <div className="divide-y divide-foreground/5 border-t border-foreground/10">
                    {data.explain.map((item) => (
                      <div key={item.key} className="px-4 py-3 space-y-1">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="text-sm font-medium">{item.label}</span>
                          <span className="text-sm font-semibold tabular-nums">{item.value}</span>
                        </div>
                        <p className="text-xs text-muted-foreground">{item.formula}</p>
                        {/* The sum with this batch's own numbers in it, so the
                            figure above can be checked without a calculator. */}
                        <p className="font-mono text-xs text-muted-foreground break-words">{item.workings}</p>
                        <p className={cn(
                          'text-xs',
                          item.meaning.startsWith('READ WITH CARE') ? 'text-warning' : 'text-muted-foreground',
                        )}>
                          {item.meaning}
                        </p>
                      </div>
                    ))}
                  </div>
                </details>
              )}

              <Section
                title={`Expenses · ${naira(f.totalExpenses)}`}
                action={
                  onDownloadReport && (
                    <Button variant="ghost" size="sm" onClick={() => onDownloadReport(Number(pfi.id))}>
                      <Download data-icon="inline-start" />
                      Report
                    </Button>
                  )
                }
              >
                {data.expenses.length === 0 ? (
                  <p className="py-3 text-sm text-muted-foreground">No expenses booked yet.</p>
                ) : (
                  <ul className="divide-y divide-foreground/5">
                    {data.expenses.map((e) => (
                      <li key={e.id} className="flex items-start justify-between gap-3 py-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm">{e.description || 'Untitled'}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {[
                              format(new Date(e.expense_date), 'd MMM yyyy'),
                              e.vendor,
                              e.bank_paid_from,
                            ].filter(Boolean).join(' · ')}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <span className="text-sm font-normal">{naira(Number(e.amount))}</span>
                          <Button
                            variant="ghost" size="icon-sm"
                            disabled={deleteExpense.isPending}
                            onClick={() => deleteExpense.mutate(e.id)}
                          >
                            <Trash2 /><span className="sr-only">Delete expense</span>
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                {/* Quick-add. The category is this PFI's own, resolved server-side,
                    so the row is identical to one added on the expenses page. */}
                {/* <div className="grid gap-2 pt-3 sm:grid-cols-[1fr_9rem_auto]">
                  <Input
                    placeholder="What was it for" value={draft.description}
                    onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                  />
                  <Input
                    type="number" placeholder="Amount" value={draft.amount}
                    onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value }))}
                  />
                  <Button variant="outline" size="sm" disabled={!ready || addExpense.isPending} onClick={submit}>
                    {addExpense.isPending ? <Loader2 className="animate-spin" /> : <Plus data-icon="inline-start" />}
                    Add
                  </Button>
                  <div className="sm:col-span-1">
                    <VendorField
                      value={{ vendor: draft.vendor, vendor_id: draft.vendor_id, saveNew: saveNewVendor }}
                      onChange={(v: VendorFieldValue) => {
                        setDraft((d) => ({ ...d, vendor: v.vendor, vendor_id: v.vendor_id }))
                        setSaveNewVendor(v.saveNew)
                      }}
                    />
                  </div>
                  <Input
                    className="sm:col-span-2" placeholder="Bank paid from (optional)" value={draft.bank}
                    onChange={(e) => setDraft((d) => ({ ...d, bank: e.target.value }))}
                  />
                </div> */}
              </Section>

              <Section title="Officers">
                <Row label="Audit/Finance" value={pfi.auditOfficerName || '—'} />
                <Row label="Sales Manager" value={pfi.salesManagerName || '—'} />
                <Row label="Product Manager" value={pfi.productOfficerName || '—'} />
                <Row label="IT Compliance" value={pfi.itComplianceOfficerName || '—'} />
                <Row label="Exit Gate" value={pfi.securityExitOfficerName || '—'} />
                <Row label="Commission Officer" value={pfi.commissionOfficerName || '—'} />
              </Section>

              {/* No vessel ever carried a gantry batch, so four dashes here
                  would be answering a question that was never asked. */}
              {!isGantry && (
                <Section title="Vessel Details">
                  <Row label="Vessel Name" value={pfi.vesselName || '—'} />
                  <Row label="Vessel Broker" value={pfi.vesselBroker || '—'} />
                  <Row label="Surveyor'" value={pfi.surveyorName || '—'} />
                  <Row label="Surveyor's Phone No." value={pfi.surveyorPhone || '—'} />
                </Section>
              )}

              {/* ── The sales, not the stock movements ─────────────────────
                  This listed pfi_movements — the ticketing ledger — under a
                  heading of "Orders". The two are different facts and they
                  diverge routinely: PFI/43/26 has four paid orders worth ₦456m
                  and not a single movement row, because nothing has been
                  ticketed out yet, so the panel read as empty on a batch that
                  had made half a billion naira.

                  Now it lists orders whose payment is confirmed — the same
                  rule behind the revenue and sold figures above, so this panel
                  and those totals cannot disagree. Loading progress rides
                  along per row instead of deciding what is listed. */}
              <Section title={`Orders · ${data.orders.length}`}>
                {data.orders.length === 0 ? (
                  <p className="py-3 text-sm text-muted-foreground">
                    No order against this PFI has had its payment confirmed yet.
                    {f.tankQtyLitres > 0 && (
                      <> The whole {qty(f.tankQtyLitres, pfi.productUnit)} still shows as remaining.</>
                    )}
                  </p>
                ) : (
                  <ul className="max-h-56 divide-y divide-foreground/5 overflow-y-auto">
                    {data.orders.slice(0, 50).map((o) => {
                      const loaded = Number(o.loaded_qty || 0)
                      const ordered = Number(o.quantity || 0)
                      return (
                        <li key={o.id} className="flex items-start justify-between gap-3 py-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm">{o.order_number || `Order #${o.id}`}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {[o.customer_name, format(new Date(o.created_at), 'd MMM yyyy')]
                                .filter(Boolean).join(' · ')}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-sm font-normal">{qty(ordered, pfi.productUnit)}</p>
                            {/* Paid is not gone. Saying which of the two this
                                row is, is the whole reason the panel changed. */}
                            <p className={cn(
                              'text-xs',
                              loaded === 0 ? 'text-warning'
                                : loaded < ordered ? 'text-warning' : 'text-muted-foreground',
                            )}>
                              {loaded === 0
                                ? 'Paid, not yet loaded'
                                : loaded < ordered
                                  ? `${qty(loaded, pfi.productUnit)} loaded`
                                  : 'Loaded'}
                            </p>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </Section>

              {/* Closed with stock on the books almost always means unrecorded
                  releases rather than genuinely unsold product. */}
              {/* {pfi.status === 'finished' && f.remaining > 0 && (
                <div className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/5 p-3">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                  <p className="text-sm text-muted-foreground">
                    This batch is closed but <span className="font-normal text-foreground">{litres(f.remaining)}</span>{' '}
                    still shows as remaining. Either that stock is genuinely unsold, or movements were
                    never recorded against it — worth checking before the loss is reported upward.
                  </p>
                </div>
              )} */}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
