import { useState, useMemo, useCallback } from 'react'
import { FilterBar } from '#/components/FilterBar'
import { PageHeader } from '#/components/PageHeader'

import { createFileRoute } from '@tanstack/react-router'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { CommaInput } from '#/components/ui/comma-input'
import { Label } from '#/components/ui/label'
import { Card, CardContent } from '#/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '#/components/ui/dialog'
import { ConfirmDialog } from '#/components/ConfirmDialog'
import { DollarSign, Search, X, RefreshCw, CheckCircle, Fuel, FileText, Download, Loader2, Banknote, Package, MinusCircle, Clock } from 'lucide-react'
import {
  useCommissions, useCommissionSummary, useConfirmCommissionPayment,
  useSkipCommission, useBulkResolveCommissions,
} from '#/lib/hooks/useCommissions'
import { cn } from '#/lib/utils'
import { NativeSelect } from '#/components/ui/native-select'
import { useDepots } from '#/lib/hooks/useDepots'

import { SummaryCards, type SummaryCard } from '#/components/SummaryCards'
import { PageLoader } from '#/components/PageLoader'
import { PageError } from '#/components/PageError'
import { PageEmpty } from '#/components/PageEmpty'
import type { Commission, CommissionRate } from '#/lib/types'
import { routeGuard } from '#/lib/route-guard'
import { PhoneLink } from '#/components/ContactLink'

