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
  BookUser, Braces, Eye,
} from 'lucide-react'
import { useDepots } from '#/lib/hooks/useDepots'
import { useCustomerList } from '#/lib/hooks/useCustomers'
import { useContactList, useContactTags } from '#/lib/hooks/useContacts'
import {
  useCustomerSegment, useBroadcast, useNotificationDeliveries,
  useMessageTemplates, useCreateMessageTemplate, useDeleteMessageTemplate,
  usePriceList, useRenderedPreview,
  type SegmentFilters, type MessageTemplate,
} from '#/lib/hooks/useMessaging'
import { useToast } from '#/lib/hooks/useToast'
import { routeGuard } from '#/lib/route-guard'

export const Route = createFileRoute('/messaging/')({
  beforeLoad: () => routeGuard('/messaging'),
  component: MessagingPage,
})

const SIGN_OFF = 'Order now: ordersoroman.com\nFor Enquiries: 08144915865'

/**
 * Ready-made starting points for the scenarios most asked for — not stored
 * server-side, just fills the composer. "Save as Template" turns any edited
 * (or from-scratch) message into a real, shared, saved template from there.
 *
 * The price update carries {{shortcodes}} rather than the prices themselves.
 * That is the difference between a template and a snapshot: the shortcodes are
 * resolved when the message is SENT, so this template is still correct in
 * three months, while pasted-in prices would quietly go stale and go out wrong.
 */
const STARTER_TEMPLATES: Array<{
  name: string; subject: string; body: string
  channels: Array<'email' | 'sms'>
  /** The audience this message is written for, preselected when loaded. */
  audience?: string
}> = [
  {
    name: 'Daily price update',
    subject: 'SOROMAN prices for today',
    body: `{{greeting}} Customer\nPlease be advised of SOROMAN price for today.\n\n{{prices}}\n\n${SIGN_OFF}`,
    channels: ['sms'],
    audience: 'everyone',
  },
  {
    name: 'Frequent buyer thank-you',
    subject: 'Thank you for your continued business',
    body: `{{greeting}}\n\nThank you for being one of our regular customers — we genuinely appreciate your continued business with Soroman.\n\nToday's prices:\n\n{{prices}}\n\n${SIGN_OFF}`,
    channels: ['email', 'sms'],
    audience: 'frequent',
  },
  {
    name: 'Inactive customer win-back',
    subject: "We've missed you",
    body: `{{greeting}}\n\nIt has been a while since your last order with us, and we would love to have you back.\n\nHere is where our prices stand today:\n\n{{prices}}\n\n${SIGN_OFF}`,
    channels: ['email', 'sms'],
    audience: 'inactive',
  },
  {
    name: 'Follow-up',
    subject: 'Following up on your enquiry',
    body: `{{greeting}}\n\nJust following up on your enquiry with Soroman. Our prices as at {{date}}:\n\n{{prices}}\n\nLet us know the product, quantity and location you need and we will get it moving.\n\n${SIGN_OFF}`,
    channels: ['email', 'sms'],
    audience: 'leads',
  },
  {
    name: 'New lead introduction',
    subject: 'Soroman — fuel supply across Nigeria',
    body: `{{greeting}}\n\nThank you for your interest in Soroman. We supply PMS, AGO and LPG across our depot network, with pricing updated daily.\n\n{{prices}}\n\n${SIGN_OFF}`,
    channels: ['email', 'sms'],
    audience: 'leads',
  },
]

type AudienceMode = 'segment' | 'specific' | 'contacts' | 'everyone'

/**
 * The audiences the desk actually sends to, named.
 *
 * This page used to ask three separate questions — pick one of three modes,
 * then tick "frequent buyers", then type a number of orders and a number of
 * days — to arrive at "frequent customers". Three controls to express one
 * intent, and the intent was never written down anywhere, so the same audience
 * was rebuilt by hand every time and two people could easily mean different
 * things by it.
 *
 * Naming them makes the choice one click and makes the definition explicit and
 * shared. The knobs are still there for the two presets where the threshold is
 * genuinely a judgement call — how many orders counts as frequent, how long
 * counts as gone — they just start somewhere sensible.
 */
type AudiencePreset = {
  id: string
  label: string
  /** What the preset means, in the words someone would use to ask for it. */
  description: string
  icon: React.ComponentType<{ className?: string }>
  mode: AudienceMode
  contactStage?: '' | 'lead' | 'contact'
  /** Which extra control to reveal, when the threshold is a real decision. */
  tune?: 'frequent' | 'inactive'
}

