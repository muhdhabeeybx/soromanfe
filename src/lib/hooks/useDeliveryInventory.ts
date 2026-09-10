import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '#/lib/api/http'
import { fetchAllPages } from '#/lib/api/fetch-all-pages'
import { useToast } from '#/lib/hooks/useToast'
import { getErrorMessage } from '#/lib/utils'
import type { DeliveryInventory } from '#/lib/types'

export function useDeliveryInventoryList(params?: {
  search?: string
  page?: number
  limit?: number
  truck_number?: string
  loading_status?: string
  refetchInterval?: number
}) {
  const { refetchInterval, ...queryParams } = params || {}
  // As in useDeliverySalesList: no page asked for means every row. There are
  // 257 allocations against a 500-row default page, so this has not bitten
  // yet — it would have, silently, the day the table crossed 500.
  const wantsEveryRow = params?.page === undefined && params?.limit === undefined
  return useQuery({
    queryKey: ['delivery-inventory', queryParams],
    queryFn: async () => {
      if (wantsEveryRow) {
        return fetchAllPages<DeliveryInventory>('/delivery-inventory', queryParams, (b) => b?.loadings || b?.inventory || b || [])
      }
      const res = await api.get('/delivery-inventory', { params: queryParams })
      return (res.data.data?.loadings || res.data.data?.inventory || res.data.data || []) as DeliveryInventory[]
    },
    refetchInterval: refetchInterval ?? false,
  })
}

export function useDeliveryInventoryDetails(id: string) {
  return useQuery({
    queryKey: ['delivery-inventory', id],
    queryFn: async () => {
      const res = await api.get(`/delivery-inventory/${id}`)
      return res.data.data?.loading || res.data.data as DeliveryInventory
    },
    enabled: !!id,
  })
}

export function useCreateDeliveryInventory() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    retry: false,
    mutationFn: async (data: Partial<DeliveryInventory>) => {
      const res = await api.post('/delivery-inventory', data)
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['delivery-inventory'] })
      queryClient.invalidateQueries({ queryKey: ['delivery-sales'] })
      toast.success('Inventory record created')
    },
    onError: (err: any) => {
      toast.error(getErrorMessage(err))
    },
  })
}

export function useUpdateDeliveryInventory() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    retry: false,
    mutationFn: async ({ id, data }: { id: string; data: Partial<DeliveryInventory> }) => {
      const res = await api.patch(`/delivery-inventory/${id}`, data)
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['delivery-inventory'] })
      queryClient.invalidateQueries({ queryKey: ['delivery-sales'] })
      toast.success('Inventory record updated')
    },
    onError: (err: any) => {
      toast.error(getErrorMessage(err))
    },
  })
}

export function useDeleteDeliveryInventory() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    retry: false,
    mutationFn: async (id: string) => {
      const res = await api.delete(`/delivery-inventory/${id}`)
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['delivery-inventory'] })
      queryClient.invalidateQueries({ queryKey: ['delivery-sales'] })
      toast.success('Inventory record deleted')
    },
    onError: (err: any) => {
      toast.error(getErrorMessage(err))
    },
  })
}

/**
 * Delete a whole delivery batch — the PFI and every truck row under its code.
 *
 * ── Why the PFI goes first ────────────────────────────────────────────────
 *
 * DELETE /pfis refuses a batch any order references, and that is the common
 * refusal. Deleting the truck rows first would mean destroying them and only
 * then discovering the batch itself cannot go, leaving the PFI standing with
 * its loads gone. Taking the PFI first means the likely failure happens while
 * nothing has been touched.
 *
 * ── Why the rows have to be deleted at all ────────────────────────────────
 *
 * delivery_inventory.pfi_id is ON DELETE SET NULL, not CASCADE. Deleting the
 * PFI alone would leave every truck row behind with a null pfi_id, still
 * carrying its allocation_code — so the batch would go on appearing on the
 * inventory page and in the sales ledger, unlinked from anything. "Deleted the
 * batch, batch still there."
 */
export function useDeleteDeliveryBatch() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    retry: false,
    mutationFn: async ({ pfiId, inventoryIds, label }: {
      pfiId?: number | null
      inventoryIds: string[]
      /** The batch code, for the message. */
      label: string
    }) => {
      if (pfiId != null) await api.delete(`/pfis/${pfiId}`)

      // One at a time, not Promise.all: each removal unwinds its own stock and
      // ledger links, and a failure halfway needs to say how far it got rather
      // than leave a dozen half-finished requests in flight.
      const failed: string[] = []
      for (const id of inventoryIds) {
        try {
          await api.delete(`/delivery-inventory/${id}`)
        } catch {
          failed.push(id)
        }
      }
      return { label, deleted: inventoryIds.length - failed.length, failed: failed.length }
    },
    onSuccess: (res) => {
      if (res.failed > 0) {
        toast.error(`${res.label}: ${res.deleted} truck records removed, ${res.failed} could not be`)
      } else {
        toast.success(`${res.label} deleted${res.deleted ? ` with ${res.deleted} truck record${res.deleted === 1 ? '' : 's'}` : ''}`)
      }
      queryClient.invalidateQueries({ queryKey: ['delivery-inventory'] })
      queryClient.invalidateQueries({ queryKey: ['delivery-sales'] })
      queryClient.invalidateQueries({ queryKey: ['pfis'] })
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  })
}
