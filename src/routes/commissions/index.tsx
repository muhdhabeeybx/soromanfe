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
      <PageHeader
        eyebrow="Finance"
        title="Customer commissions"
        description="Commission earned per facilitator, by depot and product."
      />

      <CommissionsTab />
    </div>
  )
}

// ─── Commissions Tab ─────────────────────────────────────────────────────────

function CommissionsTab() {
  const [searchQuery, setSearchQuery] = useState('')
  const [depotFilter, setDepotFilter] = useState('all')
  const [datePreset, setDatePreset] = useState('all')
  const [customDateFrom, setCustomDateFrom] = useState('')
  const [customDateTo, setCustomDateTo] = useState('')
  const [page, setPage] = useState(1)

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
      page,
      limit: 50,
    }),
    [searchQuery, statusFilter, depotFilter, dateRange, page]
  )

  const { data, isLoading, isError, error, refetch } = useCommissions(queryParams)
  const { data: summary } = useCommissionSummary({
    depotId: depotFilter !== 'all' ? depotFilter : undefined,
    dateFrom: dateRange.dateFrom || undefined,
    dateTo: dateRange.dateTo || undefined,
  })

  const commissions = data?.commissions || []
  const pagination = data?.pagination

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
      {/* Summary Cards */}
      <SummaryCards cards={summaryCards} />

      {/* Filters */}
      <FilterBar>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-2 flex-wrap">
        <Button variant="outline" size="sm" onClick={() => setShowDailyReport(true)} className="gap-2">
        <FileText className="size-4" />
        Daily Report
        </Button>
        <Button variant="outline" size="sm" onClick={handleExportExcel} className="gap-2">
        <Download className="size-4" />
        Excel
        </Button>
        <Button variant="outline" size="sm" onClick={handleExportPDF} className="gap-2">
        <Download className="size-4" />
        PDF
        </Button>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
        <RefreshCw className="size-4" />
        Refresh
        </Button>
        </div>
        </div>
        {/* Search + Filter Row */}
        <div className="flex flex-col lg:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
        placeholder="Search ref, customer, truck, PFI…"
        className="pl-9 pr-9"
        value={searchQuery}
        onChange={(e) => { setSearchQuery(e.target.value); setPage(1) }}
        />
        {searchQuery && (
        <button
        onClick={() => { setSearchQuery(''); setPage(1) }}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
        >
        <X className="size-4" />
        </button>
        )}
        </div>
        <div className="flex flex-wrap gap-2 items-center">
        {/* Date Quick Filters */}
        <div className="flex gap-1 flex-wrap">
        {QUICK_DATES.map((d) => (
        <Button
        key={d.value}
        variant={datePreset === d.value ? 'default' : 'outline'}
        size="sm"
        className="h-8 text-xs"
        onClick={() => { setDatePreset(d.value); setPage(1) }}
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
        {/* Custom Date Range */}
        {datePreset === 'custom' && (
        <div className="flex gap-2 items-center">
        <Input
        type="date"
        className="h-8 w-36 text-xs"
        value={customDateFrom}
        onChange={(e) => { setCustomDateFrom(e.target.value); setPage(1) }}
        />
        <span className="text-xs text-muted-foreground">to</span>
        <Input
        type="date"
        className="h-8 w-36 text-xs"
        value={customDateTo}
        onChange={(e) => { setCustomDateTo(e.target.value); setPage(1) }}
        />
        </div>
        )}
        {/* Pending first: this is a work queue, and what is still outstanding
            is the question it exists to answer. The settled states are one
            select away rather than unreachable, which is what they were. */}
        <Select
          value={statusFilter}
          onValueChange={(v) => { setStatusFilter(v as typeof statusFilter); setSelectedIds([]); setPage(1) }}
        >
        <SelectTrigger className="h-8 w-36 text-xs">
        <SelectValue />
        </SelectTrigger>
        <SelectContent>
        <SelectItem value="pending">Pending</SelectItem>
        <SelectItem value="paid">Paid</SelectItem>
        <SelectItem value="skipped">Skipped</SelectItem>
        <SelectItem value="all">All statuses</SelectItem>
        </SelectContent>
        </Select>
        {/* Depot Filter */}
        <Select value={depotFilter} onValueChange={(v) => { setDepotFilter(v); setPage(1) }}>
        <SelectTrigger className="h-8 w-40 text-xs">
        <SelectValue placeholder="All Depots" />
        </SelectTrigger>
        <SelectContent>
        <SelectItem value="all">All Depots</SelectItem>
        {(depots as any[]).map((d) => (
        <SelectItem key={d.id} value={String(d.id)}>
        {d.name}
        </SelectItem>
        ))}
        </SelectContent>
        </Select>
        </div>
        </div>
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
                hasFilters={!!searchQuery || depotFilter !== 'all' || datePreset !== 'all'}
                onClearFilters={() => {
                  setSearchQuery('')
                  setDepotFilter('all')
                  setDatePreset('all')
                  setCustomDateFrom('')
                  setCustomDateTo('')
                  setPage(1)
                }}
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
                      size="sm" variant="outline"
                      className="gap-1.5 border-accent/40 text-accent hover:bg-accent/10 hover:text-accent"
                      disabled={bulkMutation.isPending}
                      onClick={() => setBulkAction('confirm')}
                    >
                      <CheckCircle className="size-3.5" />
                      Confirm as paid
                    </Button>
                    <Button
                      size="sm" variant="outline"
                      className="gap-1.5"
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
                      <TableHead>Order</TableHead>
                      <TableHead>Facilitator</TableHead>
                      <TableHead>Location</TableHead>
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

                          {/* Order and date in one cell. They are read
                              together — "which order, and when" — and cost two
                              columns of width to say separately. */}
                          <TableCell className="whitespace-nowrap">
                            <div className="font-mono text-sm font-semibold text-primary">{c.orderNumber}</div>
                            <div className="text-xs text-muted-foreground">
                              {c.orderCreatedAt ? new Date(c.orderCreatedAt).toLocaleDateString() : '—'}
                            </div>
                          </TableCell>

                          {/* Facilitator, company and phone folded together for
                              the same reason: one person, three facts, one
                              column. The phone stays a link. */}
                          <TableCell className="max-w-[15rem]">
                            <div className="truncate text-sm font-semibold text-foreground">{c.customerName}</div>
                            {c.customerCompanyName && (
                              <div className="truncate text-xs text-muted-foreground">{c.customerCompanyName}</div>
                            )}
                            {c.customerPhone && (
                              <div className="text-xs text-muted-foreground"><PhoneLink value={c.customerPhone} /></div>
                            )}
                          </TableCell>

                          <TableCell className="text-sm text-muted-foreground">
                            <div className="whitespace-nowrap">{c.depotName}</div>
                            {c.depotCity && <div className="text-xs">{c.depotCity}</div>}
                          </TableCell>

                          <TableCell className="text-right font-mono text-sm whitespace-nowrap">
                            {c.quantity.toLocaleString()} L
                          </TableCell>

                          <TableCell className="text-right whitespace-nowrap">
                            <div className="font-mono text-sm font-semibold text-foreground">
                              {formatNaira(c.commissionAmount)}
                            </div>
                            <div className="text-xs text-muted-foreground">₦{c.commissionRate}/L</div>
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
                            {open ? (
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  variant="ghost" size="sm"
                                  className="h-8 gap-1 px-2 text-xs text-accent hover:bg-accent/10 hover:text-accent"
                                  onClick={() => setConfirmTarget(c)}
                                >
                                  <CheckCircle className="size-3.5" />
                                  Paid
                                </Button>
                                <Button
                                  variant="ghost" size="sm"
                                  className="h-8 gap-1 px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
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

              {/* Pagination */}
              {pagination && pagination.pages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                  <span className="text-sm text-muted-foreground">
                    Showing {(page - 1) * 50 + 1}–{Math.min(page * 50, pagination.total)} of {pagination.total}
                  </span>
                  <div className="flex gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= pagination.pages}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
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