const AUDIENCE_PRESETS: AudiencePreset[] = [
  {
    id: 'everyone',
    label: 'Everyone',
    description: 'Every customer and everyone on the contacts list — the widest reach.',
    icon: Megaphone,
    mode: 'everyone',
  },
  {
    id: 'all-customers',
    label: 'Customers only',
    description: 'Everyone with an account, whether or not they have ordered.',
    icon: Users,
    mode: 'segment',
  },
  {
    id: 'frequent',
    label: 'Frequent customers',
    description: 'Customers who order regularly. You set what regularly means.',
    icon: Repeat,
    mode: 'segment',
    tune: 'frequent',
  },
  {
    id: 'inactive',
    label: 'Inactive customers',
    description: 'Gone quiet, plus anyone who signed up and never ordered.',
    icon: Clock,
    mode: 'segment',
    tune: 'inactive',
  },
  {
    id: 'leads',
    label: 'Leads only',
    description: 'People on the contacts list marked as leads. No account yet.',
    icon: Sparkles,
    mode: 'contacts',
    contactStage: 'lead',
  },
  {
    id: 'contacts',
    label: 'Other contacts only',
    description: 'Contacts who are not leads — partners, suppliers, everyone else.',
    icon: BookUser,
    mode: 'contacts',
    contactStage: 'contact',
  },
  {
    id: 'all-contacts',
    label: 'All contacts',
    description: 'The whole contacts list, leads included. Excludes customers.',
    icon: BookUser,
    mode: 'contacts',
    contactStage: '',
  },
  {
    id: 'specific',
    label: 'Pick specific customers',
    description: 'Search and choose them one by one.',
    icon: Users,
    mode: 'specific',
  },
]

