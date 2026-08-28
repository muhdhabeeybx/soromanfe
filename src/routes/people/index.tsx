import { useMemo, useRef, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { FilterBar } from '#/components/FilterBar'
import { PageHeader } from '#/components/PageHeader'
import { StatCard, StatCardGrid } from '#/components/ui/stat-card'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Card, CardContent } from '#/components/ui/card'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Textarea } from '#/components/ui/textarea'
import { NativeSelect } from '#/components/ui/native-select'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '#/components/ui/table'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '#/components/ui/dialog'
import { ConfirmDialog } from '#/components/ConfirmDialog'
import { PageError } from '#/components/PageError'
import { PageEmpty } from '#/components/PageEmpty'
import { PageLoader } from '#/components/PageLoader'
import { Pagination } from '#/components/Pagination'
import {
  Users, Search, Plus, Upload, Download, X, Phone, Building2, UserPlus, Trash2, Pencil,
  MessageSquare, CheckCircle2, Sparkles, Loader2, Tag as TagIcon, AlertTriangle, ShieldAlert,
  Wallet, Archive, Copy, PhoneOff,
} from 'lucide-react'
import {
  usePeopleList, usePhoneHygiene, useDeleteReviewed, usePreviewImport, fetchAllPeople,
  type PersonRow, type PersonKind, type PeopleListParams, type HygieneRecord,
  type ImportVerdict,
} from '#/lib/hooks/usePeople'
import {
  useCreateContact, useUpdateContact, useDeleteContact, useConvertContact,
  useImportContacts, type ContactStage, type ImportRow,
} from '#/lib/hooks/useContacts'
import { useUpdateCustomer } from '#/lib/hooks/useCustomers'
import { useContactTags } from '#/lib/hooks/useContacts'
import { useDepots, type DepotItem } from '#/lib/hooks/useDepots'
import { useToast } from '#/lib/hooks/useToast'
import { triggerDownload } from '#/lib/report-theme'
import { cn } from '#/lib/utils'
import { routeGuard } from '#/lib/route-guard'
import { parseCsv, toImportRows, type ParsedImport } from '#/lib/contact-csv'

export const Route = createFileRoute('/people/')({
  beforeLoad: () => routeGuard('/people'),
  component: PeoplePage,
})

const money = (v: number) =>
  new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', minimumFractionDigits: 0 }).format(v)

const compactMoney = (v: number) => {
  if (Math.abs(v) >= 1_000_000_000) return `₦${(v / 1_000_000_000).toFixed(1)}bn`
  if (Math.abs(v) >= 1_000_000) return `₦${(v / 1_000_000).toFixed(1)}m`
  if (Math.abs(v) >= 1_000) return `₦${(v / 1_000).toFixed(0)}k`
  return money(v)
}

