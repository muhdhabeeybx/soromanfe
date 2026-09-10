import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '#/lib/api/http'
import { fetchAllPages } from '#/lib/api/fetch-all-pages'
import { useToast } from '#/lib/hooks/useToast'
import { getErrorMessage } from '#/lib/utils'
import { normalizePlate, toNum } from '#/lib/sales-ledger-utils'
import type { DeliveryInventory, DeliverySale } from '#/lib/types'

export function useDeliverySalesList(params?: {
  search?: string
  page?: number
  limit?: number
  customer?: string
  truck_number?: string
  date_from?: string
  date_to?: string
  refetchInterval?: number
}) {
  const { refetchInterval, ...queryParams } = params || {}
  // No page asked for means "all of them" — every screen that calls this
  // groups across the whole table. Taking the server's default page instead
  // handed the delivery screens 500 of 1,363 sales, and a truck whose sales
  // fell outside that window rendered as if it had none: the split vanished
  // and the allocation's own customer took the entire load. See fetchAllPages.
  const wantsEveryRow = params?.page === undefined && params?.limit === undefined
  return useQuery({
    queryKey: ['delivery-sales', queryParams],
    queryFn: async () => {
      if (wantsEveryRow) {
        return fetchAllPages<DeliverySale>('/delivery-sales', queryParams, (b) => b?.sales || b || [])
      }
      const res = await api.get('/delivery-sales', { params: queryParams })
      return (res.data.data?.sales || res.data.data || []) as DeliverySale[]
    },
    refetchInterval: refetchInterval ?? false,
  })
}

export function useDeliverySaleDetails(id: string) {
  return useQuery({
    queryKey: ['delivery-sales', id],
    queryFn: async () => {
      const res = await api.get(`/delivery-sales/${id}`)
      return res.data.data?.sale || res.data.data as DeliverySale
    },
    enabled: !!id,
  })
}

/** One end of a transfer — a truck-cycle, not a single payment row. */
export interface TransferCycle {
  truckNumber: string
  dateLoaded?: string
  depotLoaded?: string
  customerId?: number | null
  customerName?: string
  location?: string
  allocationCode?: string
}

/**
 * Move a truck's overpayment onto other trucks.
 *
 * One call rather than a debit and a credit issued separately: the server
 * writes both legs in a transaction, because a credit that lands without its
 * matching debit is money created out of nothing. It also recomputes the
 * available surplus from the table, so an amount this client got wrong is
 * refused rather than recorded.
 */
export function useTransferOverpayment() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    retry: false,
    mutationFn: async (body: {
      from: TransferCycle
      to: Array<TransferCycle & { amount: number }>
    }) => {
      const res = await api.post('/delivery-sales/transfer', body)
      return res.data as {
        data: { transferGroupId: string; moved: number; remaining: number }
        message: string
      }
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['delivery-sales'] })
      queryClient.invalidateQueries({ queryKey: ['delivery-inventory'] })
      toast.success(res.message)
    },
    onError: (err: any) => {
      toast.error(getErrorMessage(err))
    },
  })
}

/**
 * Close the load this sale was recorded against.
 *
 * A rate or a payment is only ever entered against a truck that has already
 * delivered, so recording one is the moment the load stops being in transit.
 * Nobody was doing that by hand — marking a truck offloaded lives on a
 * different screen from taking its money — so the In Transit count carried
 * loads that had been paid for weeks earlier.
 *
 * ── It will not guess ─────────────────────────────────────────────────────
 *
 * The plate is matched, then the allocation code where the sale carries one,
 * and the write happens only when that leaves exactly one open load. A truck
 * that ran the same code twice has two open rows and no way to tell from a
 * payment which trip it settles; picking one would silently close the wrong
 * trip, which is worse than closing neither. Nothing is lost by declining —
 * statusOf reads a load with money on it as sold regardless of this column,
 * so the screens are right either way. This only keeps the stored value from
 * drifting away from them.
 */
