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

/** One truck on a batch, as the New Batch dialog collects it. */
export interface BatchTruck {
  truckId: number | null
  plateNumber: string
  loadedQty: number
}

export interface DeliveryBatchDraft {
  /** The batch code. Every screen groups these loads by it. */
  code: string
  /** The depot the trucks loaded at. Text, because that is what the row holds. */
  depotName: string
  productName: string
  dateAllocated: string
  trucks: BatchTruck[]
}

/**
 * Create a delivery batch: a code, and one row per truck loaded under it.
 *
 * ── A batch is a code, not a PFI ──────────────────────────────────────────
 *
 * This used to raise a PFI first and hang the loads off its id, so creating a
 * batch meant creating a cargo record, an allowlist of depots that could sell
 * from it and a manifest — three writes that could each fail on their own and
 * leave a batch half-built. None of that is what anybody comes here to do.
 * A batch is the code written on the loading papers; the trucks that carried
 * it are the batch. So the only thing written is the operational row per
 * truck, which is what the inventory table lists and what the sales ledger
 * builds its rows from — the load appears there straight away, unpaid, and
 * stays that way until somebody enters a payment against it.
 *
 * Adding trucks to a code that already exists is the same write. Nothing
 * anywhere holds "the batch" apart from its rows, so a second load under
 * PFI-25C simply joins the first.
 *
 * One request at a time, and a failure is counted rather than thrown: eight
 * trucks going in as eight POSTs means a network blip halfway leaves five
 * recorded, and the honest thing is to say so rather than to report a failure
 * over rows that are already in the books.
 */
export function useCreateDeliveryBatch() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    retry: false,
    mutationFn: async (draft: DeliveryBatchDraft) => {
      const code = draft.code.trim().toUpperCase().replace(/\s+/g, '-')
      const failed: string[] = []
      let firstError: unknown = null

      for (const t of draft.trucks) {
        try {
          await api.post('/delivery-inventory', {
            // Both casings, as every other caller of this endpoint sends: the
            // serialiser answers in camel and accepts either.
            allocation_code: code, allocationCode: code,
            truck: t.truckId != null ? String(t.truckId) : undefined,
            truck_id: t.truckId ?? undefined, truckId: t.truckId ?? undefined,
            truck_number: t.plateNumber, truckNumber: t.plateNumber,
            depot: draft.depotName || undefined,
            pfi_product: draft.productName || undefined, pfiProduct: draft.productName || undefined,
            // What went on, not what the truck holds. The old allocation
            // screen wrote capacity here, which overstated every truck that
            // loaded short.
            quantity_allocated: t.loadedQty, quantityAllocated: t.loadedQty,
            date_allocated: draft.dateAllocated, dateAllocated: draft.dateAllocated,
            loading_status: 'loaded', loadingStatus: 'loaded',
          })
        } catch (err) {
          firstError = firstError ?? err
          failed.push(t.plateNumber || 'a truck')
        }
      }

      const created = draft.trucks.length - failed.length
      // Nothing landed, so there is no batch to send anybody to — this is a
      // plain failure and reads as one.
      if (created === 0) throw firstError ?? new Error(`Nothing was recorded against ${code}`)

      return { code, created, failed }
    },
    onSuccess: ({ code, created, failed }) => {
      queryClient.invalidateQueries({ queryKey: ['delivery-inventory'] })
      queryClient.invalidateQueries({ queryKey: ['delivery-sales'] })
      if (failed.length > 0) {
        toast.error(`${code}: ${created} truck${created === 1 ? '' : 's'} recorded, ${failed.join(', ')} could not be`)
      } else {
        toast.success(`${code} · ${created} truck${created === 1 ? '' : 's'} loaded`)
      }
    },
    onError: (err) => toast.error(getErrorMessage(err)),
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
      /**
       * Clear any closed status the code carried.
       *
       * The status is keyed by the code, not by a row that has just been
       * deleted — so without this, raising a new batch under the same code
       * later would find it already closed, with nothing on screen to say
       * why. Best-effort: the batch is gone either way, and failing the
       * delete over its status would be the wrong trade.
       */
      try {
        await api.patch(`/delivery-inventory/batches/${encodeURIComponent(label)}`, { status: 'active' })
      } catch {
        // Nothing to tell the user: the batch itself is deleted.
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
      queryClient.invalidateQueries({ queryKey: ['delivery-batch-statuses'] })
      queryClient.invalidateQueries({ queryKey: ['pfis'] })
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  })
}

// ── Closing a batch ─────────────────────────────────────────────────────────

/**
 * A delivery batch's status.
 *
 * A batch is a code and the loads recorded under it — there is no batch row —
 * so this is keyed by the code, trimmed and upper-cased the same way the
 * register groups them. A code with no entry here is active, which is why
 * nothing had to be backfilled when this was added.
 */
export interface DeliveryBatchStatus {
  code: string
  status: 'active' | 'completed'
  /** Null on an active batch: reopening clears the last close rather than keeping it. */
  closedAt: string | null
  closedBy: string
  note: string
}

/** Every batch that has been closed, keyed by code. */
export function useDeliveryBatchStatuses() {
  return useQuery({
    queryKey: ['delivery-batch-statuses'],
    queryFn: async () => {
      const res = await api.get('/delivery-inventory/batches')
      return (res.data?.data?.batches || {}) as Record<string, DeliveryBatchStatus>
    },
  })
}

/**
 * Close a batch, or reopen it.
 *
 * Deliberately does NOT touch the status of the PFI behind the batch, where
 * there is one. `pfis.status` drives the finance report's stock summary, the
 * expense chart and the PFI register; finishing a PFI is a decision taken on
 * the PFI, where its consequences are visible. See migration 0028.
 */
export function useSetDeliveryBatchStatus() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    mutationFn: async ({ code, status, note }: {
      code: string
      status: 'active' | 'completed'
      note?: string
    }) => {
      const res = await api.patch(`/delivery-inventory/batches/${encodeURIComponent(code)}`, { status, note })
      return { code, status, batch: res.data?.data?.batch as DeliveryBatchStatus }
    },
    onSuccess: ({ code, status }) => {
      toast.success(status === 'completed' ? `${code} closed` : `${code} reopened`)
      queryClient.invalidateQueries({ queryKey: ['delivery-batch-statuses'] })
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  })
}
