import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '#/lib/api/http'
import { useToast } from '#/lib/hooks/useToast'
import { getErrorMessage } from '#/lib/utils'

export interface SegmentCustomer {
  id: number
  name: string
  phone: string
  email: string
  companyName: string
}

export interface SegmentFilters {
  depotId?: number
  minOrders?: number
  sinceDays?: number
  inactiveSinceDays?: number
}

/** Resolves a messaging audience — "N customers match" plus the id list itself. */
export function useCustomerSegment(filters: SegmentFilters, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['customer-segment', filters],
    queryFn: async () => {
      const res = await api.get('/customers/segments', { params: filters })
      return res.data.data as { customers: SegmentCustomer[]; count: number }
    },
    enabled: options?.enabled ?? true,
  })
}

/** A lead or other non-customer, addressed by their details rather than an id. */
export interface BroadcastContact {
  name?: string
  email?: string
  phone?: string
}

export type BroadcastPayload = {
  title: string
  body: string
  channels: Array<'email' | 'sms'>
  /**
   * Which depots a {{prices}} shortcode still in the body should quote.
   *
   * Only consulted when the body carries unresolved shortcodes — sending a
   * saved price template resolves it server-side at send time, so yesterday's
   * template goes out with today's prices.
   */
  depotIds?: number[]
  /** What the audience meant, recorded on the campaign. */
  audienceLabel?: string
  /**
   * An already-open campaign to file these sends under.
   *
   * "Everyone" is two audiences and goes out as two calls; passing the first
   * call's id into the second is what keeps one press of Send showing up in
   * the log as one campaign rather than two.
   */
  campaignId?: number
} & (
  | { audience: 'customers'; customerIds: number[]; contacts?: never }
  | { audience: 'contacts'; contacts: BroadcastContact[]; customerIds?: never }
)

export interface BroadcastResult {
  recipients: number
  delivered: number
  duplicates: number
  /** The campaign every send in this call was filed under. */
  campaignId: number | null
}

/** POST /notifications/broadcast, one call per <=1000 recipients — the schema's own cap. */
const BROADCAST_CHUNK_SIZE = 1000

export function useBroadcast() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    retry: false,
    mutationFn: async (payload: BroadcastPayload) => {
      // Customers travel as ids, contacts as their details — but both are
      // capped at 1,000 a request by the same schema, so both are chunked the
      // same way rather than one path growing its own batching.
      const all: Array<number | BroadcastContact> =
        payload.audience === 'contacts' ? payload.contacts : payload.customerIds

      const chunks: Array<Array<number | BroadcastContact>> = []
      for (let i = 0; i < all.length; i += BROADCAST_CHUNK_SIZE) {
        chunks.push(all.slice(i, i + BROADCAST_CHUNK_SIZE))
      }
      if (chunks.length === 0) chunks.push([])

      const totals: BroadcastResult = { recipients: 0, delivered: 0, duplicates: 0, campaignId: null }
      // The campaign opened by the first request, carried into every one after
      // it. Without this a 3,000-recipient blast would file itself in the log
      // as three separate campaigns purely because of the chunk size.
      let campaignId = payload.campaignId ?? null

      for (const chunk of chunks) {
        const res = await api.post('/notifications/broadcast', {
          title: payload.title,
          body: payload.body,
          audience: payload.audience,
          channels: payload.channels,
          ...(payload.audienceLabel ? { audienceLabel: payload.audienceLabel } : {}),
          ...(campaignId ? { campaignId } : {}),
          ...(payload.depotIds?.length ? { depotIds: payload.depotIds } : {}),
          ...(payload.audience === 'contacts'
            ? { contacts: chunk as BroadcastContact[] }
            : { customerIds: chunk as number[] }),
        })
        const data = res.data.data as BroadcastResult
        totals.recipients += data.recipients || 0
        totals.delivered += data.delivered || 0
        totals.duplicates += data.duplicates || 0
        campaignId ??= data.campaignId ?? null
      }
      totals.campaignId = campaignId
      return totals
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['notification-deliveries'] })
      queryClient.invalidateQueries({ queryKey: ['campaigns'] })
      // The wallet just moved. Refetching is what makes the "before and after"
      // beside the compose box mean anything.
      queryClient.invalidateQueries({ queryKey: ['sms-balance'] })
      toast.success(`Sent to ${result.recipients} recipient(s)`)
    },
    onError: (err: any) => {
      toast.error(getErrorMessage(err))
    },
  })
}

// ─── Price advisory ─────────────────────────────────────────────────────────

export interface PriceListDepot {
  id: number
  name: string
  /** How the depot is quoted in a message — "Calabar", or "Dangote Refinery". */
  city: string
  state: string
  products: Array<{ code: string; name: string; price: number; unitSuffix: string }>
}

export interface PriceListGroup {
  code: string
  product: string
  unitSuffix: string
  locations: Array<{ depotId: number; label: string; price: number; unitSuffix: string }>
}

export interface PriceListShortcode {
  token: string
  label: string
  hint: string
}

/**
 * What is quotable right now, and the block a {{prices}} shortcode becomes.
 *
 * `depotIds` narrows it to the depots the sender has ticked. That selection
 * also decides how locations are labelled: leave two Port Harcourt depots in
 * and both are named in full, because one "Port Harcourt" line cannot carry
 * two different prices.
 */
