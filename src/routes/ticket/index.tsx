import { useMemo, useState } from 'react'
import { PageHeader } from '#/components/PageHeader'
import { createFileRoute } from '@tanstack/react-router'
import { format, isWithinInterval } from 'date-fns'
import {
  Search, Droplets, PackageCheck, Truck, CircleDashed, FileSpreadsheet, Loader2,
  Plus, Eye, Pencil,
} from 'lucide-react'

import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { StatCard, StatCardGrid } from '#/components/ui/stat-card'
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '#/components/ui/select'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '#/components/ui/table'
import { PageLoader } from '#/components/PageLoader'
import { PageError } from '#/components/PageError'
import { PageEmpty } from '#/components/PageEmpty'
import { Pagination } from '#/components/Pagination'
import { TicketGenerateDialog } from '#/components/TicketGenerateDialog'
import { TicketPrintDialog } from '#/components/TicketPrintDialog'
import { TruckEditDialog } from '#/components/TruckEditDialog'
import { PANEL, MICRO, PANEL_RAIL } from '#/lib/panel'
import { cn } from '#/lib/utils'
import { useAllOrders } from '#/lib/hooks/useOrders'
import { useOrderForTicketing, type TruckLoad } from '#/lib/hooks/useTickets'
import {
  DATE_PRESETS, resolveRange, toNumber, formatQty, type DatePreset,
} from '#/routes/orders/-orders-utils'
import { routeGuard } from '#/lib/route-guard'

// QR ticket scanning used to live on this page. It is disabled but kept
// verbatim in ./qr-scanner-disabled.txt.

export const Route = createFileRoute('/ticket/')({
  beforeLoad: () => routeGuard('/ticket'),
  component: LoadingTicketsPage,
})

/**
 * The payment states that put an order on the loading desk.
 *
 * Part Paid belongs here: an order settled in instalments is Released and
 * ticketable up to the quantity its payment covers. Module scope because it
 * never changes — declared in the component it would be a new Set every
 * render, and one the filter's dependency list does not mention.
 */
const PAYING = new Set(['Paid', 'Part Paid'])

const ALL = 'all'
const PAGE_SIZE = 10000

