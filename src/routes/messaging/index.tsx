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
import { DeliveryRollupRow, ReasonChip } from '#/components/DeliveryRollupRow'
import {
  Users, Warehouse, Repeat, Clock, Mail, MessageSquare as SmsIcon, Send, Loader2,
  Tag, CheckCircle2, XCircle, AlertCircle, History, Megaphone, BookmarkPlus, Trash2, Sparkles,
  BookUser, Braces, Eye, Wallet as WalletIcon, Search, X, CalendarDays, Layers,
} from 'lucide-react'
import { cn } from '#/lib/utils'
import { formatMoneyIn } from '#/lib/format'
import { useDepots } from '#/lib/hooks/useDepots'
import { useCustomerList } from '#/lib/hooks/useCustomers'
import { useContactList, useContactTags } from '#/lib/hooks/useContacts'
import {
  useCustomerSegment, useBroadcast, useNotificationDeliveries, useDeliverySummary,
  useMessageTemplates, useCreateMessageTemplate, useDeleteMessageTemplate,
  usePriceList, useRenderedPreview, useSmsBalance, useCampaigns,
  type SegmentFilters, type MessageTemplate, type Campaign,
} from '#/lib/hooks/useMessaging'
import { Pagination } from '#/components/Pagination'
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

/**
 * `delivered` and `sent` used to share a badge, which was fine when nothing
 * ever wrote `delivered` — the provider's acceptance was the only fact we had.
 * Now that carrier receipts come back, the two are genuinely different: one
 * means a handset received it, the other means Termii took it and we have not
 * heard since. Conflating them would hide every message that quietly never
 * arrived.
 */
function StatusBadge({ status }: { status: string }) {
  if (status === 'delivered') {
    return <Badge variant="outline" className="bg-success/10 text-success border-success/20 flex items-center gap-1 w-fit font-normal"><CheckCircle2 className="size-3" />Delivered</Badge>
  }
  if (status === 'sent') {
    return (
      <Badge
        variant="outline"
        className="flex items-center gap-1 w-fit font-normal text-muted-foreground"
        title="Accepted by the provider. No delivery receipt has come back for it."
      >
        <Send className="size-3" />Sent
      </Badge>
    )
  }
  if (status === 'failed') {
    return <Badge variant="destructive" className="flex items-center gap-1 w-fit font-normal"><XCircle className="size-3" />Failed</Badge>
  }
  if (status === 'skipped' || status === 'suppressed') {
    return <Badge variant="outline" className="text-muted-foreground flex items-center gap-1 w-fit font-normal capitalize"><AlertCircle className="size-3" />{status}</Badge>
  }
  return <Badge variant="outline" className="w-fit font-normal capitalize">{status}</Badge>
}

const money = formatMoneyIn

/**
 * What is left in the SMS wallet, said quietly.
 *
 * 346 sends on the live book failed with "Insufficient balance" while this
 * page showed nothing at all — the desk found out from customers who never got
 * their prices. It sits in the header rather than in a banner because on a
 * normal day it is a number you glance at, not one you act on; it only raises
 * its voice when the wallet is low enough to threaten the next blast.
 */
function SmsWallet() {
  const { data, isLoading } = useSmsBalance()

  if (isLoading) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />SMS balance
      </span>
    )
  }
  if (!data?.ok) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground" title={data?.error || ''}>
        <WalletIcon className="size-3.5" />SMS balance unavailable
      </span>
    )
  }

  // A wallet this thin will not carry a price blast to the whole book, and
  // that is worth colouring. The threshold is deliberately crude — the point
  // is "top up before you send", not a precise forecast.
  const low = data.balance !== null && data.balance < 5000

  return (
    <span
      className={cn(
        'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs',
        low ? 'border-warning/30 bg-warning/10 text-warning' : 'border-border text-muted-foreground',
      )}
      title={low ? 'Top up before sending to a large audience' : 'Termii wallet'}
    >
      <WalletIcon className="size-3.5" />
      <span className="font-medium">
        {data.balance === null ? '—' : money(data.balance, data.currency)}
      </span>
      <span className="hidden sm:inline">SMS balance</span>
    </span>
  )
}

