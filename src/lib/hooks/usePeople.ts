import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '#/lib/api/http'
import { useToast } from '#/lib/hooks/useToast'
import { getErrorMessage } from '#/lib/utils'
import type { ImportRow } from '#/lib/hooks/useContacts'

/**
 * The merged customers-and-contacts book.
 *
 * Two tables on the server, one list here — see the header of
 * repositories/people.repository.js for why the tables stay apart and the
 * pages did not. A person appears exactly once, keyed on their phone number.
 */

/** What a row IS. A customer has an account; the other two do not. */
export type PersonKind = 'customer' | 'lead' | 'contact'

/** How the row's phone number stands up, per the server's classifyPhone. */
export type NumberStatus = 'ok' | 'invalid' | 'unreachable'

export interface PersonRow {
  kind: PersonKind
  customerId: number | null
  contactId: number | null
  name: string
  phone: string
  phoneKey: string
  email: string
  companyName: string
  customerStatus: string | null
  marketingOptOut: boolean
  createdAt: string
  /** Customer-only. Null for a lead, who has no wallet. */
  balance: number | null
  orderCount: number
  lastOrderAt: string | null
  lifetimeValue: number
  activityBand: 'frequent' | 'occasional' | 'dormant' | 'never' | null
  locationName: string | null
  tags: string[]
  stage: string
  source: string
  notes: string
  /** This customer was on the contacts list before they signed up. */
  cameInAsLead: boolean
  numberStatus: NumberStatus
  /** Why the number is bad, in words. Empty when it is fine. */
  numberReason: string
  hasDuplicate: boolean
  /**
   * The customer's OTHER numbers — every one of which also signs in to this
   * account. Always empty for a lead: extra numbers are a property of an
   * account, and a lead does not have one.
   */
  extraPhones: string[]
}

export interface PeopleSummary {
  total: number
  customers: number
  leads: number
  otherContacts: number
  converted: number
  reachable: number
  newThisMonth: number
  /**
   * Counted over the whole book, never the filtered view — a standing fact
   * about the data that would be meaningless if it moved when you searched.
   */
  needsAttention: number
}

export interface PeopleListParams {
  search?: string
  kind?: PersonKind | 'prospect' | ''
  converted?: 'yes' | 'no' | ''
  locationId?: string | number
  tag?: string
  optedOut?: 'yes' | 'no' | ''
  status?: string
  activity?: string
  hasBalance?: 'yes' | 'no' | ''
  numberStatus?: 'all' | 'ok' | 'invalid' | 'unreachable' | 'duplicate' | ''
  /** Rows that look like the same person twice — by name, by number, or either. */
  duplicates?: 'name' | 'number' | 'any' | ''
  sort?: 'top' | 'active' | 'newest' | 'oldest' | 'name' | 'company' | 'value'
  page?: number
  limit?: number
}

/** Drops blank filters — the server's enums reject `kind=` outright. */
const clean = (params: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v != null))

export function usePeopleList(params?: PeopleListParams) {
  const queryParams = clean({ ...params })
  return useQuery({
    queryKey: ['people', queryParams],
    queryFn: async () => {
      const res = await api.get('/people', { params: queryParams })
      return res.data.data as {
        people: PersonRow[]
        pagination: { total: number; page: number; pages: number; limit: number }
        summary: PeopleSummary
      }
    },
    placeholderData: (prev) => prev,
  })
}

/** Everyone the current filters match, unpaginated — for export. */
export async function fetchAllPeople(params?: PeopleListParams) {
  const res = await api.get('/people', { params: clean({ ...params, limit: 5000, page: 1 }) })
  return res.data.data as { people: PersonRow[] }
}

// ─── The number review panel ────────────────────────────────────────────────

export interface HygieneRecord {
  kind: 'customer' | 'contact'
  id: number
  name: string
  phone: string
  email: string
  companyName: string
  createdAt: string
  balance: number | null
  orderCount: number
  depositCount: number
  /**
   * Why this record may NOT be removed, or null when it may.
   *
   * A string rather than a boolean so the button can say what it is refusing —
   * "Has 97 orders" — instead of being mysteriously greyed out.
   */
  deletableReason: string | null
}

export interface HygieneGroup {
  phoneKey: string
  problems: Array<{ type: 'invalid' | 'unreachable' | 'duplicate'; reason: string }>
  records: HygieneRecord[]
}

