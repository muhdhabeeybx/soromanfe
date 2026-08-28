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
  sort?: 'active' | 'newest' | 'oldest' | 'name' | 'company' | 'value'
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
    onError: (err: any) => toast.error(getErrorMessage(err)),
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
    onError: (err: any) => toast.error(getErrorMessage(err)),
  })
}
