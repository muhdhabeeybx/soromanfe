import { useQuery } from '@tanstack/react-query'
import api from '#/lib/api/http'

export function useDashboardStats() {
  return useQuery({
    queryKey: ['dashboard', 'stats'],
    staleTime: 30_000,
    queryFn: async () => {
      const res = await api.get('/dashboard/stats')
      return res.data.data
    },
  })
}

export function useDashboardOverview(period: string = 'month') {
  return useQuery({
    queryKey: ['dashboard', 'overview', period],
    staleTime: 30_000,
    queryFn: async () => {
      const res = await api.get(`/dashboard/overview?period=${period}`)
      return res.data.data
    },
  })
}

/** One desk's backlog: how many things are waiting, and what to do about them. */
export interface WorkQueue {
  key: string
  /** The nav path this queue belongs to — what the sidebar badge keys off. */
  path: string
  label: string
  /** What to say when the count is zero. An empty queue is good news. */
  emptyLabel: string
  action: string
  count: number
  /** The count could not be computed; shown as unavailable rather than as 0. */
  failed: boolean
}

/**
 * How much work is waiting on the signed-in user, per desk.
 *
 * Feeds the sidebar's number badges and the landing page from one request, so
 * a badge can never disagree with the page it links to. Scoped server-side to
 * the user's own depots and PFIs.
 *
 * Refetched on window focus with a short stale time: these are queues other
 * people are also working, and a badge that is an hour stale is worse than no
 * badge — it sends somebody to an empty page.
 */
export function useWorkQueues() {
  return useQuery({
    queryKey: ['dashboard', 'work-queues'],
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const res = await api.get('/dashboard/work-queues')
      return res.data.data as { counts: Record<string, number>; queues: WorkQueue[] }
    },
  })
}