export const Route = createFileRoute('/commissions/')({
  beforeLoad: () => routeGuard('/commissions'),
  component: CommissionsPage,
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatNaira(amount: number) {
  return `₦${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

type SortKey = 'date' | 'date_asc' | 'pfi' | 'facilitator' | 'amount'

const QUICK_DATES = [
  { label: 'Today', value: 'today' },
  { label: 'Yesterday', value: 'yesterday' },
  { label: 'This Week', value: 'this_week' },
  { label: 'This Month', value: 'this_month' },
  { label: 'This Year', value: 'this_year' },
  { label: 'All Time', value: 'all' },
] as const

function getDateRange(preset: string): { dateFrom: string; dateTo: string } {
  const now = new Date()
  const fmt = (d: Date) => d.toISOString().split('T')[0]
  switch (preset) {
    case 'today':
      return { dateFrom: fmt(now), dateTo: fmt(now) }
    case 'yesterday': {
      const y = new Date(now)
      y.setDate(y.getDate() - 1)
      return { dateFrom: fmt(y), dateTo: fmt(y) }
    }
    case 'this_week': {
      const start = new Date(now)
      start.setDate(start.getDate() - start.getDay())
      return { dateFrom: fmt(start), dateTo: fmt(now) }
    }
    case 'this_month': {
      const start = new Date(now.getFullYear(), now.getMonth(), 1)
      return { dateFrom: fmt(start), dateTo: fmt(now) }
    }
    case 'this_year': {
      const start = new Date(now.getFullYear(), 0, 1)
      return { dateFrom: fmt(start), dateTo: fmt(now) }
    }
    default:
      return { dateFrom: '', dateTo: '' }
  }
}

// ─── Main Component ──────────────────────────────────────────────────────────

function CommissionsPage() {

  return (
    <div className="space-y-6 animate-fade-in">
      <CommissionsTab />
    </div>
  )
}

// ─── Commissions Tab ─────────────────────────────────────────────────────────

function CommissionsTab() {
  const [searchQuery, setSearchQuery] = useState('')
  const [depotFilter, setDepotFilter] = useState('all')
  /**
   * Today, not all time.
   *
   * The page is worked daily: what came in today is the question, and opening
   * on every commission ever raised meant scrolling past months of settled
   * rows to reach it. Every other range is one button away.
   */
  const [datePreset, setDatePreset] = useState('today')
  const [customDateFrom, setCustomDateFrom] = useState('')
  const [customDateTo, setCustomDateTo] = useState('')


  /**
   * Which commissions to list.
   *
   * The page used to send status: 'pending' and nothing else, so a confirmed
   * commission simply vanished and a skipped one would have had nowhere to be
   * seen at all. Still opens on Pending — this is a work queue, and what is
   * outstanding is the question it exists to answer — but the other two are
   * now one select away rather than unreachable.
   */
  const [statusFilter, setStatusFilter] = useState<'pending' | 'paid' | 'skipped' | 'all'>('pending')

  /**
   * PFI, as a filter and as a sort.
   *
   * Commissions are settled a batch at a time — "everything on PFI-40B" — and
   * until now the only way to see one batch was to read the references. Held
   * as the PFI number rather than an id because that is what the row shows and
   * what somebody has written down.
   */
  const [pfiFilter, setPfiFilter] = useState('all')
  const [sortKey, setSortKey] = useState<SortKey>('date')

  // Confirm Commission dialog
  const [confirmTarget, setConfirmTarget] = useState<Commission | null>(null)
  const confirmMutation = useConfirmCommissionPayment()

  /**
   * Skipping: the second exit, for an order that carries no commission.
   *
   * A reason is taken here rather than assumed, because the server requires
   * one and, more to the point, the row outlives everyone's memory of the
   * order — "why was this not paid" is the only question it will ever be
   * asked.
   */
  const [skipTarget, setSkipTarget] = useState<Commission | null>(null)
  const [skipReason, setSkipReason] = useState('')
  const skipMutation = useSkipCommission()

  /**
   * Selection, and what may be in it.
   *
   * Only pending rows can be ticked: a paid commission has already credited
   * somebody and a skipped one has already been decided, so neither is
   * something a bulk action could do anything with. Held by id rather than by
   * row so a refetch, a page change or a filter cannot quietly re-point the
   * selection at different commissions.
   */
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [bulkAction, setBulkAction] = useState<'confirm' | 'skip' | null>(null)
  const [bulkReason, setBulkReason] = useState('')
  const bulkMutation = useBulkResolveCommissions()

  // Daily Report dialog
  const [showDailyReport, setShowDailyReport] = useState(false)

  const { data: depots = [] } = useDepots()

  const dateRange = useMemo(() => {
    if (datePreset === 'custom') {
      return { dateFrom: customDateFrom, dateTo: customDateTo }
    }
    return getDateRange(datePreset)
  }, [datePreset, customDateFrom, customDateTo])

  const queryParams = useMemo(
    () => ({
      search: searchQuery || undefined,
      status: statusFilter,
      depotId: depotFilter !== 'all' ? depotFilter : undefined,
      dateFrom: dateRange.dateFrom || undefined,
      dateTo: dateRange.dateTo || undefined,
      /**
       * The whole filtered set, unpaginated.
       *
       * A day's commissions are tens of rows, and paging them meant a bulk
       * selection could only ever cover what happened to be on screen. 1000 is
       * the server's own ceiling; the date filter is what keeps this small,
       * which is why the page opens on today.
       */
      page: 1,
      limit: 1000,
    }),
    [searchQuery, statusFilter, depotFilter, dateRange]
  )

  const { data, isLoading, isError, error, refetch } = useCommissions(queryParams)
  const { data: summary } = useCommissionSummary({
    depotId: depotFilter !== 'all' ? depotFilter : undefined,
    dateFrom: dateRange.dateFrom || undefined,
    dateTo: dateRange.dateTo || undefined,
  })

  const allRows = data?.commissions || []

  /** Every PFI present in what came back, for the filter's own list. */
  const pfiOptions = useMemo(
    () => [...new Set(allRows.map((c) => c.pfiNumber).filter(Boolean) as string[])]
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' })),
    [allRows],
  )

  /**
   * PFI filtering and sorting happen here rather than on the server.
   *
   * The page already holds the whole filtered set — that is the point of
   * dropping pagination — so narrowing it further is instant and costs no
   * round trip. The server keeps what it is good at: the date window, the
   * depot, the status and the search.
   */
  const commissions = useMemo(() => {
    const rows = pfiFilter === 'all'
      ? [...allRows]
      : allRows.filter((c) => c.pfiNumber === pfiFilter)

    const byDate = (a: Commission, b: Commission) =>
      new Date(b.orderCreatedAt || b.createdAt || 0).getTime()
      - new Date(a.orderCreatedAt || a.createdAt || 0).getTime()

    switch (sortKey) {
      case 'date_asc': return rows.sort((a, b) => -byDate(a, b))
      // Numeric as well as alphabetic, or PFI-9C outranks PFI-40B on the
      // strength of its first digit. Unbatched rows sort last rather than
      // first, where an empty string would otherwise put them.
      case 'pfi': return rows.sort((a, b) =>
        (a.pfiNumber || '\uffff').localeCompare(b.pfiNumber || '\uffff', undefined, { numeric: true, sensitivity: 'base' })
        || byDate(a, b))
      case 'facilitator': return rows.sort((a, b) =>
        (a.customerName || '').localeCompare(b.customerName || '') || byDate(a, b))
      case 'amount': return rows.sort((a, b) => Number(b.commissionAmount) - Number(a.commissionAmount))
      default: return rows.sort(byDate)
    }
  }, [allRows, pfiFilter, sortKey])

  const hasFilters = !!(
    searchQuery || statusFilter !== 'pending' || depotFilter !== 'all'
    || pfiFilter !== 'all' || sortKey !== 'date' || datePreset !== 'today'
  )

  const clearFilters = useCallback(() => {
    setSearchQuery('')
    setStatusFilter('pending')
    setDepotFilter('all')
    setPfiFilter('all')
    setSortKey('date')
    // Back to how the page opens, not to All Time — clearing should leave it
    // where it starts.
    setDatePreset('today')
    setCustomDateFrom('')
    setCustomDateTo('')
    setSelectedIds([])
  }, [])

  // What a bulk action can actually touch on this page.
  const openRows = useMemo(() => commissions.filter((c) => c.status === 'pending'), [commissions])
  const selectedRows = useMemo(
    () => commissions.filter((c) => selectedIds.includes(c.id)),
    [commissions, selectedIds],
  )
  const allOpenSelected = openRows.length > 0 && openRows.every((c) => selectedIds.includes(c.id))
  const someOpenSelected = openRows.some((c) => selectedIds.includes(c.id))
  const selectedTotal = selectedRows.reduce((sum, c) => sum + Number(c.commissionAmount || 0), 0)

  const toggleOne = useCallback((id: number) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }, [])

  /**
   * Select-all covers this page's open rows and nothing else.
   *
   * Not every open row in the filter: the desk can see what it is ticking, and
   * a control that silently selected four hundred rows across pages it has not
   * looked at is how a bulk confirm credits somebody by accident.
   */
  const toggleAll = useCallback(() => {
    setSelectedIds((prev) => {
      const ids = openRows.map((c) => c.id)
      const every = ids.length > 0 && ids.every((id) => prev.includes(id))
      return every ? prev.filter((id) => !ids.includes(id)) : [...new Set([...prev, ...ids])]
    })
  }, [openRows])

  const summaryCards: SummaryCard[] = useMemo(
    () => [
      {
        title: 'Eligible Orders',
        value: String(summary?.totalOrders || 0),
        description: 'Orders with commission',
        icon: <Package className="size-5" />,
        tone: 'blue',
      },
      {
        title: 'Total Quantity Loaded',
        value: `${(summary?.totalQuantity || 0).toLocaleString()} L`,
        description: 'Litres across all orders',
        icon: <Fuel className="size-5" />,
        tone: 'neutral',
      },
      {
        title: 'Total Commission',
        value: formatNaira(summary?.pendingAmount || 0),
        description: 'To be credited to facilitators',
        icon: <Banknote className="size-5" />,
        tone: 'amber',
      },
    ],
    [summary]
  )

  const handleConfirmCommission = useCallback(async () => {
    if (!confirmTarget) return
    await confirmMutation.mutateAsync(confirmTarget.id)
    setConfirmTarget(null)
  }, [confirmTarget, confirmMutation])

  // ── Excel Export ───────────────────────────────────────────────────────────

  const handleExportExcel = useCallback(async () => {
    const ExcelJS = (await import('exceljs')).default
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Commissions')

    // Header
    sheet.mergeCells('A1:K1')
    const titleCell = sheet.getCell('A1')
    titleCell.value = 'Soroman — Commission Report'
    titleCell.font = { size: 16, bold: true }
    titleCell.alignment = { horizontal: 'center' }

    sheet.mergeCells('A2:K2')
    const subCell = sheet.getCell('A2')
    subCell.value = `Generated: ${new Date().toLocaleString()}`
    subCell.font = { size: 10, color: { argb: '666666' } }
    subCell.alignment = { horizontal: 'center' }

    // Filters row
    sheet.getCell('A4').value = 'Filters:'
    sheet.getCell('A4').font = { bold: true }
    sheet.getCell('B4').value = [
      depotFilter !== 'all' ? `Depot: ${depots.find((d: any) => d.id === depotFilter)?.name || depotFilter}` : '',
      dateRange.dateFrom ? `From: ${dateRange.dateFrom}` : '',
      dateRange.dateTo ? `To: ${dateRange.dateTo}` : '',
    ].filter(Boolean).join(' | ') || 'All Time'

    // Summary
    sheet.getCell('A6').value = 'Summary'
    sheet.getCell('A6').font = { bold: true, size: 12 }
    sheet.getCell('A7').value = 'Total Orders'
    sheet.getCell('B7').value = summary?.totalOrders || 0
    sheet.getCell('A8').value = 'Total Quantity (L)'
    sheet.getCell('B8').value = summary?.totalQuantity || 0
    sheet.getCell('A9').value = 'Total Commission'
    sheet.getCell('B9').value = formatNaira(summary?.pendingAmount || 0)

    // Table headers
    const headers = ['#', 'Reference', 'Date', 'Facilitator', 'Phone', 'Location', 'Quantity (L)', 'Rate (₦/L)', 'Commission (₦)']
    const headerRow = sheet.addRow(headers)
    headerRow.font = { bold: true }
    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'E2E8F0' } }
      cell.border = { bottom: { style: 'thin' } }
    })

    // Data rows
    commissions.forEach((c, i) => {
      sheet.addRow([
        i + 1,
        c.orderNumber,
        c.orderCreatedAt ? new Date(c.orderCreatedAt).toLocaleDateString() : '',
        `${c.customerName}${c.customerCompanyName ? ` (${c.customerCompanyName})` : ''}`,
        c.customerPhone || '',
        c.depotName,
        c.quantity,
        c.commissionRate,
        c.commissionAmount,
      ])
    })

    // Totals
    const totalRow = sheet.addRow([
      '', '', '', '', '', 'TOTAL',
      commissions.reduce((s, c) => s + c.quantity, 0),
      '',
      commissions.reduce((s, c) => s + c.commissionAmount, 0),
    ])
    totalRow.font = { bold: true }

    // Auto-width columns
    sheet.columns.forEach((col) => {
      let maxLen = 10
      col.eachCell?.((cell) => {
        const len = String(cell.value || '').length
        if (len > maxLen) maxLen = len
      })
      col.width = Math.min(maxLen + 2, 40)
    })

    const buffer = await workbook.xlsx.writeBuffer()
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `commission-report-${new Date().toISOString().split('T')[0]}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  }, [commissions, summary, depotFilter, dateRange, depots])

  // ── PDF Export ─────────────────────────────────────────────────────────────

  const handleExportPDF = useCallback(async () => {
    const { default: jsPDF } = await import('jspdf')
    const autoTable = (await import('jspdf-autotable')).default

    const doc = new jsPDF('landscape')
    const pageWidth = doc.internal.pageSize.getWidth()

    doc.setFontSize(16)
    doc.setFont('helvetica', 'bold')
    doc.text('Soroman — Commission Report', pageWidth / 2, 15, { align: 'center' })

    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.text(`Generated: ${new Date().toLocaleString()}`, pageWidth / 2, 22, { align: 'center' })

    // Summary
    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.text('Summary', 14, 32)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.text(`Total Orders: ${summary?.totalOrders || 0}`, 14, 39)
    doc.text(`Total Quantity: ${(summary?.totalQuantity || 0).toLocaleString()} L`, 14, 45)
    doc.text(`Total Commission: ${formatNaira(summary?.pendingAmount || 0)}`, 100, 39)

    // Table
    autoTable(doc, {
      startY: 52,
      head: [['#', 'Reference', 'Date', 'Facilitator', 'Phone', 'Location', 'Qty (L)', 'Rate', 'Commission']],
      body: commissions.map((c, i) => [
        i + 1,
        c.orderNumber,
        c.orderCreatedAt ? new Date(c.orderCreatedAt).toLocaleDateString() : '',
        c.customerName,
        c.customerPhone || '',
        c.depotName,
        c.quantity.toLocaleString(),
        `₦${c.commissionRate}`,
        formatNaira(c.commissionAmount),
      ]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [34, 197, 94] },
    })

    doc.save(`commission-report-${new Date().toISOString().split('T')[0]}.pdf`)
  }, [commissions, summary])

  return (
    <div className="space-y-6">
      {/* The report and refresh controls live in the header, where every
          other page in the app puts them. They are things you do TO the page,
          not filters on it, and mixing them into the filter bar made the row
          of filters read as a toolbar. */}
      <PageHeader
        eyebrow="Finance"
        title="Customer commissions"
        description="Commission earned per facilitator, by depot and PFI."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowDailyReport(true)}>
              <FileText className="size-4" />
              Daily report
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={handleExportExcel}>
              <Download className="size-4" />
              Excel
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={handleExportPDF}>
              <Download className="size-4" />
              PDF
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => refetch()}>
              <RefreshCw className={cn('size-4', isLoading && 'animate-spin')} />
              Refresh
            </Button>
          </div>
        }
      />

      {/* Summary Cards */}
      <SummaryCards cards={summaryCards} />

      <FilterBar>
        {/* One row that wraps, rather than two stacked ones. Search takes the
            room it needs and the rest sit together on the right, so the bar
            reads as a single sentence about what is on screen. */}
        <div className="relative min-w-[14rem] flex-1 max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search reference, facilitator, PFI…"
            className="pl-9 pr-9"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        {/* Date. The presets are the common answers and Custom opens the two
            inputs beside them, so a range never costs a dialog. */}
        <div className="flex flex-wrap items-center gap-1">
          {QUICK_DATES.map((d) => (
            <Button
              key={d.value}
              variant={datePreset === d.value ? 'default' : 'outline'}
              size="sm"
              className="h-8 text-xs"
              onClick={() => setDatePreset(d.value)}
            >
              {d.label}
            </Button>
          ))}
          <Button
            variant={datePreset === 'custom' ? 'default' : 'outline'}
            size="sm"
            className="h-8 text-xs"
            onClick={() => setDatePreset('custom')}
          >
            Custom
          </Button>
        </div>

        {datePreset === 'custom' && (
          <div className="flex items-center gap-2">
            <Input
              type="date"
              className="h-8 w-36 text-xs"
              value={customDateFrom}
              onChange={(e) => setCustomDateFrom(e.target.value)}
            />
            <span className="text-xs text-muted-foreground">to</span>
            <Input
              type="date"
              className="h-8 w-36 text-xs"
              value={customDateTo}
              onChange={(e) => setCustomDateTo(e.target.value)}
            />
          </div>
        )}

        {/*
          The device's own dropdowns from here on.

          A native select opens the picker the phone or the laptop already
          uses — a wheel on iOS, a real listbox on desktop — which is faster to
          hit, searchable by typing, and does not need this page to reimplement
          keyboard handling. On a bar worked through dozens of times a day that
          difference is the whole feel of it.
        */}
        <NativeSelect
          className="h-8 w-36 text-xs"
          aria-label="Filter by status"
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value as typeof statusFilter); setSelectedIds([]) }}
        >
          <option value="pending">Pending</option>
          <option value="paid">Paid</option>
          <option value="skipped">Skipped</option>
          <option value="all">All statuses</option>
        </NativeSelect>

        <NativeSelect
          className="h-8 w-40 text-xs"
          aria-label="Filter by depot"
          value={depotFilter}
          onChange={(e) => setDepotFilter(e.target.value)}
        >
          <option value="all">All depots</option>
          {(depots as any[]).map((d) => (
            <option key={d.id} value={String(d.id)}>{d.name}</option>
          ))}
        </NativeSelect>

        <NativeSelect
          className="h-8 w-40 text-xs"
          aria-label="Filter by PFI"
          value={pfiFilter}
          onChange={(e) => { setPfiFilter(e.target.value); setSelectedIds([]) }}
        >
          <option value="all">All PFIs</option>
          {pfiOptions.map((pfi) => (
            <option key={pfi} value={pfi}>{pfi}</option>
          ))}
        </NativeSelect>

        <NativeSelect
          className="h-8 w-44 text-xs"
          aria-label="Sort"
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
        >
          <option value="date">Sort: newest first</option>
          <option value="date_asc">Sort: oldest first</option>
          <option value="pfi">Sort: PFI</option>
          <option value="facilitator">Sort: facilitator</option>
          <option value="amount">Sort: commission, highest</option>
        </NativeSelect>

        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X className="size-3.5" />
            Clear
          </Button>
        )}
      </FilterBar>

      <Card>
        

        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8">
              <PageLoader message="Loading commissions…" />
            </div>
          ) : isError ? (
            <div className="p-8">
              <PageError message={(error as any)?.message || 'Failed to load commissions'} onRetry={() => refetch()} />
            </div>
          ) : commissions.length === 0 ? (
            <div className="p-8">
              <PageEmpty
                icon={<DollarSign className="size-8 text-muted-foreground" />}
                title="No commissions found"
                description="Commissions are created automatically when orders are paid. Adjust your filters or set up commission rates first."
                hasFilters={hasFilters}
                onClearFilters={clearFilters}
              />
            </div>
          ) : (
            <>
              {/* The bulk bar, and only while something is selected.
                  A permanent toolbar of disabled buttons is noise on every
                  page view; this appears the moment it has something to act
                  on and says exactly what it would act on. */}
              {selectedIds.length > 0 && (
                <div className="flex flex-wrap items-center gap-3 border-b border-border bg-accent/5 px-4 py-3">
                  <span className="text-sm font-semibold">
                    {selectedIds.length} selected
                    <span className="ml-2 font-mono font-normal text-muted-foreground">
                      {formatNaira(selectedTotal)}
                    </span>
                  </span>
                  <div className="ml-auto flex items-center gap-2">
                    <Button
                      size="sm"
                      className="gap-1.5 bg-accent text-accent-foreground hover:bg-accent/90"
                      disabled={bulkMutation.isPending}
                      onClick={() => setBulkAction('confirm')}
                    >
                      <CheckCircle className="size-3.5" />
                      Confirm as paid
                    </Button>
                    <Button
                      size="sm"
                      className="gap-1.5 bg-destructive text-white hover:bg-destructive/90"
                      disabled={bulkMutation.isPending}
                      onClick={() => { setBulkAction('skip'); setBulkReason('') }}
                    >
                      <MinusCircle className="size-3.5" />
                      Skip
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setSelectedIds([])}>
                      <X className="size-3.5" />
                      Clear
                    </Button>
                  </div>
                </div>
              )}

              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50 text-xs uppercase font-semibold text-muted-foreground">
                      {/* Selection first, and only over what can still be
                          acted on — a page of already-settled rows offers
                          nothing to tick, which is itself the answer. */}
                      <TableHead className="w-10">
                        <input
                          type="checkbox"
                          aria-label="Select every open commission on this page"
                          className="size-4 cursor-pointer accent-accent align-middle"
                          checked={allOpenSelected}
                          ref={(el) => { if (el) el.indeterminate = someOpenSelected && !allOpenSelected }}
                          disabled={openRows.length === 0}
                          onChange={toggleAll}
                        />
                      </TableHead>
                      {/* Date first, then what it is — the order a row is
                          actually scanned in when you are working a day. */}
                      <TableHead>Date</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead>PFI</TableHead>
                      <TableHead>Facilitator</TableHead>
                      <TableHead>Company</TableHead>
                      <TableHead>Contact</TableHead>
                      <TableHead>Depot</TableHead>
                      <TableHead className="text-right">Quantity</TableHead>
                      <TableHead className="text-right">Commission</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {commissions.map((c) => {
                      const open = c.status === 'pending'
                      const selected = selectedIds.includes(c.id)
                      return (
                        <TableRow
                          key={c.id}
                          className={cn(
                            'transition-colors duration-250 ease-luxe',
                            selected ? 'bg-accent/5 hover:bg-accent/10' : 'hover:bg-muted/40',
                            // A settled row is still worth reading — it is the
                            // record of what was decided — but it should not
                            // compete with the ones still needing a decision.
                            !open && 'opacity-70',
                          )}
                        >
                          <TableCell>
                            <input
                              type="checkbox"
                              aria-label={`Select ${c.orderNumber}`}
                              className="size-4 cursor-pointer accent-accent align-middle disabled:cursor-not-allowed disabled:opacity-40"
                              checked={selected}
                              disabled={!open}
                              onChange={() => toggleOne(c.id)}
                            />
                          </TableCell>

                          <TableCell className="text-sm whitespace-nowrap text-muted-foreground">
                            {c.orderCreatedAt
                              ? new Date(c.orderCreatedAt).toLocaleDateString('en-GB', {
                                  day: '2-digit', month: 'short', year: 'numeric',
                                })
                              : '—'}
                          </TableCell>

                          <TableCell className="font-mono text-sm font-semibold whitespace-nowrap text-primary">
                            {c.orderNumber}
                          </TableCell>

                          <TableCell className="text-sm whitespace-nowrap">
                            {c.pfiNumber
                              ? <span className="font-medium">{c.pfiNumber}</span>
                              : <span className="text-muted-foreground/50">—</span>}
                          </TableCell>

                          <TableCell className="max-w-[12rem]">
                            <span className="block truncate text-sm font-semibold text-foreground">
                              {c.customerName}
                            </span>
                          </TableCell>

                          {/* The company on the ORDER, not the one on the
                              customer's profile. A facilitator buys for
                              different companies and the order says which; the
                              profile only says who they usually are. */}
                          <TableCell className="max-w-[12rem]">
                            <span className="block truncate text-sm text-muted-foreground">
                              {c.orderCompanyName || c.customerCompanyName || '—'}
                            </span>
                          </TableCell>

                          <TableCell className="text-sm whitespace-nowrap text-muted-foreground">
                            {c.customerPhone ? <PhoneLink value={c.customerPhone} /> : '—'}
                          </TableCell>

                          {/* The depot, and only the depot. The city under it
                              said "Calabar Municipal" beneath "Calabar", which
                              is a second line of width for no second fact. */}
                          <TableCell className="text-sm whitespace-nowrap text-muted-foreground">
                            {c.depotName || '—'}
                          </TableCell>

                          <TableCell className="text-right font-mono text-sm whitespace-nowrap">
                            {c.quantity.toLocaleString()} Litres
                          </TableCell>

                          {/* The amount alone. The rate under it was the one
                              number on the row nobody decides anything from —
                              it lives on the Commission Rates page, where it
                              is set. */}
                          <TableCell className="text-right font-mono text-sm font-semibold whitespace-nowrap text-foreground">
                            {formatNaira(c.commissionAmount)}
                          </TableCell>

                          {/* Status carries its own explanation where it has
                              one. A skipped row that cannot say why is a dead
                              end somebody will have to go and ask about. */}
                          <TableCell>
                            {c.status === 'paid' ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-xs font-semibold text-accent">
                                <CheckCircle className="size-3" /> Paid
                              </span>
                            ) : c.status === 'skipped' ? (
                              <span
                                className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground"
                                title={c.skipReason || 'Skipped'}
                              >
                                <MinusCircle className="size-3" /> Skipped
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-xs font-semibold text-warning">
                                <Clock className="size-3" /> Pending
                              </span>
                            )}
                            {c.status === 'skipped' && c.skipReason && (
                              <div className="mt-0.5 max-w-[12rem] truncate text-xs text-muted-foreground/80">
                                {c.skipReason}
                              </div>
                            )}
                          </TableCell>

                          <TableCell className="text-right">
                            {/* Filled, not ghost. These are the two decisions
                                the page exists to take, and a bare word in a
                                cell does not read as a button until you hover
                                it. Green confirms, red skips — the colours the
                                rest of the app already uses for "this goes
                                through" and "this does not". */}
                            {open ? (
                              <div className="flex items-center justify-end gap-1.5">
                                <Button
                                  size="sm"
                                  className="h-8 gap-1 bg-accent px-2.5 text-xs text-accent-foreground hover:bg-accent/90"
                                  onClick={() => setConfirmTarget(c)}
                                >
                                  <CheckCircle className="size-3.5" />
                                  Paid
                                </Button>
                                <Button
                                  size="sm"
                                  className="h-8 gap-1 bg-destructive px-2.5 text-xs text-white hover:bg-destructive/90"
                                  onClick={() => { setSkipTarget(c); setSkipReason('') }}
                                >
                                  <MinusCircle className="size-3.5" />
                                  Skip
                                </Button>
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground/60">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Footed rather than paged.
                  The whole filtered set is on screen — that is what lets a
                  bulk selection mean "everything matching", not "everything
                  that happened to be on this page". */}
              <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm text-muted-foreground">
                <span>
                  {commissions.length.toLocaleString()} commission{commissions.length === 1 ? '' : 's'}
                  {pfiFilter !== 'all' && <> on {pfiFilter}</>}
                </span>
                <span className="font-mono font-semibold text-foreground">
                  {formatNaira(commissions.reduce((sum, c) => sum + Number(c.commissionAmount || 0), 0))}
                </span>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Confirm Commission Dialog */}
      <ConfirmDialog
        open={!!confirmTarget}
        onOpenChange={(open) => { if (!open) setConfirmTarget(null) }}
        title="Confirm Commission"
        description={
          confirmTarget
            ? `You're about to confirm this commission. The amount will be credited to the customer's account balance.\n\n` +
              `Customer: ${confirmTarget.customerName}\n` +
              `Quantity: ${confirmTarget.quantity.toLocaleString()} L\n` +
              `Rate: ₦${confirmTarget.commissionRate}/L\n` +
              `Amount: ${formatNaira(confirmTarget.commissionAmount)} will be credited`
            : ''
        }
        confirmLabel="Confirm & Credit"
        onConfirm={handleConfirmCommission}
        loading={confirmMutation.isPending}
      />

      {/* Skipping one. Nobody is credited, so the dialog leads with that
          rather than with the amount — the amount is the thing NOT happening. */}
      <ConfirmDialog
        open={!!skipTarget}
        onOpenChange={(open) => { if (!open) { setSkipTarget(null); setSkipReason('') } }}
        title={skipTarget ? `Skip commission on ${skipTarget.orderNumber}?` : ''}
        description={
          skipTarget
            ? `No commission will be paid on this order and nobody is credited. ${formatNaira(skipTarget.commissionAmount)} stays where it is. The row moves out of Pending and can be found under Skipped.`
            : ''
        }
        confirmLabel="Skip this order"
        loading={skipMutation.isPending}
        onConfirm={async () => {
          if (!skipTarget || skipReason.trim().length < 3) return
          await skipMutation.mutateAsync({ commissionId: skipTarget.id, reason: skipReason.trim() })
          setSelectedIds((prev) => prev.filter((id) => id !== skipTarget.id))
          setSkipTarget(null)
          setSkipReason('')
        }}
      >
        <div className="space-y-1.5">
          <Label className="text-xs">Why (required)</Label>
          <Input
            autoFocus
            value={skipReason}
            onChange={(e) => setSkipReason(e.target.value)}
            placeholder="e.g. flat-rate deal, no commission agreed"
          />
          {skipReason.trim().length > 0 && skipReason.trim().length < 3 && (
            <p className="text-xs text-destructive">Give a reason somebody can read later.</p>
          )}
        </div>
      </ConfirmDialog>

      {/* Skipping or confirming a selection. One dialog, because from the
          desk's point of view they are the same act over the same rows — and
          only the skip needs a reason. */}
      <ConfirmDialog
        open={bulkAction !== null}
        onOpenChange={(open) => { if (!open) { setBulkAction(null); setBulkReason('') } }}
        title={
          bulkAction === 'skip'
            ? `Skip ${selectedIds.length} commission${selectedIds.length === 1 ? '' : 's'}?`
            : `Confirm ${selectedIds.length} commission${selectedIds.length === 1 ? '' : 's'} as paid?`
        }
        description={
          bulkAction === 'skip'
            ? `No commission is paid on ${selectedIds.length === 1 ? 'this order' : 'these orders'} and nobody is credited. ${formatNaira(selectedTotal)} stays where it is.`
            : `${formatNaira(selectedTotal)} will be credited across ${selectedIds.length} customer account${selectedIds.length === 1 ? '' : 's'}. Each is credited on its own, so if one fails the rest still go through and you will be told which did not.`
        }
        confirmLabel={bulkAction === 'skip' ? 'Skip them' : 'Confirm & credit'}
        loading={bulkMutation.isPending}
        onConfirm={async () => {
          if (!bulkAction) return
          if (bulkAction === 'skip' && bulkReason.trim().length < 3) return
          const res = await bulkMutation.mutateAsync({
            ids: selectedIds,
            action: bulkAction,
            reason: bulkAction === 'skip' ? bulkReason.trim() : undefined,
          })
          // Anything that failed stays selected, so a retry acts on exactly
          // what did not go rather than on the whole batch again.
          const failed = new Set((res.data?.failed || []).map((f) => f.id))
          setSelectedIds((prev) => prev.filter((id) => failed.has(id)))
          setBulkAction(null)
          setBulkReason('')
        }}
      >
        {bulkAction === 'skip' && (
          <div className="space-y-1.5">
            <Label className="text-xs">Why (required)</Label>
            <Input
              autoFocus
              value={bulkReason}
              onChange={(e) => setBulkReason(e.target.value)}
              placeholder="e.g. flat-rate deal, no commission agreed"
            />
            <p className="text-xs text-muted-foreground">
              The same reason is recorded on all {selectedIds.length}.
            </p>
          </div>
        )}
      </ConfirmDialog>

      {/* Daily Report Dialog */}
      <DailyReportDialog
        open={showDailyReport}
        onOpenChange={setShowDailyReport}
        depots={depots as any[]}
      />
    </div>
  )
}

// ─── Daily Report Dialog ─────────────────────────────────────────────────────

function DailyReportDialog({
  open,
  onOpenChange,
  depots,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  depots: any[]
}) {
  const [form, setForm] = useState({
    location: '',
    pfi: '',
    date: new Date().toISOString().split('T')[0],
    litresSold: '',
    truckCount: '',
    customerCount: '',
    orderCount: '',
    totalCommissionPaid: '',
    staffName: '',
    remarks: '',
  })
  const [generating, setGenerating] = useState(false)

  const updateField = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const handleSubmit = async () => {
    setGenerating(true)
    try {
      const { default: jsPDF } = await import('jspdf')
      const doc = new jsPDF()
      const pageWidth = doc.internal.pageSize.getWidth()

      // Header
      doc.setFontSize(18)
      doc.setFont('helvetica', 'bold')
      doc.text('Soroman', pageWidth / 2, 20, { align: 'center' })
      doc.setFontSize(12)
      doc.setFont('helvetica', 'normal')
      doc.text('Daily Commission Report', pageWidth / 2, 28, { align: 'center' })
      doc.setDrawColor(200)
      doc.line(14, 32, pageWidth - 14, 32)

      // Fields
      let y = 42
      const fields = [
        ['Location', form.location || 'N/A'],
        ['PFI', form.pfi || 'N/A'],
        ['Date', form.date],
        ['Litres Sold', `${Number(form.litresSold || 0).toLocaleString()} L`],
        ['Number of Trucks', form.truckCount || '0'],
        ['Number of Customers', form.customerCount || '0'],
        ['Number of Orders', form.orderCount || '0'],
        ['Total Commission Paid', formatNaira(Number(form.totalCommissionPaid || 0))],
        ['Staff Name', form.staffName || 'N/A'],
      ]

      for (const [label, value] of fields) {
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(10)
        doc.text(`${label}:`, 14, y)
        doc.setFont('helvetica', 'normal')
        doc.text(String(value), 70, y)
        y += 8
      }

      // Remarks
      y += 4
      doc.setFont('helvetica', 'bold')
      doc.text('Remarks:', 14, y)
      y += 8
      doc.setFont('helvetica', 'normal')
      const remarkLines = doc.splitTextToSize(form.remarks || 'No remarks', pageWidth - 28)
      doc.text(remarkLines, 14, y)
      y += remarkLines.length * 5 + 20

      // Signature lines
      doc.setDrawColor(150)
      doc.line(14, y, 80, y)
      doc.line(pageWidth - 80, y, pageWidth - 14, y)
      y += 6
      doc.setFontSize(9)
      doc.text('Prepared By', 14, y)
      doc.text('Approved By', pageWidth - 80, y)

      // Footer
      doc.setFontSize(8)
      doc.setTextColor(150)
      doc.text(
        `Generated on ${new Date().toLocaleString()}`,
        pageWidth / 2,
        doc.internal.pageSize.getHeight() - 10,
        { align: 'center' }
      )

      doc.save(`daily-commission-report-${form.date}.pdf`)
      onOpenChange(false)
    } catch (err) {
      console.error('Failed to generate PDF:', err)
    } finally {
      setGenerating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <FileText className="size-5 text-primary" />
            Daily Commission Report
          </DialogTitle>
          <DialogDescription>
            Fill in today's commission summary to generate a PDF report.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-3 max-h-[60svh] overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-xs">Location</Label>
              <Select value={form.location} onValueChange={(v) => updateField('location', v)}>
                <SelectTrigger className="h-9 mt-1">
                  <SelectValue placeholder="Select depot" />
                </SelectTrigger>
                <SelectContent>
                  {depots.map((d) => (
                    <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">PFI</Label>
              <Input
                className="h-9 mt-1"
                placeholder="PFI number"
                value={form.pfi}
                onChange={(e) => updateField('pfi', e.target.value)}
              />
            </div>
          </div>

          <div>
            <Label className="text-xs">Date</Label>
            <Input
              type="date"
              className="h-9 mt-1"
              value={form.date}
              onChange={(e) => updateField('date', e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-xs">Litres Sold</Label>
              <CommaInput
                className="h-9 mt-1"
                placeholder="0"
                value={form.litresSold}
                onValueChange={(v) => updateField('litresSold', v)}
              />
            </div>
            <div>
              <Label className="text-xs">Number of Trucks</Label>
              <CommaInput
                className="h-9 mt-1"
                placeholder="0"
                value={form.truckCount}
                onValueChange={(v) => updateField('truckCount', v)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-xs">Number of Customers</Label>
              <CommaInput
                className="h-9 mt-1"
                placeholder="0"
                value={form.customerCount}
                onValueChange={(v) => updateField('customerCount', v)}
              />
            </div>
            <div>
              <Label className="text-xs">Number of Orders</Label>
              <CommaInput
                className="h-9 mt-1"
                placeholder="0"
                value={form.orderCount}
                onValueChange={(v) => updateField('orderCount', v)}
              />
            </div>
          </div>

          <div>
            <Label className="text-xs">Total Commission Paid (₦)</Label>
            <CommaInput
              className="h-9 mt-1"
              placeholder="0.00"
              value={form.totalCommissionPaid}
              onValueChange={(v) => updateField('totalCommissionPaid', v)}
            />
          </div>

          <div>
            <Label className="text-xs">Staff Name</Label>
            <Input
              className="h-9 mt-1"
              placeholder="Your name"
              value={form.staffName}
              onChange={(e) => updateField('staffName', e.target.value)}
            />
          </div>

          <div>
            <Label className="text-xs">Remarks</Label>
            <textarea
              className="w-full mt-1 p-2 border border-input rounded-lg text-base md:text-sm bg-background min-h-[80px] resize-y"
              placeholder="Any notes or remarks…"
              value={form.remarks}
              onChange={(e) => updateField('remarks', e.target.value)}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0 pt-2 border-t border-border">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={generating}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={generating} className="gap-2">
            {generating ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />}
            {generating ? 'Generating…' : 'Generate PDF'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Rate Management Tab ─────────────────────────────────────────────────────