const relativeDate = (iso: string | null) => {
  if (!iso) return 'Never'
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

/** RFC 4180 enough for Excel: quote everything, double any inner quote. */
const csvCell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`

const KIND_LABEL: Record<PersonKind, string> = {
  customer: 'Customer',
  lead: 'Lead',
  contact: 'Contact',
}

/**
 * How active a customer is, and how that reads.
 *
 * Colour follows meaning, not decoration: dormant is amber because it is the
 * band worth acting on — someone who used to buy and has stopped — while
 * "never ordered" stays grey, since not having bought yet is not a problem.
 */
const ACTIVITY: Record<string, { label: string; className: string }> = {
  frequent: { label: 'Frequent', className: 'bg-accent/10 text-accent border-accent/20' },
  occasional: { label: 'Occasional', className: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-900' },
  dormant: { label: 'Dormant', className: 'bg-warning/10 text-warning border-warning/20' },
  never: { label: 'Never ordered', className: 'bg-muted text-muted-foreground border-border' },
}

/** How each import verdict reads, and whether it is a problem. */
const VERDICT: Record<ImportVerdict, { label: string; tone: 'good' | 'neutral' | 'warn' }> = {
  new: { label: 'Will be added', tone: 'good' },
  existing_contact: { label: 'Already on file', tone: 'neutral' },
  existing_customer: { label: 'Already a customer', tone: 'neutral' },
  duplicate_in_file: { label: 'Repeated in this file', tone: 'neutral' },
  invalid: { label: 'Not a valid number', tone: 'warn' },
  incomplete: { label: 'Missing name or number', tone: 'warn' },
}

const EMPTY_FORM = {
  name: '', phone: '', email: '', companyName: '',
  stage: 'lead' as ContactStage, locationId: '', tags: '', notes: '',
}

function PeoplePage() {
  const navigate = useNavigate()
  const toast = useToast()

  // ── Filters ─────────────────────────────────────────────────────────────
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState<PersonKind | 'prospect' | ''>('')
  const [converted, setConverted] = useState<'yes' | 'no' | ''>('')
  const [locationId, setLocationId] = useState('')
  const [tag, setTag] = useState('')
  const [optedOut, setOptedOut] = useState<'yes' | 'no' | ''>('')
  const [activity, setActivity] = useState('')
  const [numberStatus, setNumberStatus] = useState<PeopleListParams['numberStatus']>('')
  const [sort, setSort] = useState<PeopleListParams['sort']>('active')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)

  const filters: PeopleListParams = {
    search: search || undefined, kind, converted, locationId, tag, optedOut, activity, numberStatus, sort,
  }
  const { data, isLoading, isError, error, refetch, isFetching } = usePeopleList({
    ...filters, page, limit: pageSize,
  })
  const { data: tags = [] } = useContactTags()
  const { data: depots = [] } = useDepots({ limit: 200 })

  const people = data?.people ?? []
  const summary = data?.summary
  const totalItems = data?.pagination?.total ?? 0
  const totalPages = data?.pagination?.pages ?? 1

  // Filter changes reset to page one, adjusted during render rather than in an
  // effect so the list never paints a stale page first.
  const signature = [search, kind, converted, locationId, tag, optedOut, activity, numberStatus, sort].join('|')
  const [lastSignature, setLastSignature] = useState(signature)
  if (lastSignature !== signature) { setLastSignature(signature); setPage(1) }

  const hasFilters = Boolean(search || kind || converted || locationId || tag || optedOut || activity || numberStatus)
  const clearFilters = () => {
    setSearch(''); setKind(''); setConverted(''); setLocationId('')
    setTag(''); setOptedOut(''); setActivity(''); setNumberStatus('')
  }

  // ── Mutations ───────────────────────────────────────────────────────────
  const createContact = useCreateContact()
  const updateContact = useUpdateContact()
  const deleteContact = useDeleteContact()
  const convertContact = useConvertContact()
  const importContacts = useImportContacts()
  const updateCustomer = useUpdateCustomer()

  const [editing, setEditing] = useState<PersonRow | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [deleting, setDeleting] = useState<PersonRow | null>(null)
  const [converting, setConverting] = useState<PersonRow | null>(null)
  const [archiving, setArchiving] = useState<PersonRow | null>(null)

  const openAdd = () => { setEditing(null); setForm(EMPTY_FORM); setFormOpen(true) }
  const openEdit = (p: PersonRow) => {
    setEditing(p)
    setForm({
      name: p.name, phone: p.phone, email: p.email || '', companyName: p.companyName || '',
      stage: (p.stage as ContactStage) || 'lead',
      locationId: '', tags: (p.tags || []).join(', '), notes: p.notes || '',
    })
    setFormOpen(true)
  }

  const submitForm = async () => {
    if (!form.name.trim()) { toast.error('A name is required'); return }
    if (!form.phone.trim()) { toast.error('A phone number is required'); return }
    const payload = {
      name: form.name.trim(),
      phone: form.phone.trim(),
      email: form.email.trim() || undefined,
      companyName: form.companyName.trim() || undefined,
      stage: form.stage,
      locationId: form.locationId ? Number(form.locationId) : null,
      tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
      notes: form.notes.trim() || undefined,
    }
    if (editing?.contactId) await updateContact.mutateAsync({ id: editing.contactId, data: payload })
    else await createContact.mutateAsync({ ...payload, source: 'manual' })
    setFormOpen(false)
  }

  // ── Import, with a dry run first ────────────────────────────────────────
  const [importOpen, setImportOpen] = useState(false)
  const [parsed, setParsed] = useState<ParsedImport | null>(null)
  const [fileName, setFileName] = useState('')
  const [importMode, setImportMode] = useState<'upsert' | 'new_only'>('new_only')
  const fileInput = useRef<HTMLInputElement>(null)
  const preview = usePreviewImport()

  const onFile = async (file: File) => {
    setFileName(file.name)
    preview.reset()
    try {
      const result = toImportRows(parseCsv(await file.text()))
      if (!result.rows.length) {
        toast.error('No usable rows — every line needs at least a name and a phone number')
      }
      setParsed(result)
      // The dry run runs as soon as the file is read, so the breakdown is on
      // screen before anyone reaches for the button.
      if (result.rows.length) await preview.mutateAsync(result.rows as ImportRow[])
    } catch {
      toast.error('That file could not be read as a CSV')
    }
  }

  const closeImport = (open: boolean) => {
    setImportOpen(open)
    if (!open) { setParsed(null); setFileName(''); preview.reset() }
  }

  const counts = preview.data?.counts
  // Only rows that would actually land. In new-only mode that is the new ones;
  // in upsert mode the ones already on file are corrected too.
  const willLand = counts
    ? importMode === 'new_only' ? counts.new : counts.new + counts.existing_contact
    : 0

  const runImport = async () => {
    if (!parsed?.rows.length) return
    await importContacts.mutateAsync({
      rows: parsed.rows as ImportRow[], source: 'csv', mode: importMode,
    })
    closeImport(false)
  }

  // ── The number review panel ─────────────────────────────────────────────
  const [reviewOpen, setReviewOpen] = useState(false)
  const [reviewIssue, setReviewIssue] = useState<'all' | 'invalid' | 'unreachable' | 'duplicate'>('all')
  const [selected, setSelected] = useState<Record<string, { kind: 'customer' | 'contact'; id: number }>>({})
  const { data: hygiene, isLoading: hygieneLoading } = usePhoneHygiene(
    { issue: reviewIssue }, { enabled: reviewOpen },
  )
  const deleteReviewed = useDeleteReviewed()
  const [confirmPurge, setConfirmPurge] = useState(false)

  const recordKey = (r: HygieneRecord) => `${r.kind}:${r.id}`
  const toggleRecord = (r: HygieneRecord) => {
    setSelected((prev) => {
      const key = recordKey(r)
      if (prev[key]) { const { [key]: _drop, ...rest } = prev; return rest }
      return { ...prev, [key]: { kind: r.kind, id: r.id } }
    })
  }
  const selectedList = Object.values(selected)

  const openReview = (issue: typeof reviewIssue = 'all') => {
    setReviewIssue(issue); setSelected({}); setReviewOpen(true)
  }

  // ── Export ──────────────────────────────────────────────────────────────
  const [exporting, setExporting] = useState(false)
  const exportPeople = async () => {
    setExporting(true)
    try {
      const { people: all } = await fetchAllPeople(filters)
      if (!all.length) { toast.error('Nobody matches these filters'); return }
      const header = [
        'Name', 'Phone', 'Number status', 'Type', 'Email', 'Company', 'Location',
        'Tags', 'Orders', 'Last order', 'Lifetime value', 'Wallet balance', 'Came in as lead',
      ]
      const body = all.map((p) => [
        p.name, p.phone, p.numberStatus, KIND_LABEL[p.kind], p.email, p.companyName,
        p.locationName || '', (p.tags || []).join('; '), p.orderCount,
        p.lastOrderAt ? new Date(p.lastOrderAt).toISOString().slice(0, 10) : '',
        p.lifetimeValue || 0, p.balance ?? '', p.cameInAsLead ? 'Yes' : 'No',
      ])
      triggerDownload(
        new Blob(['﻿' + [header, ...body].map((r) => r.map(csvCell).join(',')).join('\r\n')],
          { type: 'text/csv;charset=utf-8' }),
        `people-${new Date().toISOString().slice(0, 10)}.csv`,
      )
      toast.success(`${all.length} record${all.length === 1 ? '' : 's'} exported`)
    } catch (err: any) {
      toast.error(err?.message || 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  const depotOptions = useMemo(
    () => [...depots].sort((a, b) => String(a.name).localeCompare(String(b.name))),
    [depots],
  )

  if (isLoading) return <PageLoader message="Loading people..." />
  if (isError) return <PageError message={(error as any)?.message || 'Failed to load people'} onRetry={() => refetch()} />

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        eyebrow="Orders"
        title="Customers & Leads"
        description="Everyone we hold a number for, in one book. A lead becomes a customer on the same row the moment they sign up on that number."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={exportPeople} disabled={exporting}>
              <Download className="size-4 mr-2" />{exporting ? 'Exporting…' : 'Export'}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
              <Upload className="size-4 mr-2" />Import CSV
            </Button>
            <Button size="sm" onClick={openAdd}>
              <Plus className="size-4 mr-2" />Add Lead
            </Button>
          </>
        }
      />

      {summary && (
        <StatCardGrid count={4}>
          <StatCard
            icon={<Users />} label="Everyone" value={summary.total.toLocaleString()}
            description={`${summary.newThisMonth.toLocaleString()} added this month`}
            className="cursor-pointer"
            onClick={() => setKind('')}
          />
          <StatCard
            tone="green" icon={<CheckCircle2 />} label="Customers"
            value={summary.customers.toLocaleString()}
            description={`${summary.converted.toLocaleString()} started as a lead`}
            className="cursor-pointer"
            onClick={() => setKind(kind === 'customer' ? '' : 'customer')}
          />
          <StatCard
            tone="amber" icon={<Sparkles />} label="Open leads"
            value={summary.leads.toLocaleString()}
            description="No account yet"
            className="cursor-pointer"
            onClick={() => setKind(kind === 'lead' ? '' : 'lead')}
          />
          {/* Counted over the whole book, not the filtered view — this is a
              standing fact about the data, and a number that moved when you
              typed in the search box would mean nothing. */}
          <StatCard
            tone={summary.needsAttention > 0 ? 'amber' : undefined}
            icon={<ShieldAlert />} label="Numbers to review"
            value={summary.needsAttention.toLocaleString()}
            description={summary.needsAttention > 0 ? 'Broken, unreachable or doubled' : 'Every number checks out'}
            className="cursor-pointer"
            onClick={() => openReview('all')}
          />
        </StatCardGrid>
      )}

      <FilterBar>
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground size-4" />
          <Input
            placeholder="Name, phone, company, email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 size-5 rounded-full bg-muted text-muted-foreground hover:bg-primary hover:text-primary-foreground flex items-center justify-center cursor-pointer transition-colors duration-250 ease-luxe"
              aria-label="Clear search"
            ><X className="size-2.5" /></button>
          )}
        </div>

        <NativeSelect className="w-44" value={kind} onChange={(e) => setKind(e.target.value as any)}>
          <option value="">Everyone</option>
          <option value="customer">Customers</option>
          <option value="lead">Leads</option>
          <option value="contact">Other contacts</option>
          <option value="prospect">Anyone not a customer</option>
        </NativeSelect>

        <NativeSelect className="w-44" value={converted} onChange={(e) => setConverted(e.target.value as any)}>
          <option value="">However they arrived</option>
          <option value="yes">Started as a lead</option>
          <option value="no">Not a customer yet</option>
        </NativeSelect>

        {/* Only meaningful for customers — a lead has no order history to band. */}
        {kind !== 'lead' && kind !== 'contact' && kind !== 'prospect' && (
          <NativeSelect className="w-40" value={activity} onChange={(e) => setActivity(e.target.value)}>
            <option value="">Any activity</option>
            <option value="frequent">Frequent</option>
            <option value="occasional">Occasional</option>
            <option value="dormant">Dormant</option>
            <option value="never">Never ordered</option>
          </NativeSelect>
        )}

        <NativeSelect className="w-44" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
          <option value="">All locations</option>
          {depotOptions.map((d: DepotItem) => (
            <option key={String(d.id)} value={String(d.id)}>{d.name}</option>
          ))}
        </NativeSelect>

        {tags.length > 0 && (
          <NativeSelect className="w-36" value={tag} onChange={(e) => setTag(e.target.value)}>
            <option value="">All tags</option>
            {tags.map((t) => <option key={t} value={t}>{t}</option>)}
          </NativeSelect>
        )}

        <NativeSelect className="w-44" value={optedOut} onChange={(e) => setOptedOut(e.target.value as any)}>
          <option value="">Any marketing status</option>
          <option value="no">Reachable</option>
          <option value="yes">Opted out</option>
        </NativeSelect>

        <NativeSelect className="w-48" value={numberStatus} onChange={(e) => setNumberStatus(e.target.value as any)}>
          <option value="">Any phone number</option>
          <option value="ok">Good numbers only</option>
          <option value="invalid">Invalid numbers</option>
          <option value="unreachable">Cannot receive SMS</option>
          <option value="duplicate">Duplicated numbers</option>
        </NativeSelect>

        <NativeSelect className="w-44" value={sort} onChange={(e) => setSort(e.target.value as any)}>
          <option value="active">Most recently active</option>
          <option value="value">Highest lifetime value</option>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="name">Name (A–Z)</option>
          <option value="company">Company (A–Z)</option>
        </NativeSelect>

        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X data-icon="inline-start" />Clear
          </Button>
        )}
      </FilterBar>

      {/* A standing banner, not a toast: 8% of the book is unusable numbers,
          and that is a thing to fix rather than a thing to dismiss. */}
      {summary && summary.needsAttention > 0 && !reviewOpen && (
        <button
          onClick={() => openReview('all')}
          className="w-full flex items-center gap-3 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-left hover:bg-warning/10 transition-colors duration-250 ease-luxe cursor-pointer"
        >
          <AlertTriangle className="size-4 shrink-0 text-warning" />
          <span className="flex-1 text-sm">
            <strong>{summary.needsAttention.toLocaleString()} phone number{summary.needsAttention === 1 ? '' : 's'}</strong>
            {' '}cannot receive a message — invalid, landline, or held by more than one record.
            Every send to one of them is billed and lost.
          </span>
          <span className="text-xs font-medium text-warning whitespace-nowrap">Review →</span>
        </button>
      )}

      <Card>
        <CardContent>
          {people.length === 0 ? (
            <PageEmpty
              icon={<Users className="size-6 text-muted-foreground" />}
              title={hasFilters ? 'Nobody matches your filters' : 'Nobody on the book yet'}
              description={hasFilters
                ? 'Try widening the search or clearing a filter.'
                : 'Add a lead by hand, or upload a spreadsheet of numbers to start from.'}
              actionLabel={hasFilters ? undefined : 'Import CSV'}
              onAction={hasFilters ? undefined : () => setImportOpen(true)}
              hasFilters={hasFilters}
              onClearFilters={clearFilters}
            />
          ) : (
            <>
              <div className={cn('overflow-x-auto transition-opacity', isFetching && 'opacity-60')}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="hidden lg:table-cell">Location</TableHead>
                      <TableHead className="hidden xl:table-cell">Tags</TableHead>
                      <TableHead>Activity</TableHead>
                      <TableHead className="text-right hidden md:table-cell">Wallet</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {people.map((p) => (
                      <TableRow key={`${p.kind}-${p.customerId ?? p.contactId}`} className="hover:bg-muted/50 transition">
                        <TableCell>
                          <p className="font-medium uppercase">{p.name}</p>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                            <span className={cn(
                              'flex items-center gap-1',
                              p.numberStatus !== 'ok' && 'text-warning',
                            )}>
                              {p.numberStatus === 'ok' ? <Phone className="size-3" /> : <PhoneOff className="size-3" />}
                              {p.phone}
                            </span>
                            {p.companyName && (
                              <span className="flex items-center gap-1"><Building2 className="size-3" />{p.companyName}</span>
                            )}
                            {p.hasDuplicate && (
                              <span className="flex items-center gap-1 text-warning" title="More than one record holds this number">
                                <Copy className="size-3" />Duplicated
                              </span>
                            )}
                            {p.marketingOptOut && (
                              <span className="flex items-center gap-1 text-warning">
                                <MessageSquare className="size-3" />Opted out
                              </span>
                            )}
                          </div>
                          {p.numberStatus !== 'ok' && (
                            <p className="mt-0.5 text-xs text-warning">{p.numberReason}</p>
                          )}
                        </TableCell>

                        <TableCell>
                          <div className="space-y-0.5">
                            <Badge
                              variant="outline"
                              className={cn('font-normal', p.kind === 'customer' && 'bg-accent/10 text-accent border-accent/20')}
                            >
                              {KIND_LABEL[p.kind]}
                            </Badge>
                            {/* The whole point of the merge: one row that
                                remembers where the relationship started. */}
                            {p.cameInAsLead && (
                              <p className="text-xs text-muted-foreground">Started as a lead</p>
                            )}
                          </div>
                        </TableCell>

                        <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                          {p.locationName || '—'}
                        </TableCell>

                        <TableCell className="hidden xl:table-cell">
                          <div className="flex flex-wrap gap-1">
                            {(p.tags || []).map((t) => (
                              <Badge key={t} variant="outline" className="h-5 px-1.5 text-xs font-normal text-muted-foreground">{t}</Badge>
                            ))}
                            {!(p.tags || []).length && <span className="text-sm text-muted-foreground">—</span>}
                          </div>
                        </TableCell>

                        <TableCell>
                          {p.kind === 'customer' ? (
                            <div className="space-y-0.5">
                              <Badge variant="outline" className={cn('font-normal', ACTIVITY[p.activityBand || 'never']?.className)}>
                                {ACTIVITY[p.activityBand || 'never']?.label}
                              </Badge>
                              <p className="text-xs text-muted-foreground">
                                {p.orderCount > 0
                                  ? `${p.orderCount} order${p.orderCount === 1 ? '' : 's'} · ${relativeDate(p.lastOrderAt)}`
                                  : 'No orders yet'}
                              </p>
                            </div>
                          ) : (
                            <Badge variant="outline" className="font-normal text-muted-foreground">Prospect</Badge>
                          )}
                        </TableCell>

                        {/* A lead has no wallet, and an em dash says that more
                            honestly than a zero would. */}
                        <TableCell className="text-right hidden md:table-cell">
                          {p.balance === null ? (
                            <span className="text-sm text-muted-foreground">—</span>
                          ) : (
                            <div className="space-y-0.5">
                              <p className={cn('text-sm font-medium', p.balance > 0 && 'text-accent')}>
                                {compactMoney(p.balance)}
                              </p>
                              {p.lifetimeValue > 0 && (
                                <p className="text-xs text-muted-foreground">{compactMoney(p.lifetimeValue)} lifetime</p>
                              )}
                            </div>
                          )}
                        </TableCell>

                        <TableCell className="text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1">
                            {p.kind === 'customer' ? (
                              <>
                                <Button
                                  variant="ghost" size="sm" className="h-8 px-2 text-xs"
                                  title={`Open ${p.name}`}
                                  onClick={() => navigate({
                                    to: '/customers/details' as any,
                                    search: { id: p.customerId } as any,
                                  } as any)}
                                >
                                  Open
                                </Button>
                                {p.customerStatus === 'Active' && (
                                  <Button
                                    variant="ghost" size="sm"
                                    className="size-8 p-0 text-muted-foreground hover:text-warning"
                                    title={`Archive ${p.name}`}
                                    onClick={() => setArchiving(p)}
                                  >
                                    <Archive className="size-3.5" />
                                  </Button>
                                )}
                              </>
                            ) : (
                              <>
                                <Button
                                  variant="ghost" size="sm" className="h-8 px-2 text-xs"
                                  title={`Make ${p.name} a customer`}
                                  onClick={() => setConverting(p)}
                                >
                                  <UserPlus className="size-3.5 mr-1" />Convert
                                </Button>
                                <Button variant="ghost" size="sm" className="size-8 p-0" title={`Edit ${p.name}`} onClick={() => openEdit(p)}>
                                  <Pencil className="size-3.5" />
                                </Button>
                                <Button
                                  variant="ghost" size="sm"
                                  className="size-8 p-0 text-muted-foreground hover:text-destructive"
                                  title={`Remove ${p.name}`}
                                  onClick={() => setDeleting(p)}
                                >
                                  <Trash2 className="size-3.5" />
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <Pagination
                currentPage={page}
                totalPages={totalPages}
                pageSize={pageSize}
                totalItems={totalItems}
                onPageChange={setPage}
                onPageSizeChange={(size) => { setPageSize(size); setPage(1) }}
              />
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Add / edit a lead ──────────────────────────────────────────────── */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-[560px] max-h-[88svh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.name}` : 'Add lead'}</DialogTitle>
            <DialogDescription>
              Someone worth keeping a number for who has not bought yet. Customers are
              edited from their own record.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Aisha Bello" />
            </div>
            <div className="space-y-1">
              <Label>Phone</Label>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="e.g. 08012345678" />
            </div>
            <div className="space-y-1">
              <Label>Email</Label>
              <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Optional" />
            </div>
            <div className="space-y-1">
              <Label>Company</Label>
              <Input value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} placeholder="Optional" />
            </div>
            <div className="space-y-1">
              <Label>Type</Label>
              <NativeSelect value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value as ContactStage })}>
                <option value="lead">Lead — someone to sell to</option>
                <option value="contact">Contact — everyone else</option>
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <Label>Location</Label>
              <NativeSelect value={form.locationId} onChange={(e) => setForm({ ...form, locationId: e.target.value })}>
                <option value="">No location</option>
                {depotOptions.map((d: DepotItem) => (
                  <option key={String(d.id)} value={String(d.id)}>{d.name}</option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <Label className="flex items-center gap-1.5"><TagIcon className="size-3" />Tags</Label>
              <Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="comma separated" />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label>Notes</Label>
              <Textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Where they came from, what they asked about…" />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button onClick={submitForm} disabled={createContact.isPending || updateContact.isPending}>
              {(createContact.isPending || updateContact.isPending) && <Loader2 className="size-4 mr-2 animate-spin" />}
              {editing ? 'Save changes' : 'Add lead'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── CSV import, with the dry run in front of the button ────────────── */}
      <Dialog open={importOpen} onOpenChange={closeImport}>
        <DialogContent className="sm:max-w-[680px] max-h-[88svh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Import contacts</DialogTitle>
            <DialogDescription>
              A CSV with a name and a phone number per row. Column names are matched
              loosely — "Phone", "Phone Number" and "Mobile" all work. Every number is
              checked against both the customer book and the contacts list before
              anything is written.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f) }}
            />
            <Button variant="outline" className="w-full" onClick={() => fileInput.current?.click()}>
              <Upload className="size-4 mr-2" />{fileName || 'Choose a CSV file'}
            </Button>

            {preview.isPending && (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />Checking these numbers against the book…
              </div>
            )}

            {counts && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {(Object.keys(VERDICT) as ImportVerdict[])
                    .filter((v) => counts[v] > 0)
                    .map((v) => (
                      <div
                        key={v}
                        className={cn(
                          'rounded-lg border p-2.5',
                          VERDICT[v].tone === 'good' && 'border-accent/30 bg-accent/5',
                          VERDICT[v].tone === 'warn' && 'border-warning/30 bg-warning/5',
                          VERDICT[v].tone === 'neutral' && 'border-border bg-muted/30',
                        )}
                      >
                        <p className={cn(
                          'text-lg font-semibold',
                          VERDICT[v].tone === 'good' && 'text-accent',
                          VERDICT[v].tone === 'warn' && 'text-warning',
                        )}>
                          {counts[v].toLocaleString()}
                        </p>
                        <p className="text-xs text-muted-foreground">{VERDICT[v].label}</p>
                      </div>
                    ))}
                </div>

                {/* The choice the preview exists to inform. */}
                {counts.existing_contact > 0 && (
                  <div className="space-y-2 rounded-lg border border-border p-3">
                    <Label className="text-xs uppercase text-muted-foreground">
                      {counts.existing_contact.toLocaleString()} of these are already on file
                    </Label>
                    <label className="flex items-start gap-2.5 cursor-pointer select-none">
                      <input
                        type="radio" checked={importMode === 'new_only'} onChange={() => setImportMode('new_only')}
                        className="mt-0.5 size-4 accent-primary cursor-pointer"
                      />
                      <div>
                        <span className="text-sm">Add only the new ones</span>
                        <p className="text-xs text-muted-foreground">Leaves everyone already on file exactly as they are.</p>
                      </div>
                    </label>
                    <label className="flex items-start gap-2.5 cursor-pointer select-none">
                      <input
                        type="radio" checked={importMode === 'upsert'} onChange={() => setImportMode('upsert')}
                        className="mt-0.5 size-4 accent-primary cursor-pointer"
                      />
                      <div>
                        <span className="text-sm">Add the new ones and correct the rest</span>
                        <p className="text-xs text-muted-foreground">
                          Updates people already on file from this sheet. A blank cell leaves what is
                          already there alone.
                        </p>
                      </div>
                    </label>
                  </div>
                )}

                {(counts.invalid > 0 || counts.existing_customer > 0) && (
                  <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <AlertTriangle className="mt-0.5 size-3 shrink-0 text-warning" />
                    {counts.invalid > 0 && (
                      <span>
                        {counts.invalid} line{counts.invalid === 1 ? ' is' : 's are'} not a usable phone
                        number and will not be imported.{' '}
                      </span>
                    )}
                    {counts.existing_customer > 0 && (
                      <span>
                        {counts.existing_customer} already {counts.existing_customer === 1 ? 'has' : 'have'} a
                        customer account — importing them again would put the same person on the book twice.
                      </span>
                    )}
                  </p>
                )}

                {/* The rows that would be refused, named. A count alone leaves
                    someone to guess which lines of their file are wrong. */}
                {preview.data && preview.data.rows.some((r) => r.verdict === 'invalid' || r.verdict === 'incomplete') && (
                  <details className="rounded-lg border border-border">
                    <summary className="cursor-pointer px-3 py-2 text-xs text-muted-foreground hover:text-foreground">
                      Show the lines that will be skipped
                    </summary>
                    <div className="max-h-48 overflow-y-auto border-t border-border">
                      <table className="w-full text-xs">
                        <tbody>
                          {preview.data.rows
                            .filter((r) => r.verdict === 'invalid' || r.verdict === 'incomplete')
                            .slice(0, 100)
                            .map((r) => (
                              <tr key={r.line} className="border-b border-border/50 last:border-0">
                                <td className="px-3 py-1.5 text-muted-foreground">Line {r.line}</td>
                                <td className="px-3 py-1.5 font-medium">{r.name || '—'}</td>
                                <td className="px-3 py-1.5 font-mono text-muted-foreground">{r.phone || '—'}</td>
                                <td className="px-3 py-1.5 text-warning">{r.reason}</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => closeImport(false)}>Cancel</Button>
            <Button onClick={runImport} disabled={!willLand || importContacts.isPending || preview.isPending}>
              {importContacts.isPending && <Loader2 className="size-4 mr-2 animate-spin" />}
              {willLand
                ? `Import ${willLand.toLocaleString()} contact${willLand === 1 ? '' : 's'}`
                : 'Nothing to import'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── The number review panel ────────────────────────────────────────── */}
      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="sm:max-w-[820px] max-h-[88svh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Numbers that need a look</DialogTitle>
            <DialogDescription>
              Nothing here is removed automatically. A record with orders, deposits or a
              wallet balance behind it cannot be deleted from this panel at all — the
              number is the problem, and the order history is not.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap gap-2">
            {([
              ['all', 'Everything', hygiene?.summary.total],
              ['invalid', 'Not a real number', hygiene?.summary.invalid],
              ['unreachable', 'Cannot receive SMS', hygiene?.summary.unreachable],
              ['duplicate', 'Held by two records', hygiene?.summary.duplicate],
            ] as const).map(([value, label, count]) => (
              <Button
                key={value}
                variant={reviewIssue === value ? 'default' : 'outline'}
                size="sm"
                className="h-8 text-xs"
                onClick={() => { setReviewIssue(value as typeof reviewIssue); setSelected({}) }}
              >
                {label}{count === undefined ? '' : ` (${count.toLocaleString()})`}
              </Button>
            ))}
          </div>

          {hygieneLoading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="size-5 animate-spin text-primary" /></div>
          ) : !hygiene?.issues.length ? (
            <div className="py-10 text-center">
              <CheckCircle2 className="mx-auto size-8 text-accent" />
              <p className="mt-2 text-sm text-muted-foreground">Every number on the book checks out.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {hygiene.issues.map((group) => (
                <div key={group.phoneKey} className="rounded-lg border border-border">
                  <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/30 px-3 py-2">
                    <span className="font-mono text-sm">…{group.phoneKey}</span>
                    {group.problems.map((p) => (
                      <Badge
                        key={p.type}
                        variant="outline"
                        className="bg-warning/10 text-warning border-warning/20 font-normal text-xs"
                        title={p.reason}
                      >
                        {p.type === 'invalid' ? 'Not a real number'
                          : p.type === 'unreachable' ? 'Cannot receive SMS'
                            : 'Held by two records'}
                      </Badge>
                    ))}
                    <span className="text-xs text-muted-foreground">{group.problems[0]?.reason}</span>
                  </div>

                  <div className="divide-y divide-border">
                    {group.records.map((r) => {
                      const blocked = Boolean(r.deletableReason)
                      return (
                        <label
                          key={recordKey(r)}
                          className={cn(
                            'flex items-start gap-3 px-3 py-2.5',
                            blocked ? 'cursor-not-allowed opacity-70' : 'cursor-pointer hover:bg-muted/40',
                          )}
                        >
                          <input
                            type="checkbox"
                            disabled={blocked}
                            checked={Boolean(selected[recordKey(r)])}
                            onChange={() => toggleRecord(r)}
                            className="mt-1 size-4 rounded border-input accent-primary disabled:cursor-not-allowed"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium uppercase">{r.name}</span>
                              <Badge variant="outline" className="h-5 px-1.5 text-xs font-normal">
                                {r.kind === 'customer' ? 'Customer' : 'Contact'}
                              </Badge>
                              <span className="font-mono text-xs text-muted-foreground">{r.phone}</span>
                            </div>
                            <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                              {r.companyName && <span>{r.companyName}</span>}
                              {r.kind === 'customer' && (
                                <>
                                  <span>{r.orderCount} order{r.orderCount === 1 ? '' : 's'}</span>
                                  {r.depositCount > 0 && <span>{r.depositCount} deposit{r.depositCount === 1 ? '' : 's'}</span>}
                                  {r.balance !== null && r.balance !== 0 && (
                                    <span className="flex items-center gap-1"><Wallet className="size-3" />{money(r.balance)}</span>
                                  )}
                                </>
                              )}
                              <span>Added {new Date(r.createdAt).toLocaleDateString('en-NG')}</span>
                            </div>
                            {/* Why the checkbox is disabled, said out loud. */}
                            {blocked && (
                              <p className="mt-1 flex items-center gap-1 text-xs text-warning">
                                <ShieldAlert className="size-3" />
                                Cannot be removed here — {r.deletableReason!.toLowerCase()}
                              </p>
                            )}
                          </div>
                          {r.kind === 'customer' && (
                            <Button
                              variant="ghost" size="sm" className="h-7 px-2 text-xs shrink-0"
                              onClick={(e) => {
                                e.preventDefault()
                                setReviewOpen(false)
                                navigate({ to: '/customers/details' as any, search: { id: r.id } as any } as any)
                              }}
                            >
                              Open
                            </Button>
                          )}
                        </label>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          <DialogFooter className="items-center sm:justify-between">
            <span className="text-xs text-muted-foreground">
              {selectedList.length > 0
                ? `${selectedList.length} record${selectedList.length === 1 ? '' : 's'} selected`
                : 'Tick the records you want gone'}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setReviewOpen(false)}>Close</Button>
              <Button
                variant="destructive"
                disabled={!selectedList.length || deleteReviewed.isPending}
                onClick={() => setConfirmPurge(true)}
              >
                {deleteReviewed.isPending && <Loader2 className="size-4 mr-2 animate-spin" />}
                Remove {selectedList.length || ''}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmPurge}
        onOpenChange={setConfirmPurge}
        title={`Remove ${selectedList.length} record${selectedList.length === 1 ? '' : 's'}?`}
        description="This deletes them permanently. Anything with orders or money behind it is checked again on the server and will be kept regardless of what is ticked here."
        confirmLabel="Remove"
        variant="destructive"
        loading={deleteReviewed.isPending}
        onConfirm={async () => {
          await deleteReviewed.mutateAsync(selectedList)
          setSelected({})
          setConfirmPurge(false)
        }}
      />

      <ConfirmDialog
        open={converting !== null}
        onOpenChange={(o) => { if (!o) setConverting(null) }}
        title={`Make ${converting?.name ?? ''} a customer?`}
        description="Creates a customer record on this number, carrying their name, company and email across. They stay on this list as the same person — the row simply becomes a customer, and remembers that it started as a lead."
        confirmLabel="Convert"
        loading={convertContact.isPending}
        onConfirm={async () => {
          if (converting?.contactId) await convertContact.mutateAsync(converting.contactId)
          setConverting(null)
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => { if (!o) setDeleting(null) }}
        title={`Remove ${deleting?.name ?? ''}?`}
        description="This deletes the contact record. Nothing financial is attached to a contact, so nothing else is affected."
        confirmLabel="Remove"
        variant="destructive"
        loading={deleteContact.isPending}
        onConfirm={async () => {
          if (deleting?.contactId) await deleteContact.mutateAsync(deleting.contactId)
          setDeleting(null)
        }}
      />

      <ConfirmDialog
        open={archiving !== null}
        onOpenChange={(o) => { if (!o) setArchiving(null) }}
        title={`Archive ${archiving?.name ?? ''}?`}
        description="They stop appearing in the active book and are never included in a broadcast. Their orders, wallet and history are untouched."
        confirmLabel="Archive"
        loading={updateCustomer.isPending}
        onConfirm={async () => {
          if (archiving?.customerId) {
            // The hook takes the id as a string — it goes straight into the URL.
            await updateCustomer.mutateAsync({ id: String(archiving.customerId), data: { status: 'Inactive' } })
          }
          setArchiving(null)
        }}
      />
    </div>
  )
}
