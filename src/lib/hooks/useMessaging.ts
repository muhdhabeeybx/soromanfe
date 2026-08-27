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
} & (
  | { audience: 'customers'; customerIds: number[]; contacts?: never }
  | { audience: 'contacts'; contacts: BroadcastContact[]; customerIds?: never }
)

export interface BroadcastResult {
  recipients: number
  delivered: number
  duplicates: number
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

      const totals: BroadcastResult = { recipients: 0, delivered: 0, duplicates: 0 }
      for (const chunk of chunks) {
        const res = await api.post('/notifications/broadcast', {
          title: payload.title,
          body: payload.body,
          audience: payload.audience,
          channels: payload.channels,
          ...(payload.depotIds?.length ? { depotIds: payload.depotIds } : {}),
          ...(payload.audience === 'contacts'
            ? { contacts: chunk as BroadcastContact[] }
            : { customerIds: chunk as number[] }),
        })
        const data = res.data.data as BroadcastResult
        totals.recipients += data.recipients || 0
        totals.delivered += data.delivered || 0
        totals.duplicates += data.duplicates || 0
      }
      return totals
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['notification-deliveries'] })
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
  customerId: number | null
  staffId: number | null
  type: string
  channel: 'in_app' | 'push' | 'email' | 'sms'
  destination: string
  status: 'pending' | 'sent' | 'delivered' | 'failed' | 'skipped' | 'suppressed'
  attempts: number
  error: string | null
  sentAt: string | null
  createdAt: string
}

export function useNotificationDeliveries(params?: { channel?: string; status?: string; type?: string; page?: number; limit?: number }) {
  return useQuery({
    queryKey: ['notification-deliveries', params],
    queryFn: async () => {
      const res = await api.get('/notifications/deliveries', { params })
      return res.data.data as { data: NotificationDelivery[]; pagination: { total: number; page: number; limit: number; pages: number } }
    },
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
