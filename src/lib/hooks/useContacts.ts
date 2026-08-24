import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '#/lib/api/http'
import { useToast } from '#/lib/hooks/useToast'
import { getErrorMessage } from '#/lib/utils'

export type ContactStage = 'lead' | 'contact'
export type ContactSource = 'manual' | 'csv' | 'referral' | 'event' | 'other'
export type ContactSort = 'newest' | 'oldest' | 'name' | 'company'

export interface ContactRow {
  id: number
  name: string
  phone: string
  phone_normalized: string
  email: string
  companyName: string
  stage: ContactStage
  source: ContactSource
  locationId: number | null
  locationName: string | null
  tags: string[]
  notes: string
  marketingOptOut: boolean
  createdAt: string
  /** Derived from a phone match against customers — never stored. */
  isCustomer: boolean
  customerId: number | null
  customerStatus: string | null
  orderCount: number
}

export interface ContactSummary {
  total: number
  leads: number
  otherContacts: number
  converted: number
  reachable: number
  newThisMonth: number
}

export interface ContactListParams {
  search?: string
  stage?: ContactStage | ''
  source?: ContactSource | ''
  locationId?: string | number
  converted?: 'yes' | 'no' | ''
  optedOut?: 'yes' | 'no' | ''
  tag?: string
  sort?: ContactSort
  page?: number
  limit?: number
}

/** Drops blank filters — the server's enums reject `stage=` outright. */
const clean = (params: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v != null))

export function useContactList(params?: ContactListParams) {
  const queryParams = clean({ ...params })
  return useQuery({
    queryKey: ['contacts', queryParams],
    queryFn: async () => {
      const res = await api.get('/contacts', { params: queryParams })
      return res.data.data as {
        contacts: ContactRow[]
        pagination: { total: number; page: number; pages: number }
        summary: ContactSummary
      }
    },
    placeholderData: (prev) => prev,
  })
}

export function useContactTags() {
  return useQuery({
    queryKey: ['contacts', 'tags'],
    queryFn: async () => {
      const res = await api.get('/contacts/tags')
      return (res.data.data.tags || []) as string[]
    },
  })
}

/** Every contact the current filters match, unpaginated — for export and messaging. */
export async function fetchAllContacts(params?: ContactListParams) {
  const res = await api.get('/contacts', { params: clean({ ...params, limit: 5000, page: 1 }) })
  return res.data.data as { contacts: ContactRow[] }
}

function useContactMutation<TArgs>(
  fn: (args: TArgs) => Promise<unknown>,
  successMessage?: (result: any, args: TArgs) => string,
) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    retry: false,
    mutationFn: fn,
    onSuccess: (result, args) => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] })
      // Convert creates a customer, so that list is stale too.
      queryClient.invalidateQueries({ queryKey: ['customers'] })
      const message = successMessage?.(result, args)
      if (message) toast.success(message)
    },
    onError: (err: any) => toast.error(getErrorMessage(err)),
  })
}

export function useCreateContact() {
  return useContactMutation(
    async (data: Record<string, unknown>) => (await api.post('/contacts', data)).data,
    () => 'Contact added',
  )
}

export function useUpdateContact() {
  return useContactMutation(
    async ({ id, data }: { id: number; data: Record<string, unknown> }) =>
      (await api.patch(`/contacts/${id}`, data)).data,
    () => 'Contact updated',
  )
}

export function useDeleteContact() {
  return useContactMutation(
    async (id: number) => (await api.delete(`/contacts/${id}`)).data,
    () => 'Contact removed',
  )
}

export function useConvertContact() {
  return useContactMutation(
    async (id: number) => (await api.post(`/contacts/${id}/convert`)).data,
    (res) => res?.message || 'Converted to customer',
  )
}

export interface ImportRow {
  name?: string
  phone?: string
  email?: string
  companyName?: string
  stage?: ContactStage
  tags?: string[]
  notes?: string
}

export function useImportContacts() {
  return useContactMutation(
    async ({ rows, source }: { rows: ImportRow[]; source?: ContactSource }) =>
      (await api.post('/contacts/import', { rows, source })).data,
    (res) => res?.message || 'Import complete',
  )
}