async function closeLoadFor(sale: Partial<DeliverySale>): Promise<void> {
  const paid = toNum(sale.rate) > 0 || Math.abs(toNum(sale.paymentAmount)) > 0
  if (!paid || !sale.truckNumber) return

  const res = await api.get('/delivery-inventory', {
    params: { truck_number: sale.truckNumber },
  })
  const rows = (res.data.data?.loadings || res.data.data?.inventory || res.data.data || []) as DeliveryInventory[]

  const plate = normalizePlate(sale.truckNumber)
  const code = (sale.allocationCode || '').trim().toUpperCase()
  const open = rows.filter(r =>
    normalizePlate(r.truckNumber) === plate &&
    r.loadingStatus !== 'offloaded' &&
    (!code || (r.allocationCode || '').trim().toUpperCase() === code),
  )
  if (open.length !== 1) return

  const target = open[0]
  await api.patch(`/delivery-inventory/${target._id || target.id}`, {
    loadingStatus: 'offloaded',
    dateOffloaded: sale.dateOfPayment || sale.dateLoaded || new Date().toISOString().slice(0, 10),
  })
}

export function useCreateDeliverySale() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    retry: false,
    mutationFn: async (data: Partial<DeliverySale>) => {
      const res = await api.post('/delivery-sales', data)
      // Deliberately swallowed: the sale is written and must not be reported
      // as failed because the tidying after it did not land. The screens read
      // the load as sold from the sale itself either way.
      try {
        await closeLoadFor(data)
      } catch {
        // no-op
      }
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['delivery-sales'] })
      queryClient.invalidateQueries({ queryKey: ['delivery-inventory'] })
      toast.success('Record saved successfully')
    },
    onError: (err: any) => {
      toast.error(getErrorMessage(err))
    },
  })
}

export function useUpdateDeliverySale() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    retry: false,
    mutationFn: async ({ id, data }: { id: string; data: Partial<DeliverySale> }) => {
      const res = await api.patch(`/delivery-sales/${id}`, data)
      // A rate typed onto a row that had none is the same event as recording
      // one — see closeLoadFor. The patch body carries only what changed, so
      // the sale as it now stands is read back off the response.
      try {
        await closeLoadFor({ ...(res.data?.data?.sale ?? res.data?.data ?? {}), ...data })
      } catch {
        // no-op
      }
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['delivery-sales'] })
      queryClient.invalidateQueries({ queryKey: ['delivery-inventory'] })
      toast.success('Record updated successfully')
    },
    onError: (err: any) => {
      toast.error(getErrorMessage(err))
    },
  })
}

/**
 * Confirm or un-confirm a hand-recorded deposit.
 *
 * Its own endpoint because the general update route deliberately refuses
 * depositStatus — it strips the field rather than erroring, which is why the
 * old toggle reported success while the status never moved.
 *
 * No toast of its own: the callers already report, and a toggle that fires
 * two notifications for one click reads as two things having happened.
 */
export function useSetDepositStatus() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    retry: false,
    mutationFn: async ({
      id,
      depositStatus,
    }: {
      id: string
      depositStatus: 'pending' | 'paid' | 'partial'
    }) => {
      const res = await api.patch(`/delivery-sales/${id}/deposit-status`, { depositStatus })
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['delivery-sales'] })
      queryClient.invalidateQueries({ queryKey: ['delivery-inventory'] })
    },
    onError: (err: any) => {
      toast.error(getErrorMessage(err))
    },
  })
}

export function useDeleteDeliverySale() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    retry: false,
    mutationFn: async (id: string) => {
      const res = await api.delete(`/delivery-sales/${id}`)
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['delivery-sales'] })
      queryClient.invalidateQueries({ queryKey: ['delivery-inventory'] })
      toast.success('Record deleted successfully')
    },
    onError: (err: any) => {
      toast.error(getErrorMessage(err))
    },
  })
}