const PRESET_BY_ID = new Map(AUDIENCE_PRESETS.map((p) => [p.id, p]))

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
  const [presetId, setPresetId] = useState('everyone')
  const preset = PRESET_BY_ID.get(presetId) ?? AUDIENCE_PRESETS[0]
  const audienceMode = preset.mode

  const [depotId, setDepotId] = useState<number | undefined>(undefined)
  const [minOrders, setMinOrders] = useState(3)
  const [sinceDays, setSinceDays] = useState(90)
  const [inactiveSinceDays, setInactiveSinceDays] = useState(60)

  // The preset decides WHICH filters apply; the knobs decide the thresholds.
  // Keeping them apart is what stops "inactive customers" silently carrying a
  // frequent-buyer filter left over from the last message someone composed.
  const segmentFilters: SegmentFilters = useMemo(() => ({
    depotId,
    minOrders: preset.tune === 'frequent' ? minOrders : undefined,
    sinceDays: preset.tune === 'frequent' ? sinceDays : undefined,
    inactiveSinceDays: preset.tune === 'inactive' ? inactiveSinceDays : undefined,
  }), [depotId, preset.tune, minOrders, sinceDays, inactiveSinceDays])

  // "Everyone" needs the customer half as well as the contact half, so the
  // segment query runs for it too.
  const wantsCustomers = audienceMode === 'segment' || audienceMode === 'everyone'
  const { data: segmentData, isFetching: segmentLoading } = useCustomerSegment(segmentFilters, { enabled: wantsCustomers })

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
  const contactStage = preset.contactStage ?? ''
  const [contactTag, setContactTag] = useState('')
  const [excludeConverted, setExcludeConverted] = useState(true)
  const { data: contactTags = [] } = useContactTags()

  const wantsContacts = audienceMode === 'contacts' || audienceMode === 'everyone'
  const { data: contactData, isFetching: contactsLoading } = useContactList(
    wantsContacts
      ? { stage: contactStage, tag: contactTag, optedOut: 'no', converted: excludeConverted ? 'no' : '', limit: 5000 }
      : { limit: 1 },
  )
  const contactRecipients = useMemo(
    () => (wantsContacts ? (contactData?.contacts ?? []) : []),
    [wantsContacts, contactData],
  )

  const customerRecipientIds = useMemo(
    () => (audienceMode === 'specific' ? selectedCustomerIds : wantsCustomers ? (segmentData?.customers.map((c) => c.id) ?? []) : []),
    [audienceMode, selectedCustomerIds, wantsCustomers, segmentData],
  )

  const recipientCount = customerRecipientIds.length + contactRecipients.length

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

  // ── Prices ──────────────────────────────────────────────────────────────
  //
  // Which depots get quoted. Empty means every quotable one; the picker below
  // starts that way and the sender unticks what they do not want in the SMS.
  // This is also what decides whether a location can be labelled by its city —
  // leave two Port Harcourt depots ticked and both are named in full, because
  // one "Port Harcourt" line cannot carry two different prices.
  const [quotedDepotIds, setQuotedDepotIds] = useState<number[]>([])
  const { data: priceList, isFetching: pricesLoading } = usePriceList(quotedDepotIds)

  const allQuotableIds = useMemo(() => (priceList?.depots ?? []).map((d) => d.id), [priceList])
  const effectiveDepotIds = quotedDepotIds.length > 0 ? quotedDepotIds : allQuotableIds

  const toggleQuotedDepot = (id: number) => {
    setQuotedDepotIds((prev) => {
      const current = prev.length > 0 ? prev : allQuotableIds
      return current.includes(id) ? current.filter((v) => v !== id) : [...current, id]
    })
  }

  /**
   * Drop a shortcode in rather than the prices themselves.
   *
   * Pasting today's numbers into the body makes a message that is correct once.
   * The shortcode is resolved at send time, so the same body is still right
   * tomorrow — which is what makes it worth saving as a template at all.
   */
  const insertShortcode = (token: string) => {
    setBody((prev) => (prev.trim() ? prev.trimEnd() + '\n\n' : '') + `{{${token}}}`)
  }

  /** For anyone who would rather see the numbers in the box than a token. */
  const insertResolvedPrices = () => {
    if (!priceList?.text) { toast.error('No quotable prices right now'); return }
    setBody((prev) => (prev.trim() ? prev.trimEnd() + '\n\n' : '') + priceList.text)
  }

  const bodyHasShortcodes = body.includes('{{')
  const { data: renderedBody } = useRenderedPreview(body, effectiveDepotIds, true)
  /** What actually goes out: the resolved text when shortcodes are present. */
  const outgoingBody = bodyHasShortcodes ? (renderedBody ?? body) : body

  // SMS is billed per 160-character segment (70 if any non-GSM character
  // sneaks in), and a price blast to a few thousand people makes each extra
  // segment real money. Counted on the RESOLVED text — the shortcode is four
  // characters and the block it becomes is a few hundred.
  const smsSegments = Math.max(1, Math.ceil(outgoingBody.length / 160))

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
      // Sent with shortcodes intact so the server resolves them at send time —
      // see the note on insertShortcode. depotIds travels with it so the block
      // quotes the depots that were ticked here.
      body: body.trim(),
      channels,
      depotIds: bodyHasShortcodes ? effectiveDepotIds : undefined,
    }

    // "Everyone" is two audiences, and the broadcast endpoint takes one at a
    // time — customers are addressed by id, contacts by their details, and the
    // engine resolves them differently. Two calls rather than one, which the
    // recipient total above already reflects.
    if (customerRecipientIds.length > 0) {
      await broadcast.mutateAsync({ ...common, audience: 'customers' as const, customerIds: customerRecipientIds })
    }
    if (contactRecipients.length > 0) {
      await broadcast.mutateAsync({
        ...common,
        audience: 'contacts' as const,
        contacts: contactRecipients.map((c) => ({ name: c.name, email: c.email, phone: c.phone })),
      })
    }

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
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[16rem] flex-1">
              <Label className="mb-1.5 flex items-center gap-1.5 text-xs uppercase text-muted-foreground">
                <Users className="size-3.5" /> Send to
              </Label>
              <Select value={presetId} onValueChange={setPresetId}>
                <SelectTrigger className="w-full text-sm h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {AUDIENCE_PRESETS.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Badge variant="secondary" className="text-xs px-3 py-1.5 font-semibold h-9 flex items-center">
              {segmentLoading || specificLoading || contactsLoading ? <Loader2 className="size-3 animate-spin mr-1.5" /> : null}
              {recipientCount.toLocaleString()} recipient{recipientCount === 1 ? '' : 's'}
            </Badge>
          </div>

          <p className="flex items-start gap-1.5 text-xs text-muted-foreground -mt-1">
            <preset.icon className="mt-0.5 size-3.5 shrink-0" />
            {preset.description}
          </p>

          {/* "Everyone" is the only preset that spans both halves, and the split
              is worth showing: the two are reached differently and a contact
              with no phone number simply cannot get an SMS. */}
          {audienceMode === 'everyone' && (
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="outline" className="font-normal">
                {customerRecipientIds.length.toLocaleString()} customer{customerRecipientIds.length === 1 ? '' : 's'}
              </Badge>
              <Badge variant="outline" className="font-normal">
                {contactRecipients.length.toLocaleString()} contact{contactRecipients.length === 1 ? '' : 's'}
              </Badge>
            </div>
          )}

          {preset.tune === 'frequent' && (
            <div className="flex flex-wrap items-center gap-2 text-sm rounded-lg border border-border/60 bg-muted/30 p-3">
              <Repeat className="size-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">Counts as frequent: at least</span>
              <Input type="number" min={1} value={minOrders} onChange={(e) => setMinOrders(Math.max(1, Number(e.target.value) || 1))} className="w-16 h-8 text-xs" />
              <span className="text-muted-foreground">orders in the last</span>
              <Input type="number" min={1} value={sinceDays} onChange={(e) => setSinceDays(Math.max(1, Number(e.target.value) || 1))} className="w-16 h-8 text-xs" />
              <span className="text-muted-foreground">days</span>
            </div>
          )}

          {preset.tune === 'inactive' && (
            <div className="flex flex-wrap items-center gap-2 text-sm rounded-lg border border-border/60 bg-muted/30 p-3">
              <Clock className="size-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">Counts as inactive: no order in the last</span>
              <Input type="number" min={1} value={inactiveSinceDays} onChange={(e) => setInactiveSinceDays(Math.max(1, Number(e.target.value) || 1))} className="w-16 h-8 text-xs" />
              <span className="text-muted-foreground">days — includes anyone who never ordered</span>
            </div>
          )}

          {audienceMode === 'segment' || audienceMode === 'everyone' ? (
            <div className="space-y-3">
              <div>
                <Label className="mb-1.5 flex items-center gap-1.5 text-xs uppercase text-muted-foreground"><Warehouse className="size-3.5" /> Narrow to a location</Label>
                <Select value={depotId ? String(depotId) : 'any'} onValueChange={(v) => setDepotId(v === 'any' ? undefined : Number(v))}>
                  <SelectTrigger className="w-full sm:w-[280px] text-sm h-9">
                    <SelectValue placeholder="Any depot" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any depot</SelectItem>
                    {depots.map((d) => (<SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">Only customers who have ordered from this depot. Optional.</p>
              </div>
              <p className="text-xs text-muted-foreground">Opted-out and suspended customers are never included.</p>
            </div>
          ) : null}

          {audienceMode === 'contacts' || audienceMode === 'everyone' ? (
            <div className="space-y-3">
              {contactTags.length > 0 && (
                <div>
                  <Label className="mb-1.5 flex items-center gap-1.5 text-xs uppercase text-muted-foreground">
                    <Tag className="size-3.5" /> Narrow contacts to a tag
                  </Label>
                  <Select value={contactTag || 'any'} onValueChange={(v) => setContactTag(v === 'any' ? '' : v)}>
                    <SelectTrigger className="w-full sm:w-[280px] text-sm h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">Any tag</SelectItem>
                      {contactTags.map((t) => (<SelectItem key={t} value={t}>{t}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <label className="flex items-start gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={excludeConverted}
                  onChange={(e) => setExcludeConverted(e.target.checked)}
                  className="mt-1 size-4 rounded border-input text-primary accent-primary cursor-pointer"
                />
                <div className="flex-1">
                  <span className="flex items-center gap-1.5 text-sm font-normal text-foreground">
                    <CheckCircle2 className="size-3.5" /> Skip contacts who are already customers
                  </span>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    A lead who has since signed up would otherwise be messaged twice — once as a
                    contact and once as a customer.
                  </p>
                </div>
              </label>

              <p className="text-xs text-muted-foreground">
                Contacts have no account, so they are reached on the phone number and email held
                for them. Anyone who has opted out is never included.
              </p>
            </div>
          ) : null}

          {audienceMode === 'specific' ? (
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
          ) : null}
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
                <Button
                  key={t.name} type="button" variant="outline" size="sm" className="h-8 text-xs"
                  onClick={() => {
                    loadIntoComposer(t)
                    // Each of these is written for a particular audience, so
                    // loading one sets it. A win-back sent to everyone is not
                    // a win-back.
                    if (t.audience && PRESET_BY_ID.has(t.audience)) setPresetId(t.audience)
                  }}
                >
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

          {/* ── Shortcodes ────────────────────────────────────────────────
              A shortcode is inserted rather than the prices themselves, so the
              message is resolved when it SENDS. That is what lets the same
              saved template go out every morning carrying that morning's
              prices instead of the ones that were current when it was written. */}
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5 text-xs uppercase text-muted-foreground">
              <Braces className="size-3.5" /> Shortcodes
            </Label>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => insertShortcode('prices')} className="h-8 text-xs font-mono">
                {'{{prices}}'}
              </Button>
              {(priceList?.groups ?? []).map((g) => (
                <Button key={g.code} type="button" variant="outline" size="sm" onClick={() => insertShortcode(`prices:${g.code}`)} className="h-8 text-xs font-mono">
                  {`{{prices:${g.code}}}`}
                </Button>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={() => insertShortcode('greeting')} className="h-8 text-xs font-mono">
                {'{{greeting}}'}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => insertShortcode('date')} className="h-8 text-xs font-mono">
                {'{{date}}'}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={insertResolvedPrices} disabled={pricesLoading} className="h-8 text-xs">
                {pricesLoading ? <Loader2 className="size-3.5 animate-spin mr-1.5" /> : <Tag className="size-3.5 mr-1.5" />}
                Paste prices as plain text
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              <span className="font-mono">{'{{prices}}'}</span> fills in when the message sends, so a saved
              template always carries the current price. <span className="font-mono">{'{{greeting}}'}</span> becomes
              Good Morning / Afternoon / Evening depending on when it lands.
            </p>
          </div>

          {/* ── Which depots get quoted ───────────────────────────────────── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label className="flex items-center gap-1.5 text-xs uppercase text-muted-foreground">
                <Warehouse className="size-3.5" /> Locations quoted in the price block
              </Label>
              {quotedDepotIds.length > 0 && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setQuotedDepotIds([])} className="h-7 text-xs">
                  Reset to all
                </Button>
              )}
            </div>
            {pricesLoading && !priceList ? (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            ) : (priceList?.depots ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">No depot currently has a price and stock to quote.</p>
            ) : (
              <div className="grid gap-1.5 sm:grid-cols-2">
                {(priceList?.depots ?? []).map((d) => {
                  const on = effectiveDepotIds.includes(d.id)
                  return (
                    <label key={d.id} className="flex items-start gap-2.5 cursor-pointer select-none rounded-lg border border-border/60 p-2.5 hover:bg-muted/40">
                      <input
                        type="checkbox" checked={on} onChange={() => toggleQuotedDepot(d.id)}
                        className="mt-0.5 size-4 rounded border-input text-primary accent-primary cursor-pointer"
                      />
                      <div className="min-w-0 flex-1">
                        <span className="block text-sm font-normal text-foreground truncate">{d.name}</span>
                        <span className="block text-xs text-muted-foreground truncate">
                          {d.products.map((p) => `${p.code} N${Math.round(p.price).toLocaleString()}/${p.unitSuffix}`).join(' · ')}
                        </span>
                      </div>
                    </label>
                  )
                })}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Only active depots holding stock at a set price can be quoted. A location is written
              by its city where that is unambiguous — leave two depots in the same city ticked and
              both are named in full, since one line cannot carry two prices.
            </p>
          </div>

          <div>
            <Label className="text-xs mb-1.5 block">Message</Label>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write your message..." className="min-h-40 font-mono text-sm" maxLength={2000} />
            <div className="flex flex-wrap items-center justify-between gap-2 mt-1">
              <p className="text-xs text-muted-foreground">
                {body.length}/2000. The same message goes to every recipient — no per-customer personalisation.
              </p>
              {smsOn && (
                <p className="text-xs text-muted-foreground">
                  {outgoingBody.length} chars sent ·{' '}
                  <span className={smsSegments > 3 ? 'text-warning font-semibold' : 'font-semibold'}>
                    {smsSegments} SMS segment{smsSegments === 1 ? '' : 's'}
                  </span>
                  {recipientCount > 0 && <> × {recipientCount.toLocaleString()} recipients</>}
                </p>
              )}
            </div>
          </div>

          {/* The resolved text, whenever the body still holds a shortcode. The
              box above shows what was typed; this shows what will actually be
              received, which is the thing worth checking before sending. */}
          {bodyHasShortcodes && (
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-xs uppercase text-muted-foreground">
                <Eye className="size-3.5" /> What recipients will see
              </Label>
              <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-sm whitespace-pre-wrap">
                {renderedBody ?? <Loader2 className="size-4 animate-spin text-muted-foreground" />}
              </div>
            </div>
          )}

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
          {/* The resolved text, not the raw body — nobody should be asked to
              approve "{{prices}}" and find out afterwards what it stood for. */}
          <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-sm whitespace-pre-wrap max-h-48 overflow-y-auto">
            {outgoingBody}
          </div>
          {smsOn && (
            <p className="text-xs text-muted-foreground">
              {smsSegments} SMS segment{smsSegments === 1 ? '' : 's'} per recipient.
            </p>
          )}
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
