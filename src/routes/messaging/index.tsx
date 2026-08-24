import { useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '#/components/PageHeader'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '#/components/ui/card'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Textarea } from '#/components/ui/textarea'
import { Badge } from '#/components/ui/badge'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '#/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '#/components/ui/dialog'
import { MultiSelectPicker, type MultiSelectOption } from '#/components/MultiSelectPicker'
import { ConfirmDialog } from '#/components/ConfirmDialog'
import {
  Users, Warehouse, Repeat, Clock, Mail, MessageSquare as SmsIcon, Send, Loader2,
  Tag, CheckCircle2, XCircle, AlertCircle, History, Megaphone, BookmarkPlus, Trash2, Sparkles,
} from 'lucide-react'
import { useDepots } from '#/lib/hooks/useDepots'
import { useCustomerList } from '#/lib/hooks/useCustomers'
import { useContactList, useContactTags } from '#/lib/hooks/useContacts'
import {
  useCustomerSegment, useBroadcast, useNotificationDeliveries,
  useMessageTemplates, useCreateMessageTemplate, useDeleteMessageTemplate,
  type SegmentFilters, type MessageTemplate,
} from '#/lib/hooks/useMessaging'
import api from '#/lib/api/http'
import { useToast } from '#/lib/hooks/useToast'
import { routeGuard } from '#/lib/route-guard'

export const Route = createFileRoute('/messaging/')({
  beforeLoad: () => routeGuard('/messaging'),
  component: MessagingPage,
})

/**
 * Ready-made starting points for the scenarios most asked for — not stored
 * server-side, just fills the composer. "Save as Template" turns any edited
 * (or from-scratch) message into a real, shared, saved template from there.
 */
const STARTER_TEMPLATES: Array<{ name: string; subject: string; body: string; channels: Array<'email' | 'sms'> }> = [
  {
    name: 'Frequent buyer thank-you',
    subject: 'Thank you for your continued business',
    body: "Hi, thank you for being one of our regular customers — we really appreciate your continued business with Soroman.\n\nIf there's anything we can do to serve you better, please reach out.",
    channels: ['email', 'sms'],
  },
  {
    name: 'Inactive customer reminder',
    subject: "We've missed you",
    body: "Hi, it's been a while since your last order with us. We'd love to have you back — reach out if there's anything we can help with, or place an order whenever you're ready.",
    channels: ['email', 'sms'],
  },
  {
    name: 'Price update',
    subject: 'Updated pricing',
    body: 'Hi, please find our latest prices below.',
    channels: ['email', 'sms'],
  },
]

type AudienceMode = 'segment' | 'specific' | 'contacts'
type CatalogDepot = { id: number; name: string; products: Array<{ name: string; code: string; unit: string; price: number }> }

const formatMoney = (v: number) =>
  new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', minimumFractionDigits: 0 }).format(v)

function formatDate(v: string | null) {
  if (!v) return '—'
  return new Date(v).toLocaleString('en-NG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'delivered' || status === 'sent') {
    return <Badge variant="outline" className="bg-success/10 text-success border-success/20 flex items-center gap-1 w-fit font-normal"><CheckCircle2 className="size-3" />{status}</Badge>
  }
  if (status === 'failed') {
    return <Badge variant="destructive" className="flex items-center gap-1 w-fit font-normal"><XCircle className="size-3" />Failed</Badge>
  }
  if (status === 'skipped' || status === 'suppressed') {
    return <Badge variant="outline" className="text-muted-foreground flex items-center gap-1 w-fit font-normal"><AlertCircle className="size-3" />{status}</Badge>
  }
  return <Badge variant="outline" className="w-fit font-normal">{status}</Badge>
}