function MessagingPage() {
  const toast = useToast()
  const { data: depots = [] } = useDepots()
  const { data: smsBalance } = useSmsBalance()

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

  /**
   * The audience in one sentence, thresholds included.
   *
   * Written here rather than on the server because this is the only place that
   * knows what the knobs were set to, and it is stored on the campaign so a
   * six-month-old blast can still say who it went to.
   */
  const audienceDescription = useMemo(() => {
    if (preset.tune === 'frequent') {
      return `${preset.label} — at least ${minOrders} order${minOrders === 1 ? '' : 's'} in the last ${sinceDays} days`
    }
    if (preset.tune === 'inactive') {
      return `${preset.label} — no order in the last ${inactiveSinceDays} days`
    }
    return preset.label
  }, [preset, minOrders, sinceDays, inactiveSinceDays])

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
      // What "frequent customers" meant on the day, thresholds and all. The
      // preset id alone would leave a campaign nobody can reconstruct once
      // someone has moved the sliders.
      audienceLabel: audienceDescription,
    }

    // "Everyone" is two audiences, and the broadcast endpoint takes one at a
    // time — customers are addressed by id, contacts by their details, and the
    // engine resolves them differently. Two calls rather than one, which the
    // recipient total above already reflects.
    //
    // The first call opens the campaign; the second is told which one to join,
    // so one press of Send is one entry in the history rather than two.
    let campaignId: number | undefined
    if (customerRecipientIds.length > 0) {
      const result = await broadcast.mutateAsync({
        ...common, audience: 'customers' as const, customerIds: customerRecipientIds,
      })
      campaignId = result.campaignId ?? undefined
    }
    if (contactRecipients.length > 0) {
      await broadcast.mutateAsync({
        ...common,
        campaignId,
        audience: 'contacts' as const,
        contacts: contactRecipients.map((c) => ({ name: c.name, email: c.email, phone: c.phone })),
      })
    }

    setConfirmOpen(false)
    setSubject('')
    setBody('')
  }

  // ── History ─────────────────────────────────────────────────────────────
  //
  // Two views of the same thing, and the order matters. The campaign list
  // answers "what did we send?" — the question actually asked — and the
  // delivery log answers "did this one person get it?", which is a support
  // question you arrive at from a campaign, not something to open cold.
  const [logChannel, setLogChannel] = useState('all')
  const [logStatus, setLogStatus] = useState('all')
  const [logSearch, setLogSearch] = useState('')
  const [logFrom, setLogFrom] = useState('')
  const [logTo, setLogTo] = useState('')
  const [logPage, setLogPage] = useState(1)
  const [logPageSize, setLogPageSize] = useState(50)
  /** Set by "See recipients" on a campaign; narrows the log to that blast. */
  const [logCampaign, setLogCampaign] = useState<Campaign | null>(null)
  /**
   * How the roll-up above the log is bucketed.
   *
   * Per day is the running record — "what happened on Tuesday" — and per batch
   * is the same numbers cut by broadcast, which is the one that carries a
   * cost, since Termii bills a send and not a date.
   */
  const [logGroupBy, setLogGroupBy] = useState<'day' | 'campaign'>('day')
  /** One classified failure reason, clicked straight off the roll-up. */
  const [logReason, setLogReason] = useState('')
  /**
   * Whether the log covers everything the system sends, or only broadcasts.
   *
   * It used to be hard-wired to broadcasts, silently — `type` was pinned to
   * 'system.announcement' with nothing on screen saying so. That made a log
   * headed "every attempt" quietly omit every order confirmation, ticket
   * message and verification code, which are the sends support actually gets
   * asked about. Everything is the default now, and the choice is visible.
   */
  const [logScope, setLogScope] = useState<'all' | 'broadcast'>('all')

  /**
   * One filter set, read by both the roll-up and the rows beneath it.
   *
   * Shared rather than duplicated on purpose: the summary is a claim ABOUT the
   * list, and the two describing different sets — "412 failed" over a table
   * showing eleven — would make both untrustworthy.
   */
  const logFilters = {
    channel: logChannel === 'all' ? undefined : logChannel,
    status: logStatus === 'all' ? undefined : logStatus,
    reason: logReason || undefined,
    campaignId: logCampaign?.id,
    search: logSearch || undefined,
    from: logFrom || undefined,
    to: logTo || undefined,
    // Narrowed to one campaign, every channel attempt behind it belongs in
    // view — including the transactional types, if any got filed there.
    type: logCampaign || logScope === 'all' ? undefined : 'system.announcement',
  }

  const { data: deliveryData, isLoading: deliveriesLoading, isFetching: deliveriesFetching } =
    useNotificationDeliveries({ ...logFilters, page: logPage, limit: logPageSize })

  const { data: summaryData, isLoading: summaryLoading, isFetching: summaryFetching } =
    useDeliverySummary({ ...logFilters, groupBy: logGroupBy, limit: 60 })

  const logSignature = [logChannel, logStatus, logReason, logScope, logSearch, logFrom, logTo, logCampaign?.id].join('|')
  const [lastLogSignature, setLastLogSignature] = useState(logSignature)
  if (lastLogSignature !== logSignature) { setLastLogSignature(logSignature); setLogPage(1) }

  const [campaignPage, setCampaignPage] = useState(1)
  const { data: campaignData, isLoading: campaignsLoading } = useCampaigns({ page: campaignPage, limit: 10 })
  const campaigns = campaignData?.campaigns ?? []

  const openCampaignRecipients = (c: Campaign) => {
    setLogCampaign(c)
    setLogChannel('all'); setLogStatus('all'); setLogSearch(''); setLogFrom(''); setLogTo('')
    setLogReason(''); setLogScope('all')
    // A single blast has one day in it, so grouping the roll-up by day would
    // be one row saying what the campaign header already says.
    setLogGroupBy('campaign')
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin"
        title="Messaging"
        description="Compose and send SMS/email to customers, targeted by segment."
        actions={<SmsWallet />}
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

      {/* ── What we have sent ──────────────────────────────────────────────
          The question the desk actually asks. Every blast used to dissolve
          into hundreds of loose delivery rows with nothing tying them
          together, so "what went out on Tuesday?" had no answer. */}
      <Card className="border-border/60">
        <CardHeader className="border-b border-border/40 pb-3">
          <div className="flex items-center gap-2">
            <Megaphone className="size-4 text-primary" />
            <div>
              <CardTitle className="text-base font-semibold">Sent messages</CardTitle>
              <CardDescription className="text-xs mt-0.5">
                Every broadcast, who it went to, how it landed and what it cost
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {campaignsLoading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="size-5 animate-spin text-primary" /></div>
          ) : campaigns.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Nothing sent yet. Messages sent from here will be listed with their delivery results.
            </div>
          ) : (
            <>
              <div className="divide-y divide-border/60">
                {campaigns.map((c) => (
                  <div key={c.id} className="p-4 space-y-2.5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-sm">{c.title || 'Untitled message'}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {formatDate(c.createdAt)}
                          {c.sentBy && <> · by {c.sentBy}</>}
                          {c.audienceLabel && <> · {c.audienceLabel}</>}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {c.channels.map((ch) => (
                          <Badge key={ch} variant="outline" className="font-normal text-xs">
                            {ch === 'email' ? <Mail className="size-3 mr-1" /> : <SmsIcon className="size-3 mr-1" />}
                            {ch === 'email' ? 'Email' : 'SMS'}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    <p className="text-xs text-muted-foreground line-clamp-2 whitespace-pre-wrap">{c.body}</p>

                    {/* Outcomes, and only the ones that happened — a row of
                        zeroes for statuses nothing reached is noise. */}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                      <span className="text-muted-foreground">
                        {c.recipientCount.toLocaleString()} recipient{c.recipientCount === 1 ? '' : 's'}
                      </span>
                      {c.deliveries.delivered > 0 && (
                        <span className="flex items-center gap-1 text-success">
                          <CheckCircle2 className="size-3" />{c.deliveries.delivered.toLocaleString()} delivered
                        </span>
                      )}
                      {c.deliveries.sent > 0 && (
                        <span
                          className="flex items-center gap-1 text-muted-foreground"
                          title="Accepted by the provider. A delivery receipt has not come back for these yet."
                        >
                          <Send className="size-3" />{c.deliveries.sent.toLocaleString()} sent
                        </span>
                      )}
                      {c.deliveries.failed > 0 && (
                        <span className="flex items-center gap-1 text-destructive">
                          <XCircle className="size-3" />{c.deliveries.failed.toLocaleString()} failed
                        </span>
                      )}
                      {c.deliveries.skipped > 0 && (
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <AlertCircle className="size-3" />{c.deliveries.skipped.toLocaleString()} skipped
                        </span>
                      )}
                      {/* What Termii's own wallet moved by. Only shown when
                          both readings exist — a missing one means "we could
                          not read it", which is not the same as "free". */}
                      {c.spent !== null && c.spent > 0 && (
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <WalletIcon className="size-3" />{money(c.spent, c.balanceCurrency)} spent
                        </span>
                      )}
                      <Button
                        variant="ghost" size="sm" className="h-6 px-2 text-xs ml-auto"
                        onClick={() => openCampaignRecipients(c)}
                      >
                        See recipients
                      </Button>
                    </div>

                    {c.balanceAfter !== null && (
                      <p className="text-xs text-muted-foreground">
                        SMS balance {money(c.balanceBefore ?? 0, c.balanceCurrency)} → {money(c.balanceAfter, c.balanceCurrency)}
                      </p>
                    )}
                  </div>
                ))}
              </div>
              {(campaignData?.pagination.pages ?? 1) > 1 && (
                <Pagination
                  currentPage={campaignPage}
                  totalPages={campaignData?.pagination.pages ?? 1}
                  pageSize={10}
                  totalItems={campaignData?.pagination.total ?? 0}
                  onPageChange={setCampaignPage}
                  // Ten campaigns a page is the right size for a scan-and-open
                  // list, so the size control has nothing useful to offer.
                  onPageSizeChange={() => {}}
                />
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Per-recipient log ─────────────────────────────────────────────── */}
      <Card className="border-border/60">
        <CardHeader className="border-b border-border/40 pb-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <History className="size-4 text-primary" />
              <div>
                <CardTitle className="text-base font-semibold">Delivery log</CardTitle>
                <CardDescription className="text-xs mt-0.5">
                  {logCampaign
                    ? `Everyone reached by "${logCampaign.title || 'Untitled message'}"`
                    : logScope === 'all'
                      ? 'Every message the system sends — broadcasts, order confirmations and codes alike'
                      : 'Broadcasts only, with the reason when one did not arrive'}
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* Per day is the running record; per batch is the same numbers
                  cut by broadcast, which is the one that carries a cost —
                  Termii bills a send, not a date. */}
              <div className="flex rounded-md border border-border p-0.5">
                {([
                  ['day', 'Per day', CalendarDays],
                  ['campaign', 'Per batch', Layers],
                ] as const).map(([value, label, Icon]) => (
                  <button
                    key={value}
                    onClick={() => setLogGroupBy(value)}
                    className={cn(
                      'flex items-center gap-1.5 rounded px-2.5 py-1 text-xs cursor-pointer transition-colors duration-250 ease-luxe',
                      logGroupBy === value
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <Icon className="size-3" />{label}
                  </button>
                ))}
              </div>
              {logCampaign && (
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setLogCampaign(null)}>
                  <X className="size-3 mr-1" />Show everything
                </Button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-56">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground size-3.5" />
              <Input
                placeholder="Name or number…"
                value={logSearch}
                onChange={(e) => setLogSearch(e.target.value)}
                className="pl-9 h-8 text-xs"
              />
            </div>
            <Input
              type="date" value={logFrom} onChange={(e) => setLogFrom(e.target.value)}
              className="h-8 w-[9.5rem] text-xs" aria-label="Sent from"
            />
            <Input
              type="date" value={logTo} onChange={(e) => setLogTo(e.target.value)}
              className="h-8 w-[9.5rem] text-xs" aria-label="Sent up to"
            />
            <Select value={logScope} onValueChange={(v) => setLogScope(v as 'all' | 'broadcast')}>
              <SelectTrigger className="w-[150px] h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Everything we send</SelectItem>
                <SelectItem value="broadcast">Broadcasts only</SelectItem>
              </SelectContent>
            </Select>
            <Select value={logChannel} onValueChange={setLogChannel}>
              <SelectTrigger className="w-[110px] h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All channels</SelectItem>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="sms">SMS</SelectItem>
              </SelectContent>
            </Select>
            <Select value={logStatus} onValueChange={setLogStatus}>
              <SelectTrigger className="w-[130px] h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="delivered">Delivered</SelectItem>
                <SelectItem value="sent">Sent, unconfirmed</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="skipped">Skipped</SelectItem>
                <SelectItem value="suppressed">Suppressed</SelectItem>
              </SelectContent>
            </Select>
            {(logSearch || logFrom || logTo || logReason || logChannel !== 'all' || logStatus !== 'all' || logScope !== 'all') && (
              <Button
                variant="ghost" size="sm" className="h-8 text-xs"
                onClick={() => {
                  setLogSearch(''); setLogFrom(''); setLogTo('')
                  setLogChannel('all'); setLogStatus('all'); setLogReason(''); setLogScope('all')
                }}
              >
                <X className="size-3 mr-1" />Clear
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {/* The roll-up, above the rows it describes. The per-row log answers
              "did this one person get it?"; this answers what the page is
              actually opened with — what went out, how much failed, why, and
              what it cost. */}
          {summaryLoading ? (
            <div className="flex items-center justify-center border-b border-border/40 py-8">
              <Loader2 className="size-4 animate-spin text-primary" />
            </div>
          ) : (summaryData?.buckets || []).length > 0 && (
            <div className={cn('divide-y divide-border/40 border-b border-border', summaryFetching && 'opacity-60')}>
              {(summaryData?.buckets || []).map((bucket) => (
                <DeliveryRollupRow
                  key={bucket.key ?? 'unbatched'}
                  bucket={bucket}
                  groupBy={logGroupBy}
                  activeReason={logReason}
                  onReason={setLogReason}
                />
              ))}
            </div>
          )}

          {logReason && (
            <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-4 py-2 text-xs">
              <span className="text-muted-foreground">
                Showing only:{' '}
                <strong className="text-foreground">
                  {summaryData?.reasons?.[logReason]?.label || logReason}
                </strong>
              </span>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs ml-auto" onClick={() => setLogReason('')}>
                <X className="size-3 mr-1" />Show all
              </Button>
            </div>
          )}

          {deliveriesLoading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="size-5 animate-spin text-primary" /></div>
          ) : (deliveryData?.data || []).length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Nothing matches these filters.
            </div>
          ) : (
            <>
              <div className={cn('overflow-x-auto transition-opacity', deliveriesFetching && 'opacity-60')}>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase">
                      <th className="px-4 py-2 font-normal">Sent</th>
                      <th className="px-4 py-2 font-normal">Recipient</th>
                      <th className="px-4 py-2 font-normal">Channel</th>
                      <th className="px-4 py-2 font-normal">Status</th>
                      <th className="px-4 py-2 font-normal">What happened</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(deliveryData?.data || []).map((row) => (
                      <tr key={row.id} className="border-b border-border/50 last:border-0 align-top">
                        <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                          {formatDate(row.sentAt || row.createdAt)}
                          {/* When the carrier confirmed it, if it ever did. */}
                          {row.deliveredAt && (
                            <span className="block text-success">
                              landed {formatDate(row.deliveredAt)}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-xs">
                          {/* The name is why this column exists at all — a
                              broadcast to leads has no account behind it, so
                              the log could previously only show a number.
                              Rows older than the name column get one looked up
                              from the number, marked as such: who holds a
                              number today is a fair guess, not a record of who
                              was addressed. */}
                          <span className="block font-medium">
                            {row.recipientName || '—'}
                            {row.recipientName && row.nameResolvedNow && (
                              <span
                                className="ml-1 font-normal text-muted-foreground"
                                title="Not recorded at the time — this is whoever holds the number now"
                              >
                                (matched now)
                              </span>
                            )}
                          </span>
                          <span className="block font-mono text-muted-foreground">{row.destination || '—'}</span>
                          {/* Which blast it went out with, when the log is not
                              already narrowed to one. */}
                          {!logCampaign && row.campaignTitle && (
                            <span className="mt-0.5 flex items-center gap-0.5 text-muted-foreground">
                              <Megaphone className="size-3 shrink-0" />
                              <span className="truncate max-w-[180px]">{row.campaignTitle}</span>
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-xs capitalize">{row.channel}</td>
                        <td className="px-4 py-2.5">
                          <StatusBadge status={row.status} />
                          {row.providerStatus && (
                            <span className="mt-0.5 block text-xs text-muted-foreground">{row.providerStatus}</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-xs">
                          {/* The short reason first, because it is the one
                              that leads somewhere: an empty wallet is topped
                              up, a DND number is sent transactionally, a dead
                              number is corrected. The provider's own wording
                              is kept underneath — it is the evidence, and a
                              support call sometimes needs it verbatim. */}
                          <ReasonChip
                            label={row.reasonLabel}
                            tone={row.reasonTone}
                            active={logReason === row.reasonCode}
                            onClick={() => setLogReason(logReason === row.reasonCode ? '' : row.reasonCode)}
                          />
                          {row.error && (
                            <details className="mt-1 max-w-[280px]">
                              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                                What the provider said
                              </summary>
                              <span className="mt-0.5 block whitespace-pre-wrap break-words text-muted-foreground">
                                {row.error}
                              </span>
                            </details>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination
                currentPage={logPage}
                totalPages={deliveryData?.pagination.pages ?? 1}
                pageSize={logPageSize}
                totalItems={deliveryData?.pagination.total ?? 0}
                onPageChange={setLogPage}
                onPageSizeChange={(size) => { setLogPageSize(size); setLogPage(1) }}
              />
            </>
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
            <div className="space-y-1.5 rounded-lg border border-border/60 p-3">
              <p className="text-xs text-muted-foreground">
                {smsSegments} SMS segment{smsSegments === 1 ? '' : 's'} per recipient ·{' '}
                <strong>{(smsSegments * recipientCount).toLocaleString()}</strong> in total.
              </p>
              {/* The wallet, right where the decision is made. A blast that
                  runs the balance out halfway through delivers to the first
                  half and silently fails the rest — which is exactly what 346
                  sends on the live book did. */}
              {smsBalance?.ok && smsBalance.balance !== null && (
                <p className="text-xs text-muted-foreground">
                  SMS balance before this send: <strong>{money(smsBalance.balance, smsBalance.currency)}</strong>
                </p>
              )}
              {smsBalance?.ok === false && (
                <p className="flex items-center gap-1.5 text-xs text-warning">
                  <AlertCircle className="size-3 shrink-0" />
                  The SMS balance could not be read, so there is no way to tell from here
                  whether the wallet will cover this.
                </p>
              )}
            </div>
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
