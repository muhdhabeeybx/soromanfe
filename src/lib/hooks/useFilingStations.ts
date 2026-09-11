import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '#/lib/api/http'
import { useToast } from '#/lib/hooks/useToast'
import { getErrorMessage } from '#/lib/utils'
import type { FilingStation } from '#/lib/types'

export function useFilingStations(params?: { search?: string, page?: number, limit?: number }) {
  return useQuery({
    queryKey: ['filing-stations', params],
    queryFn: async () => {
      const res = await api.get('/filing-stations', { params })
      return (res.data.data.stations || []) as FilingStation[]
    },
  })
}

export function useFilingStationDetails(id: string) {
  return useQuery({
    queryKey: ['filing-stations', id],
    queryFn: async () => {
      const res = await api.get(`/filing-stations/${id}`)
      return res.data.data.station as FilingStation
    },
    enabled: !!id,
  })
}

export function useCreateFilingStation() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    retry: false,
    mutationFn: async (data: Partial<FilingStation>) => {
      const res = await api.post('/filing-stations', data)
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['filing-stations'] })
      toast.success('Filing station created successfully')
    },
    onError: (err: any) => {
      toast.error(getErrorMessage(err))
    },
  })
}

export function useUpdateFilingStation() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    retry: false,
    mutationFn: async ({ id, data }: { id: string; data: Partial<FilingStation> }) => {
      const res = await api.patch(`/filing-stations/${id}`, data)
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['filing-stations'] })
      toast.success('Filing station updated successfully')
    },
    onError: (err: any) => {
      toast.error(getErrorMessage(err))
    },
  })
}

export function useDeleteFilingStation() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    retry: false,
    mutationFn: async (id: string) => {
      const res = await api.delete(`/filing-stations/${id}`)
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['filing-stations'] })
      toast.success('Filing station deleted successfully')
    },
    onError: (err: any) => {
      toast.error(getErrorMessage(err))
    },
  })
}

// ── Closing a delivery cycle ────────────────────────────────────────────────

/**
 * A filling-station delivery cycle's status.
 *
 * A cycle is a loading with the sales that answer to it, assembled on the way
 * to the screen — there is no cycle row — so this is keyed by the register's
 * own group key, used verbatim. A key with no entry here is active, which is
 * why nothing had to be backfilled. See migration 0029.
 */
export interface StationCycleStatus {
  cycleKey: string
  status: 'active' | 'completed'
  /** Null on an active cycle: reopening clears the last close rather than keeping it. */
  closedAt: string | null
  closedBy: string
  note: string
}

/** Every cycle that has been closed, keyed by its group key. */
export function useStationCycleStatuses() {
  return useQuery({
    queryKey: ['station-cycle-statuses'],
    queryFn: async () => {
      const res = await api.get('/filing-stations/cycles')
      return (res.data?.data?.cycles || {}) as Record<string, StationCycleStatus>
    },
  })
}

/**
 * Close a cycle, or reopen it.
 *
 * The key goes in the body rather than the path: it carries a location the
 * user typed, slashes included, and that is a routing accident waiting to
 * happen however carefully it is encoded.
 *
 * Closing touches nothing else — not the loading, not its sales, not their
 * payments, not the batch the load belongs to.
 */
export function useSetStationCycleStatus() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMutation({
    mutationFn: async ({ key, label, status, note }: {
      key: string
      /** What to call it in the toast — the station and its truck. */
      label: string
      status: 'active' | 'completed'
      note?: string
    }) => {
      const res = await api.patch('/filing-stations/cycles', { key, status, note })
      return { label, status, cycle: res.data?.data?.cycle as StationCycleStatus }
    },
    onSuccess: ({ label, status }) => {
      toast.success(status === 'completed' ? `${label} closed` : `${label} reopened`)
      queryClient.invalidateQueries({ queryKey: ['station-cycle-statuses'] })
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  })
}