function LoadingTicketsPage() {
  const [search, setSearch] = useState('')
  // Opens on the month, not the day: order volume is low enough that
  // "Today" is usually empty, which reads as a broken page rather than a
  // quiet day. Change to 'today' if you'd rather it open narrow.
  const [datePreset, setDatePreset] = useState<DatePreset>('month')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [productFilter, setProductFilter] = useState(ALL)
  const [locationFilter, setLocationFilter] = useState(ALL)
  const [statusFilter, setStatusFilter] = useState(ALL)
  const [pfiFilter, setPfiFilter] = useState(ALL)
  const [page, setPage] = useState(1)

  const [ticketOrder, setTicketOrder] = useState<any | null>(null)
  const [printOrder, setPrintOrder] = useState<any | null>(null)
  const [editOrder, setEditOrder] = useState<any | null>(null)
  const [exporting, setExporting] = useState(false)

  const { data, isLoading, isError, error, refetch } = useAllOrders()
  const orders: any[] = useMemo(() => {
    const list = data?.orders || []
    return [...list].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }, [data?.orders])

  // Loads for whichever order currently has a dialog open.
  const { data: openOrder } = useOrderForTicketing(ticketOrder?.id ?? printOrder?.id ?? editOrder?.id ?? undefined)
  const openLoads: TruckLoad[] = openOrder?.trucks || []

  const options = useMemo(() => {
    const uniq = (v: (string | null | undefined)[]) =>
      [...new Set(v.filter((x): x is string => Boolean(x)))].sort()
    return {
      products: uniq(orders.map((o) => o.productName)),
      locations: uniq(orders.map((o) => o.depotName || o.state)),
      statuses: uniq(orders.map((o) => o.status)),
      pfis: uniq(orders.map((o) => o.pfiNumber)),
    }
  }, [orders])

  const range = useMemo(
    () => resolveRange(datePreset, {
      from: customFrom ? new Date(customFrom) : undefined,
      to: customTo ? new Date(customTo) : undefined,
    }),
    [datePreset, customFrom, customTo],
  )

  // Only orders that have taken money reach the loading desk — payment status,
  // not lifecycle status, since a paid order stays paid all the way through
  // Loading/Completed.
  //
  // Part Paid counts. An order settled in instalments is Released and
  // ticketable up to the quantity its payment covers, so filtering it out here
  // hid the entire point of part payment: the customer has paid for 50,000 of
  // their 100,000 litres and cannot collect any of it because the desk cannot
  // see the order. The cap on HOW MUCH may be ticketed is the server's to
  // enforce — it holds the price and the amount received — and it refuses an
  // over-request with the figures in the message.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return orders.filter((o) => {
      if (!PAYING.has(String(o.paymentStatus))) return false
      if (range) {
        if (!o.createdAt) return false
        if (!isWithinInterval(new Date(o.createdAt), { start: range.from, end: range.to })) return false
      }
      if (productFilter !== ALL && o.productName !== productFilter) return false
      if (locationFilter !== ALL && (o.depotName || o.state) !== locationFilter) return false
      if (statusFilter !== ALL && o.status !== statusFilter) return false
      if (pfiFilter !== ALL && o.pfiNumber !== pfiFilter) return false
      if (!q) return true
      return [
        o.orderNumber, o.customerName, o.companyName || o.customerCompanyName,
        o.depotName, o.state, o.productName, o.pfiNumber,
      ].some((f) => String(f ?? '').toLowerCase().includes(q))
    })
  }, [orders, range, productFilter, locationFilter, statusFilter, pfiFilter, search])

  const totals = useMemo(() => {
    // Sold counts every order on the desk, loaded or not.
    const sold = filtered.reduce((s, o) => s + toNumber(o.quantity), 0)
    const loadedOrders = filtered.filter((o) => ['Loading', 'Completed'].includes(String(o.status)))
    const loaded = loadedOrders.reduce((s, o) => s + toNumber(o.quantity), 0)
    const awaiting = filtered.filter((o) => ['Paid', 'Released'].includes(String(o.status))).length
    return { sold, loaded, shortfall: sold - loaded, trucksLoaded: loadedOrders.length, awaiting }
  }, [filtered])

  const clearAll = () => {
    setSearch(''); setDatePreset('all'); setProductFilter(ALL)
    setLocationFilter(ALL); setStatusFilter(ALL); setPfiFilter(ALL)
    setCustomFrom(''); setCustomTo(''); setPage(1)
  }

  const totalPages = Math.max(Math.ceil(filtered.length / PAGE_SIZE), 1)
  const current = Math.min(page, totalPages)
  const rows = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)

  const downloadReport = async () => {
    setExporting(true)
    try {
      const ExcelJS = (await import('exceljs')).default
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet('Loading tickets')
      ws.columns = [
        { header: 'S/N', key: 'sn', width: 6 },
        { header: 'Reference', key: 'ref', width: 20 },
        { header: 'Date Loaded', key: 'date', width: 18 },
        { header: 'Customer', key: 'customer', width: 26 },
        { header: 'Company', key: 'company', width: 24 },
        { header: 'Location', key: 'location', width: 22 },
        { header: 'Product', key: 'product', width: 22 },
        { header: 'Quantity', key: 'qty', width: 14 },
        { header: 'PFI', key: 'pfi', width: 16 },
        { header: 'Status', key: 'status', width: 14 },
      ]
      ws.getRow(1).font = { bold: true }
      filtered.forEach((o, i) => {
        ws.addRow({
          sn: i + 1,
          ref: o.orderNumber,
          date: o.loadingStartedAt ? format(new Date(o.loadingStartedAt), 'yyyy-MM-dd HH:mm') : '',
          customer: o.customerName ?? '',
          company: o.companyName ?? o.customerCompanyName ?? '',
          location: o.depotName ?? o.state ?? '',
          product: o.productName ?? '',
          qty: toNumber(o.quantity),
          pfi: o.pfiNumber ?? '',
          status: o.status,
        })
      })
      const buf = await wb.xlsx.writeBuffer()
      const url = URL.createObjectURL(
        new Blob([buf], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
      )
      const a = document.createElement('a')
      a.href = url
      a.download = `loading-tickets_${format(new Date(), 'yyyy-MM-dd')}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

  let sn = (current - 1) * PAGE_SIZE

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
      eyebrow="Operations"
      title="Loading Tickets"
      description="Generate loading tickets for paid orders, capture truck details, and export reports."
      actions={
        <>
          <Button variant="outline" size="sm" onClick={downloadReport} disabled={exporting}>
          {exporting ? <Loader2 className="animate-spin" /> : <FileSpreadsheet data-icon="inline-start" />}
          Download Report
          </Button>
        </>
      }
    />

      {isLoading ? (
        <PageLoader message="Loading orders…" />
      ) : isError ? (
        <PageError message={(error as any)?.message || 'Could not load orders.'} onRetry={() => refetch()} />
      ) : (
        <>
          <StatCardGrid count={4}>
            <StatCard
              icon={<Droplets />} label="Quantity sold" value={formatQty(totals.sold)}
              // description="Ordered, loaded or not"
            />
            <StatCard
              // Amber while short, green once everything is out.
              tone={totals.shortfall > 0 ? 'amber' : 'green'}
              icon={<PackageCheck />} label="Quantity loaded" value={formatQty(totals.loaded)}
              // description={
              //   totals.shortfall > 0
              //     ? `${formatQty(totals.shortfall)} litres not yet loaded`
              //     : 'All loaded'
              // }
            />
            <StatCard icon={<Truck />} label="Trucks loaded" value={formatQty(totals.trucksLoaded)} />
            <StatCard
              tone={totals.awaiting > 0 ? 'amber' : 'green'}
              icon={<CircleDashed />} label="Trucks awaiting tickets"
              value={formatQty(totals.awaiting)}
            />
          </StatCardGrid>

          <section className={PANEL}>
            <div className={PANEL_RAIL}>
              <span className={MICRO}>Filters</span>
              <button
                type="button" onClick={clearAll}
                className="text-xs text-accent underline-offset-4 outline-none hover:underline focus-visible:underline"
              >
                Clear all
              </button>
            </div>

            <div className="space-y-4 px-6 pt-5 pb-6">
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                  placeholder="Search reference, customer, location, product or PFI…"
                  className="pl-9"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {DATE_PRESETS.map((p) => (
                  <button
                    key={p.value} type="button"
                    onClick={() => { setDatePreset(p.value); setPage(1) }}
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
                <div className="flex items-center gap-1.5">
                  <Input
                    type="date" value={customFrom} aria-label="Custom range start"
                    onChange={(e) => { setCustomFrom(e.target.value); setDatePreset('custom'); setPage(1) }}
                    className="h-7 w-[9.5rem] text-xs"
                  />
                  <span className="text-xs text-muted-foreground">to</span>
                  <Input
                    type="date" value={customTo} aria-label="Custom range end"
                    onChange={(e) => { setCustomTo(e.target.value); setDatePreset('custom'); setPage(1) }}
                    className="h-7 w-[9.5rem] text-xs"
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {([
                  ['All products', productFilter, setProductFilter, options.products],
                  ['All locations', locationFilter, setLocationFilter, options.locations],
                  ['All statuses', statusFilter, setStatusFilter, options.statuses],
                  ['All PFIs', pfiFilter, setPfiFilter, options.pfis],
                ] as const).map(([label, value, setter, list]) => (
                  <Select
                    key={label} value={value}
                    onValueChange={(v) => { (setter as (s: string) => void)(v); setPage(1) }}
                  >
                    <SelectTrigger><SelectValue placeholder={label} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>{label}</SelectItem>
                      {list.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ))}
              </div>
            </div>
          </section>

          <section className={PANEL}>
            <div className={PANEL_RAIL}>
              <span className={MICRO}>
                {formatQty(filtered.length)} order{filtered.length === 1 ? '' : 's'}
              </span>
            </div>

            {filtered.length === 0 ? (
              <PageEmpty
                title="No orders match these filters"
                description="Widen the date range or clear a filter to see more."
                hasFilters
                onClearFilters={clearAll}
              />
            ) : (
              <div className="px-2 pb-2">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">S/N</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead>Date Loaded</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Company</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">Quantity</TableHead>
                      <TableHead>PFI</TableHead>
                      {/* Truck No., Driver, Tickets and Status columns are
                          deliberately not rendered — they belong to the ticket
                          rather than the order, and the row would not fit. */}
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((o) => {
                      sn += 1
                      return (
                        <OrderRow
                          key={o.id}
                          sn={sn}
                          order={o}
                          onGenerate={() => setTicketOrder(o)}
                          onView={() => setPrintOrder(o)}
                          onEdit={() => setEditOrder(o)}
                        />
                      )
                    })}
                  </TableBody>
                </Table>

                <div className="px-4">
                  <Pagination
                    currentPage={current}
                    totalPages={totalPages}
                    pageSize={PAGE_SIZE}
                    totalItems={filtered.length}
                    onPageChange={setPage}
                    onPageSizeChange={() => {}}
                  />
                </div>
              </div>
            )}
          </section>
        </>
      )}

      <TicketGenerateDialog
        order={ticketOrder}
        loads={ticketOrder ? openLoads : []}
        open={ticketOrder !== null}
        onOpenChange={(o) => { if (!o) setTicketOrder(null) }}
        // Closes over the same ticketOrder this dialog was opened with — the
        // dialog calls onOpenChange(false) and onGenerated synchronously back
        // to back, before this component re-renders, so the reference is
        // still the right order.
        onGenerated={() => setPrintOrder(ticketOrder)}
      />

      <TicketPrintDialog
        orderId={printOrder?.id ?? undefined}
        orderNumber={printOrder?.orderNumber}
        loads={printOrder ? openLoads : []}
        open={printOrder !== null}
        onOpenChange={(o) => { if (!o) setPrintOrder(null) }}
        onEdit={() => { setEditOrder(printOrder); setPrintOrder(null) }}
      />

      <TruckEditDialog
        orderId={editOrder?.id ?? null}
        orderNumber={editOrder?.orderNumber}
        loads={editOrder ? openLoads : []}
        open={editOrder !== null}
        onOpenChange={(o) => { if (!o) setEditOrder(null) }}
      />
    </div>
  )
}

/**
 * One order row.
 *
 * "Fully ticketed" keys off **ticketed quantity, never order status**. An
 * order flips to Loading the moment the first ticket exists, so status alone
 * would lock out the remaining trucks on a 90,000 L order with only 45,000 L
 * ticketed. `allocated >= releasable` is the honest test.
 *
 * The three actions are independent, not a single state-driven button: a
 * ticket someone already printed still needs reprinting after the truck has
 * gated out, so View stays available for as long as a ticket exists at all —
 * it does not disappear the moment Add or Edit does.
 */
function OrderRow({
  sn, order, onGenerate, onView, onEdit,
}: {
  sn: number
  order: any
  onGenerate: () => void
  onView: () => void
  onEdit: () => void
}) {
  const { data } = useOrderForTicketing(order.id)
  const loads: TruckLoad[] = data?.trucks || []
  const allocated = loads.reduce((s, l) => s + toNumber(l.quantity), 0)
  const releasable = toNumber(order.quantity)

  const fullyTicketed = releasable > 0 && allocated >= releasable
  const hasTickets = loads.length > 0
  const departed = hasTickets && loads.every((l) => l.status === 'gated_out')

  return (
    <TableRow>
      <TableCell className="text-muted-foreground">{sn}</TableCell>
      <TableCell className="font-semibold text-accent">{order.orderNumber}</TableCell>
      <TableCell className="text-muted-foreground">
        {order.loadingStartedAt ? format(new Date(order.loadingStartedAt), 'd MMM yyyy') : '—'}
      </TableCell>
      <TableCell className="max-w-[14rem] truncate font-medium">{order.customerName || '—'}</TableCell>
      <TableCell className="max-w-[12rem] truncate text-muted-foreground">{order.companyName || order.customerCompanyName || '—'}</TableCell>
      <TableCell>{order.depotName || order.state || '—'}</TableCell>
      <TableCell className="max-w-[12rem] truncate">{order.productName || '—'}</TableCell>
      <TableCell className="text-right">
        {formatQty(releasable)}
        {allocated > 0 && allocated < releasable && (
          <span className="ml-1 text-xs text-warning">({formatQty(allocated)} out)</span>
        )}
      </TableCell>
      <TableCell className="text-muted-foreground">{order.pfiNumber || '—'}</TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-1.5">
          {hasTickets && (
            <Button variant="outline" size="icon-sm" onClick={onView} title="View / reprint ticket">
              <Eye />
              <span className="sr-only">View ticket</span>
            </Button>
          )}
          {hasTickets && !departed && (
            <Button variant="outline" size="icon-sm" onClick={onEdit} title="Edit truck details">
              <Pencil />
              <span className="sr-only">Edit ticket</span>
            </Button>
          )}
          {!fullyTicketed && (
            <Button
              variant={allocated === 0 ? 'default' : 'outline'} size="sm"
              onClick={onGenerate}
            >
              <Plus data-icon="inline-start" />
              Add Ticket
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  )
}