export function usePhoneHygiene(
  params?: { issue?: 'all' | 'invalid' | 'unreachable' | 'duplicate' },
  options?: { enabled?: boolean },
) {
  const queryParams = clean({ ...params })
  return useQuery({
    queryKey: ['people', 'hygiene', queryParams],
    queryFn: async () => {
      const res = await api.get('/people/hygiene', { params: queryParams })
      return res.data.data as {
        issues: HygieneGroup[]
        summary: { invalid: number; unreachable: number; duplicate: number; total: number }
      }
    },
    enabled: options?.enabled ?? true,
  })
}

export interface DeleteResult {
  deleted: Array<{ kind: string; id: number; name?: string }>
  blocked: Array<{ kind: string; id: number; name?: string; reason: string }>
}

/**
 * Remove records reviewed on the hygiene panel.
 *
 * The server re-runs the guard against live rows, so a customer who placed
 * their first order since the panel was fetched comes back in `blocked`
 * rather than being deleted. Partial success is the normal outcome and is
 * reported as such.
 */
export function useDeleteReviewed() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    retry: false,
    mutationFn: async (records: Array<{ kind: 'customer' | 'contact'; id: number }>) => {
      const res = await api.post('/people/hygiene/delete', { records })
      return res.data.data as DeleteResult
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['people'] })
      queryClient.invalidateQueries({ queryKey: ['customers'] })
      queryClient.invalidateQueries({ queryKey: ['contacts'] })
      if (result.blocked.length && !result.deleted.length) {
        toast.error(`Nothing removed — ${result.blocked[0].reason}`)
      } else if (result.blocked.length) {
        toast.success(`${result.deleted.length} removed, ${result.blocked.length} kept`)
      } else {
        toast.success(`${result.deleted.length} removed`)
      }
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  })
}

// ─── CSV preflight ──────────────────────────────────────────────────────────

export type ImportVerdict =
  | 'new'
  | 'existing_contact'
  | 'existing_customer'
  | 'duplicate_in_file'
  | 'invalid'
  | 'incomplete'

export interface ImportPreviewRow {
  line: number
  name: string
  phone: string
  companyName: string
  verdict: ImportVerdict
  reason: string
  unreachable?: boolean
}

export interface ImportPreview {
  rows: ImportPreviewRow[]
  counts: Record<ImportVerdict | 'total', number>
}

/**
 * A dry run of the spreadsheet against both books.
 *
 * Nothing is written. This is what turns "480 rows ready" — which could mean
 * 480 new people or the same 480 again — into a breakdown you can act on
 * before pressing the button.
 */
export function usePreviewImport() {
  const toast = useToast()
  return useMutation({
    retry: false,
    mutationFn: async (rows: ImportRow[]) => {
      const res = await api.post('/contacts/import/preview', { rows })
      return res.data.data as ImportPreview
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  })
}

// ─── Folding duplicates into one record ─────────────────────────────────────

export interface MergeRef {
  kind: 'customer' | 'contact'
  id: number
}

/** A party to the merge, as the confirmation screen lists it. */
export interface MergeParty extends MergeRef {
  name: string
  phone: string
  companyName: string
  email: string
  /** Null for a lead, who has no wallet. */
  balance: number | null
  createdAt: string
}

/** What the losing records are carrying, counted before anything moves. */
export interface MergeMoving {
  orders: number
  deposits: number
  commissions: number
  licenses: number
  dangoteRequests: number
  lpgRequests: number
  walletHolds: number
  expectedPayments: number
  notifications: number
  phones: number
  sessions: number
}

export interface MergePlan {
  target: MergeParty
  sources: MergeParty[]
  moving: MergeMoving
  balance: { keeping: number; incoming: number; total: number }
  /** Numbers that will reach the surviving record afterwards. */
  phones: string[]
  tags: string[]
  /** Blank fields on the survivor that the merge fills in. */
  fills: Array<{ field: string; label: string; value: string; from: string }>
  warnings: string[]
}

/** The same shape back from the merge itself, with `moved` for `moving`. */
export interface MergeResult extends Omit<MergePlan, 'moving' | 'fills' | 'tags'> {
  moved: MergeMoving
}

/**
 * What the merge would do, without doing it.
 *
 * A query rather than a mutation because it is a READ that happens to need a
 * body: it re-runs whenever the survivor is changed on the dialog, and caching
 * it per (survivor, losers) means flipping between two candidates and back
 * does not re-ask the server the same question.
 */
export function useMergePlan(
  target: MergeRef | null,
  sources: MergeRef[],
  options?: { enabled?: boolean },
) {
  const key = target ? `${target.kind}:${target.id}` : ''
  const sourceKey = sources.map((s) => `${s.kind}:${s.id}`).sort().join(',')
  return useQuery({
    queryKey: ['people', 'merge-plan', key, sourceKey],
    queryFn: async () => {
      const res = await api.post('/people/merge/preview', { target, sources })
      return res.data.data as MergePlan
    },
    enabled: (options?.enabled ?? true) && Boolean(target) && sources.length > 0,
    retry: false,
    staleTime: 0,
  })
}

/**
 * Fold the chosen records into one.
 *
 * Invalidates orders and deposits as well as the people lists: the orders
 * behind the absorbed records now belong to a different customer, and a page
 * still showing them under the old name would be showing a customer that no
 * longer exists.
 */
export function useMergePeople() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    retry: false,
    mutationFn: async ({ target, sources }: { target: MergeRef; sources: MergeRef[] }) => {
      const res = await api.post('/people/merge', { target, sources })
      return res.data as { message: string; data: MergeResult }
    },
    onSuccess: (res) => {
      for (const key of [['people'], ['customers'], ['contacts'], ['orders'], ['deposits']]) {
        queryClient.invalidateQueries({ queryKey: key })
      }
      // The server's own sentence — it is the one that knows how many orders
      // actually moved.
      toast.success(res.message)
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  })
}