export function usePriceList(depotIds: number[]) {
  return useQuery({
    queryKey: ['price-list', [...depotIds].sort((a, b) => a - b)],
    queryFn: async () => {
      const res = await api.get('/price-list', {
        params: depotIds.length > 0 ? { depotIds: depotIds.join(',') } : undefined,
      })
      return res.data.data as {
        depots: PriceListDepot[]
        groups: PriceListGroup[]
        text: string
        greeting: string
        shortcodes: PriceListShortcode[]
      }
    },
    staleTime: 60 * 1000,
  })
}

/**
 * A body with its shortcodes resolved, rendered by the server.
 *
 * Deliberately not resolved in the browser: the preview has to be produced by
 * the same code that produces the text actually sent, or the two are free to
 * disagree about exactly the message someone approved.
 */
export function useRenderedPreview(body: string, depotIds: number[], enabled: boolean) {
  return useQuery({
    queryKey: ['price-list', 'preview', body, [...depotIds].sort((a, b) => a - b)],
    enabled: enabled && body.includes('{{'),
    queryFn: async () => {
      const res = await api.post('/price-list/preview', { body, depotIds })
      return res.data.data.text as string
    },
  })
}

export interface NotificationDelivery {
  id: number
  campaignId: number | null
  customerId: number | null
  staffId: number | null
  /** Who it went to, as they were named at send time. */
  recipientName: string
  type: string
  channel: 'in_app' | 'push' | 'email' | 'sms'
  destination: string
  status: 'pending' | 'sent' | 'delivered' | 'failed' | 'skipped' | 'suppressed'
  attempts: number
  error: string | null
  /** The carrier's own word — "DELIVERED", "Rejected", "Expired". */
  providerStatus: string
  providerMessageId: string
  sentAt: string | null
  deliveredAt: string | null
  createdAt: string
}

export interface DeliveryLogParams {
  channel?: string
  status?: string
  type?: string
  campaignId?: number
  /** Dates, not timestamps — the server widens `to` to the end of its day. */
  from?: string
  to?: string
  /** Matched against the recipient's name and the destination alike. */
  search?: string
  page?: number
  limit?: number
}

const dropBlanks = (params: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v != null))

export function useNotificationDeliveries(params?: DeliveryLogParams) {
  const queryParams = dropBlanks({ ...params })
  return useQuery({
    queryKey: ['notification-deliveries', queryParams],
    queryFn: async () => {
      const res = await api.get('/notifications/deliveries', { params: queryParams })
      return res.data.data as { data: NotificationDelivery[]; pagination: { total: number; page: number; limit: number; pages: number } }
    },
    placeholderData: (prev) => prev,
  })
}

// ─── The Termii wallet ──────────────────────────────────────────────────────

export interface SmsBalance {
  ok: boolean
  balance: number | null
  currency: string
  error: string | null
  cached: boolean
}

/**
 * What is left in the SMS wallet.
 *
 * 346 sends on the live book failed with "Insufficient balance" while the
 * dashboard showed nothing at all. Cached a minute server-side; refetched
 * after a send so the figure beside the compose box moves when the money does.
 */
export function useSmsBalance() {
  return useQuery({
    queryKey: ['sms-balance'],
    queryFn: async () => {
      const res = await api.get('/notifications/sms-balance')
      return res.data.data as SmsBalance
    },
    staleTime: 60 * 1000,
  })
}

// ─── Campaigns ──────────────────────────────────────────────────────────────

export interface Campaign {
  id: number
  title: string
  body: string
  channels: Array<'email' | 'sms'>
  audience: string
  /** What the audience meant at the time, since the thresholds are tunable. */
  audienceLabel: string
  recipientCount: number
  smsSegments: number
  balanceBefore: number | null
  balanceAfter: number | null
  balanceCurrency: string
  /**
   * What the wallet actually moved by. Null — never 0 — when a reading is
   * missing, because "could not read" and "cost nothing" are different facts.
   */
  spent: number | null
  sentBy: string
  createdAt: string
  completedAt: string | null
  deliveries: { total: number; sent: number; delivered: number; failed: number; skipped: number }
}

export function useCampaigns(params?: { page?: number; limit?: number }) {
  return useQuery({
    queryKey: ['campaigns', params],
    queryFn: async () => {
      const res = await api.get('/notifications/campaigns', { params })
      return res.data.data as {
        campaigns: Campaign[]
        pagination: { total: number; page: number; pages: number; limit: number }
      }
    },
    placeholderData: (prev) => prev,
  })
}

export interface MessageTemplate {
  id: number
  name: string
  subject: string
  body: string
  channels: Array<'email' | 'sms'>
  createdBy: number | null
  createdAt: string
  updatedAt: string
}

export function useMessageTemplates() {
  return useQuery({
    queryKey: ['message-templates'],
    queryFn: async () => {
      const res = await api.get('/message-templates')
      return res.data.data.templates as MessageTemplate[]
    },
  })
}

export function useCreateMessageTemplate() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    retry: false,
    mutationFn: async (data: { name: string; subject?: string; body: string; channels: Array<'email' | 'sms'> }) => {
      const res = await api.post('/message-templates', data)
      return res.data.data.template as MessageTemplate
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['message-templates'] })
      toast.success('Template saved')
    },
    onError: (err: any) => {
      toast.error(getErrorMessage(err))
    },
  })
}

export function useDeleteMessageTemplate() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    retry: false,
    mutationFn: async (id: number) => {
      const res = await api.delete(`/message-templates/${id}`)
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['message-templates'] })
      toast.success('Template deleted')
    },
    onError: (err: any) => {
      toast.error(getErrorMessage(err))
    },
  })
}