function MessagingPage() {
  const toast = useToast()
  const { data: depots = [] } = useDepots()

  // ── Audience ────────────────────────────────────────────────────────────
  const [audienceMode, setAudienceMode] = useState<AudienceMode>('segment')

  const [depotId, setDepotId] = useState<number | undefined>(undefined)
  const [frequentEnabled, setFrequentEnabled] = useState(false)
  const [minOrders, setMinOrders] = useState(3)
  const [sinceDays, setSinceDays] = useState(90)
  const [inactiveEnabled, setInactiveEnabled] = useState(false)
  const [inactiveSinceDays, setInactiveSinceDays] = useState(60)

  const segmentFilters: SegmentFilters = useMemo(() => ({
    depotId,
    minOrders: frequentEnabled ? minOrders : undefined,
    sinceDays: frequentEnabled ? sinceDays : undefined,
    inactiveSinceDays: inactiveEnabled ? inactiveSinceDays : undefined,
  }), [depotId, frequentEnabled, minOrders, sinceDays, inactiveEnabled, inactiveSinceDays])

  const { data: segmentData, isFetching: segmentLoading } = useCustomerSegment(segmentFilters, { enabled: audienceMode === 'segment' })

  const [specificSearch, setSpecificSearch] = useState('')
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<number[]>([])
  const { data: specificSearchData, isLoading: specificLoading } = useCustomerList(
    { search: specificSearch, limit: 500 },
    { enabled: audienceMode === 'specific' }
  )
  const specificOptions: MultiSelectOption[] = (specificSearchData?.customers || []).map(
    (c: { id: number; name: string; companyName?: string; phone?: string }) => ({
      id: Number(c.id),
      primary: c.name,
      secondary: [c.companyName, c.phone].filter(Boolean).join(' • '),
    })
  )

  // ── Contacts & leads ────────────────────────────────────────────────────
  //
  // Non-customers have no principal to address, so they are sent as their own
  // details rather than as ids — see BroadcastPayload. Opted-out contacts are
  // already excluded by the server, and anyone who has since become a
  // customer is filtered out here by default so a campaign does not reach the
  // same person twice under two identities.
  const [contactStage, setContactStage] = useState<'' | 'lead' | 'contact'>('lead')
  const [contactTag, setContactTag] = useState('')
  const [excludeConverted, setExcludeConverted] = useState(true)
  const { data: contactTags = [] } = useContactTags()
  const { data: contactData, isFetching: contactsLoading } = useContactList(
    audienceMode === 'contacts'
      ? { stage: contactStage, tag: contactTag, optedOut: 'no', converted: excludeConverted ? 'no' : '', limit: 5000 }
      : { limit: 1 },
  )
  const contactRecipients = useMemo(
    () => (audienceMode === 'contacts' ? (contactData?.contacts ?? []) : []),
    [audienceMode, contactData],
  )

  const recipientCount =
    audienceMode === 'specific' ? selectedCustomerIds.length
      : audienceMode === 'contacts' ? contactRecipients.length
        : (segmentData?.count ?? 0)

  // ── Channels + message ─────────────────────────────────────────────────
  const [emailOn, setEmailOn] = useState(true)
  const [smsOn, setSmsOn] = useState(false)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')

  const loadIntoComposer = (t: { subject?: string; body: string; channels?: Array<'email' | 'sms'> }) => {
    setSubject(t.subject || '')
    setBody(t.body)
    if (t.channels?.length) {
      setEmailOn(t.channels.includes('email'))
      setSmsOn(t.channels.includes('sms'))
    }
  }

  // ── Templates ───────────────────────────────────────────────────────────
  const { data: savedTemplates = [], isLoading: templatesLoading } = useMessageTemplates()
  const createTemplate = useCreateMessageTemplate()
  const deleteTemplate = useDeleteMessageTemplate()
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false)
  const [newTemplateName, setNewTemplateName] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<MessageTemplate | null>(null)

  const handleSaveTemplate = async () => {
    if (!newTemplateName.trim()) { toast.error('Name this template'); return }
    if (!body.trim()) { toast.error('Write a message first'); return }
    await createTemplate.mutateAsync({
      name: newTemplateName.trim(),
      subject: subject.trim(),
      body: body.trim(),
      channels: [...(emailOn ? (['email'] as const) : []), ...(smsOn ? (['sms'] as const) : [])],
    })
    setSaveTemplateOpen(false)
    setNewTemplateName('')
  }

  const [priceDepotId, setPriceDepotId] = useState<number | undefined>(undefined)
  const [insertingPrices, setInsertingPrices] = useState(false)

  const insertPrices = async () => {
    setInsertingPrices(true)
    try {
      const res = await api.get('/catalog')
      const catalogDepots = (res.data.data.depots || []) as CatalogDepot[]
      const targetId = priceDepotId ?? depotId
      const list = targetId ? catalogDepots.filter((d) => d.id === targetId) : catalogDepots
      if (list.length === 0) {
        toast.error('No priced products found for this depot')
        return
      }
      const lines: string[] = ['Current prices:']
      for (const d of list) {
        lines.push('', `${d.name}:`)
        for (const p of d.products) {
          lines.push(`${p.name} (${p.code}) — ${formatMoney(p.price)}/${p.unit}`)
        }
      }
      setBody((prev) => (prev.trim() ? prev.trimEnd() + '\n\n' : '') + lines.join('\n'))
    } catch {
      toast.error('Could not load current prices')
    } finally {
      setInsertingPrices(false)
    }
  }

  // ── Send ────────────────────────────────────────────────────────────────
  const [confirmOpen, setConfirmOpen] = useState(false)
  const broadcast = useBroadcast()

  const channels: Array<'email' | 'sms'> = [...(emailOn ? (['email'] as const) : []), ...(smsOn ? (['sms'] as const) : [])]

  const openConfirm = () => {
    if (!body.trim()) { toast.error('Write a message first'); return }
    if (channels.length === 0) { toast.error('Choose at least one channel'); return }
    if (recipientCount === 0) { toast.error('No recipients match this audience'); return }
    setConfirmOpen(true)
  }

  const handleSend = async () => {
    const common = {
      title: subject.trim() || 'Message from Soroman',
      body: body.trim(),
      channels,
    }
    await broadcast.mutateAsync(
      audienceMode === 'contacts'
        ? {
          ...common,
          audience: 'contacts' as const,
          contacts: contactRecipients.map((c) => ({ name: c.name, email: c.email, phone: c.phone })),
        }
        : {
          ...common,
          audience: 'customers' as const,
          customerIds: audienceMode === 'specific'
            ? selectedCustomerIds
            : (segmentData?.customers.map((c) => c.id) ?? []),
        },
    )
    setConfirmOpen(false)
    setSubject('')
    setBody('')
  }

  // ── Delivery log ────────────────────────────────────────────────────────
  const [logChannel, setLogChannel] = useState('all')
  const [logStatus, setLogStatus] = useState('all')
  const { data: deliveryData, isLoading: deliveriesLoading } = useNotificationDeliveries({
    channel: logChannel === 'all' ? undefined : logChannel,
    status: logStatus === 'all' ? undefined : logStatus,
    type: 'system.announcement',
    limit: 50,
  })

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin"
        title="Messaging"
        description="Compose and send SMS/email to customers, targeted by segment."
      />

      <Card className="border-border/60">
        <CardHeader className="border-b border-border/40 pb-3">
          <div className="flex items-center gap-2">
            <Users className="size-4 text-primary" />
            <div>
              <CardTitle className="text-base font-semibold">Audience</CardTitle>
              <CardDescription className="text-xs mt-0.5">Who this message goes to</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-4 space-y-4">
          <div className="flex gap-2">
            <button type="button" onClick={() => setAudienceMode('segment')}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${audienceMode === 'segment' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}>
              By segment
            </button>
            <button type="button" onClick={() => setAudienceMode('specific')}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${audienceMode === 'specific' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}>
              Specific customers
            </button>
            <button type="button" onClick={() => setAudienceMode('contacts')}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${audienceMode === 'contacts' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}>
              Contacts &amp; leads
            </button>
            <div className="ml-auto flex items-center">
              <Badge variant="secondary" className="text-xs px-3 py-1.5 font-semibold">
                {segmentLoading || specificLoading || contactsLoading ? <Loader2 className="size-3 animate-spin mr-1.5" /> : null}
                {recipientCount} recipient{recipientCount === 1 ? '' : 's'}
              </Badge>
            </div>
          </div>

          {audienceMode === 'segment' ? (
            <div className="space-y-4">
              <div>
                <Label className="mb-1.5 flex items-center gap-1.5 text-xs uppercase text-muted-foreground"><Warehouse className="size-3.5" /> Location</Label>
                <Select value={depotId ? String(depotId) : 'any'} onValueChange={(v) => setDepotId(v === 'any' ? undefined : Number(v))}>
                  <SelectTrigger className="w-full sm:w-[280px] text-sm h-9">
                    <SelectValue placeholder="Any depot" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any depot</SelectItem>
                    {depots.map((d) => (<SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">Customers who have ordered from this depot. Leave as "Any depot" to skip this filter.</p>
              </div>

              <label className="flex items-start gap-3 cursor-pointer select-none">
                <input type="checkbox" checked={frequentEnabled} onChange={(e) => setFrequentEnabled(e.target.checked)} className="mt-1 size-4 rounded border-input text-primary accent-primary cursor-pointer" />
                <div className="flex-1">
                  <span className="flex items-center gap-1.5 text-sm font-normal text-foreground"><Repeat className="size-3.5" /> Frequent buyers</span>
                  {frequentEnabled && (
                    <div className="flex items-center gap-2 mt-2 text-sm">
                      <span className="text-muted-foreground">at least</span>
                      <Input type="number" min={1} value={minOrders} onChange={(e) => setMinOrders(Math.max(1, Number(e.target.value) || 1))} className="w-16 h-8 text-xs" onClick={(e) => e.preventDefault()} />
                      <span className="text-muted-foreground">orders in the last</span>
                      <Input type="number" min={1} value={sinceDays} onChange={(e) => setSinceDays(Math.max(1, Number(e.target.value) || 1))} className="w-16 h-8 text-xs" onClick={(e) => e.preventDefault()} />
                      <span className="text-muted-foreground">days</span>
                    </div>
                  )}
                </div>
              </label>

              <label className="flex items-start gap-3 cursor-pointer select-none">
                <input type="checkbox" checked={inactiveEnabled} onChange={(e) => setInactiveEnabled(e.target.checked)} className="mt-1 size-4 rounded border-input text-primary accent-primary cursor-pointer" />
                <div className="flex-1">
                  <span className="flex items-center gap-1.5 text-sm font-normal text-foreground"><Clock className="size-3.5" /> Inactive customers</span>
                  {inactiveEnabled && (
                    <div className="flex items-center gap-2 mt-2 text-sm">
                      <span className="text-muted-foreground">no order in the last</span>
                      <Input type="number" min={1} value={inactiveSinceDays} onChange={(e) => setInactiveSinceDays(Math.max(1, Number(e.target.value) || 1))} className="w-16 h-8 text-xs" onClick={(e) => e.preventDefault()} />
                      <span className="text-muted-foreground">days (includes customers who've never ordered)</span>
                    </div>
                  )}
                </div>
              </label>

              <p className="text-xs text-muted-foreground">Filters combine — e.g. a depot plus "frequent buyers" targets frequent buyers at that depot. Opted-out and inactive/suspended customers are never included.</p>
            </div>
          ) : audienceMode === 'contacts' ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label className="mb-1.5 flex items-center gap-1.5 text-xs uppercase text-muted-foreground">
                    <Users className="size-3.5" /> Who
                  </Label>
                  <Select value={contactStage || 'all'} onValueChange={(v) => setContactStage(v === 'all' ? '' : (v as 'lead' | 'contact'))}>
                    <SelectTrigger className="w-full text-sm h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="lead">Leads only</SelectItem>
                      <SelectItem value="contact">Other contacts only</SelectItem>
                      <SelectItem value="all">Everyone on the contacts list</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {contactTags.length > 0 && (
                  <div>
                    <Label className="mb-1.5 flex items-center gap-1.5 text-xs uppercase text-muted-foreground">
                      <Tag className="size-3.5" /> Tag
                    </Label>
                    <Select value={contactTag || 'any'} onValueChange={(v) => setContactTag(v === 'any' ? '' : v)}>
                      <SelectTrigger className="w-full text-sm h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="any">Any tag</SelectItem>
                        {contactTags.map((t) => (<SelectItem key={t} value={t}>{t}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              <label className="flex items-start gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={excludeConverted}
                  onChange={(e) => setExcludeConverted(e.target.checked)}
                  className="mt-1 size-4 rounded border-input text-primary accent-primary cursor-pointer"
                />
                <div className="flex-1">
                  <span className="flex items-center gap-1.5 text-sm font-normal text-foreground">
                    <CheckCircle2 className="size-3.5" /> Skip anyone who is already a customer
                  </span>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    A lead who has since signed up would otherwise be messaged twice — once here
                    and once as a customer.
                  </p>
                </div>
              </label>

              <p className="text-xs text-muted-foreground">
                Contacts have no account, so they are reached on the phone number and email
                held for them. Anyone who has opted out of messages is never included.
              </p>
            </div>
          ) : (
            <MultiSelectPicker
              icon={Users}
              title="Customers"
              description="Search by name, phone, email or company"
              items={specificOptions}
              selectedIds={selectedCustomerIds}
              searchTerm={specificSearch}
              onSearchChange={setSpecificSearch}
              onToggle={(id) => setSelectedCustomerIds((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]))}
              onSelectAll={() => setSelectedCustomerIds((prev) => Array.from(new Set([...prev, ...specificOptions.map((o) => o.id)])))}
              onClear={() => setSelectedCustomerIds([])}
              isLoading={specificLoading}
              emptyMessage={specificSearch ? 'No customers match your search.' : 'Search for customers to add them.'}
            />
          )}
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardHeader className="border-b border-border/40 pb-3">
          <div className="flex items-center gap-2">
            <Megaphone className="size-4 text-primary" />
            <div>
              <CardTitle className="text-base font-semibold">Message</CardTitle>
              <CardDescription className="text-xs mt-0.5">Channels and content</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-4 space-y-4">
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5 text-xs uppercase text-muted-foreground"><Sparkles className="size-3.5" /> Quick start</Label>
            <div className="flex flex-wrap gap-2">
              {STARTER_TEMPLATES.map((t) => (
                <Button key={t.name} type="button" variant="outline" size="sm" onClick={() => loadIntoComposer(t)} className="h-8 text-xs">
                  {t.name}
                </Button>
              ))}
            </div>
          </div>

          {(savedTemplates.length > 0 || templatesLoading) && (
            <div className="space-y-2">
              <Label className="text-xs uppercase text-muted-foreground">Your saved templates</Label>
              <div className="flex flex-wrap items-center gap-2">
                {templatesLoading ? (
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                ) : (
                  savedTemplates.map((t) => (
                    <Badge key={t.id} variant="secondary" className="text-xs font-normal py-1.5 pl-2.5 pr-1.5 flex items-center gap-1.5 cursor-pointer hover:bg-secondary/80" onClick={() => loadIntoComposer(t)}>
                      {t.name}
                      <button type="button" onClick={(e) => { e.stopPropagation(); setDeleteTarget(t) }} className="hover:text-destructive rounded-full p-0.5">
                        <Trash2 className="size-3" />
                      </button>
                    </Badge>
                  ))
                )}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={emailOn} onChange={(e) => setEmailOn(e.target.checked)} className="size-4 rounded border-input text-primary accent-primary cursor-pointer" />
              <span className="flex items-center gap-1.5 text-sm"><Mail className="size-4 text-muted-foreground" /> Email</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={smsOn} onChange={(e) => setSmsOn(e.target.checked)} className="size-4 rounded border-input text-primary accent-primary cursor-pointer" />
              <span className="flex items-center gap-1.5 text-sm"><SmsIcon className="size-4 text-muted-foreground" /> SMS</span>
            </label>
          </div>

          {emailOn && (
            <div>
              <Label className="mb-1.5 block text-xs">Subject (email only)</Label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. New PMS price at Calabar Depot" maxLength={200} />
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <Label className="text-xs">Message</Label>
              <div className="flex items-center gap-2">
                {depots.length > 0 && (
                  <Select value={priceDepotId ? String(priceDepotId) : (depotId ? String(depotId) : 'any')} onValueChange={(v) => setPriceDepotId(v === 'any' ? undefined : Number(v))}>
                    <SelectTrigger className="w-[180px] h-8 text-xs">
                      <SelectValue placeholder="All depots" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">All depots</SelectItem>
                      {depots.map((d) => (<SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>))}
                    </SelectContent>
                  </Select>
                )}
                <Button type="button" variant="outline" size="sm" onClick={insertPrices} disabled={insertingPrices} className="h-8 text-xs">
                  {insertingPrices ? <Loader2 className="size-3.5 animate-spin mr-1.5" /> : <Tag className="size-3.5 mr-1.5" />}
                  Insert current prices
                </Button>
              </div>
            </div>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write your message..." className="min-h-40" maxLength={2000} />
            <p className="text-xs text-muted-foreground mt-1">{body.length}/2000. The same message is sent to every recipient — there's no per-customer personalization yet.</p>
          </div>

          <div className="flex justify-between">
            <Button type="button" variant="ghost" size="sm" onClick={() => setSaveTemplateOpen(true)} disabled={!body.trim()} className="text-xs">
              <BookmarkPlus className="size-3.5 mr-1.5" /> Save as Template
            </Button>
            <Button type="button" onClick={openConfirm} disabled={broadcast.isPending} className="min-w-[160px]">
              {broadcast.isPending ? <Loader2 className="size-4 animate-spin mr-2" /> : <Send className="size-4 mr-2" />}
              Send
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardHeader className="border-b border-border/40 pb-3 flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <History className="size-4 text-primary" />
            <div>
              <CardTitle className="text-base font-semibold">Delivery Log</CardTitle>
              <CardDescription className="text-xs mt-0.5">Recent broadcast attempts</CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Select value={logChannel} onValueChange={setLogChannel}>
              <SelectTrigger className="w-[110px] h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All channels</SelectItem>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="sms">SMS</SelectItem>
              </SelectContent>
            </Select>
            <Select value={logStatus} onValueChange={setLogStatus}>
              <SelectTrigger className="w-[110px] h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="sent">Sent</SelectItem>
                <SelectItem value="delivered">Delivered</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="skipped">Skipped</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {deliveriesLoading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="size-5 animate-spin text-primary" /></div>
          ) : (deliveryData?.data || []).length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">No broadcasts sent yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase">
                    <th className="px-4 py-2 font-normal">Sent</th>
                    <th className="px-4 py-2 font-normal">Channel</th>
                    <th className="px-4 py-2 font-normal">Destination</th>
                    <th className="px-4 py-2 font-normal">Status</th>
                    <th className="px-4 py-2 font-normal">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {(deliveryData?.data || []).map((row) => (
                    <tr key={row.id} className="border-b border-border/50 last:border-0">
                      <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{formatDate(row.sentAt || row.createdAt)}</td>
                      <td className="px-4 py-2.5 text-xs capitalize">{row.channel}</td>
                      <td className="px-4 py-2.5 text-xs font-mono">{row.destination || '—'}</td>
                      <td className="px-4 py-2.5"><StatusBadge status={row.status} /></td>
                      <td className="px-4 py-2.5 text-xs text-destructive truncate max-w-[240px]">{row.error || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send this message?</DialogTitle>
            <DialogDescription>
              This will go to <strong>{recipientCount} recipient{recipientCount === 1 ? '' : 's'}</strong> by{' '}
              {channels.map((c) => (c === 'email' ? 'Email' : 'SMS')).join(' and ')}.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-sm whitespace-pre-wrap max-h-48 overflow-y-auto">
            {body}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button type="button" onClick={handleSend} disabled={broadcast.isPending}>
              {broadcast.isPending ? <Loader2 className="size-4 animate-spin mr-2" /> : <Send className="size-4 mr-2" />}
              Send to {recipientCount}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={saveTemplateOpen} onOpenChange={setSaveTemplateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save as Template</DialogTitle>
            <DialogDescription>Saves the current subject and message so anyone composing here can reload it later.</DialogDescription>
          </DialogHeader>
          <div>
            <Label className="mb-1.5 block text-xs">Template name</Label>
            <Input value={newTemplateName} onChange={(e) => setNewTemplateName(e.target.value)} placeholder="e.g. Monthly price update" maxLength={150} autoFocus />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSaveTemplateOpen(false)}>Cancel</Button>
            <Button type="button" onClick={handleSaveTemplate} disabled={createTemplate.isPending}>
              {createTemplate.isPending ? <Loader2 className="size-4 animate-spin mr-2" /> : <BookmarkPlus className="size-4 mr-2" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}
        title="Delete this template?"
        description={`"${deleteTarget?.name}" will be permanently removed.`}
        confirmLabel="Delete"
        variant="destructive"
        loading={deleteTemplate.isPending}
        onConfirm={async () => {
          if (deleteTarget) await deleteTemplate.mutateAsync(deleteTarget.id)
          setDeleteTarget(null)
        }}
      />
    </div>
  )
}