// ─── A customer's numbers ───────────────────────────────────────────────────

export interface CustomerPhone {
  /**
   * Null for the primary — it lives on the customer row, not in the phones
   * table, so there is no row to address. That also means it cannot be
   * deleted from here, which is correct: a customer with no number could
   * neither sign in nor be told anything.
   */
  id: number | null
  phone: string
  phoneNormalized: string
  /** The desk's own word for it — "Warehouse", "Director". */
  label: string
  isPrimary: boolean
  /** Set once somebody has passed an OTP on this number. */
  verifiedAt: string | null
  createdAt: string | null
}

export function useCustomerPhones(customerId: number | null, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['customer-phones', customerId],
    queryFn: async () => {
      const res = await api.get(`/customers/${customerId}/phones`)
      return res.data.data.phones as CustomerPhone[]
    },
    enabled: (options?.enabled ?? true) && Boolean(customerId),
  })
}

/**
 * Invalidates the people list as well as the phone list.
 *
 * The row on /people shows how many numbers a customer has, so a number added
 * in the dialog that left the list behind it saying "1 number" would be the
 * page contradicting itself on screen.
 */
const invalidatePhones = (queryClient: ReturnType<typeof useQueryClient>, customerId: number) => {
  queryClient.invalidateQueries({ queryKey: ['customer-phones', customerId] })
  queryClient.invalidateQueries({ queryKey: ['people'] })
  queryClient.invalidateQueries({ queryKey: ['customers'] })
}

export function useAddCustomerPhone(customerId: number | null) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    retry: false,
    mutationFn: async (data: { phone: string; label?: string }) => {
      const res = await api.post(`/customers/${customerId}/phones`, data)
      return res.data as { message: string; data: { phones: CustomerPhone[]; numberStatus?: NumberStatus } }
    },
    onSuccess: (res) => {
      if (customerId) invalidatePhones(queryClient, customerId)
      // The server's own sentence, because it is the one that knows whether
      // the number can actually receive an SMS — a landline is accepted and
      // worth keeping, but saying "it can now be used to sign in" about one
      // would be a lie.
      toast.success(res.message)
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  })
}

export function useDeleteCustomerPhone(customerId: number | null) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    retry: false,
    mutationFn: async (phoneId: number) => {
      const res = await api.delete(`/customers/${customerId}/phones/${phoneId}`)
      return res.data.data.phones as CustomerPhone[]
    },
    onSuccess: () => {
      if (customerId) invalidatePhones(queryClient, customerId)
      toast.success('Number removed')
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  })
}

export function useMakePhonePrimary(customerId: number | null) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    retry: false,
    mutationFn: async (phoneId: number) => {
      const res = await api.post(`/customers/${customerId}/phones/${phoneId}/primary`)
      return res.data as { message: string }
    },
    onSuccess: (res) => {
      if (customerId) invalidatePhones(queryClient, customerId)
      toast.success(res.message)
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  })
}
