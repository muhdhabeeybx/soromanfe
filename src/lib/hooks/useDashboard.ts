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

/**
 * The company overview for a window.
 *
 * Takes the query params the period control produces — either `period=<preset>`
 * or an explicit `from`/`to` — rather than a preset string, so a custom range
 * needs no separate hook. The response carries the resolved window and its
 * label back, which is what every panel on the page prints.
 */
export function useDashboardOverview(params: Record<string, string>) {
  return useQuery({
    queryKey: ['dashboard', 'overview', params],
    staleTime: 30_000,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const res = await api.get('/dashboard/overview', { params })
      return res.data.data
    },
  })
}

/** One entry in the activity log. */
export interface ActivityEntry {
  id: number
  action: string
  entityType: string
  entityId: string
  prevState: string | null
  newState: string | null
  actorType: string
  actorName: string | null
  createdAt: string
  metadata: Record<string, unknown> | null
}

/**
 * The activity log, paginated.
 *
 * The overview shows the newest ten from the same endpoint, so the feed there
 * and the full page can never tell different stories.
 */
export function useActivity(params: {
  page?: number
  limit?: number
  entityType?: string
  action?: string
  from?: string
  to?: string
} = {}) {
  return useQuery({
    queryKey: ['dashboard', 'activity', params],
    staleTime: 30_000,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const res = await api.get('/dashboard/activity', { params })
      return res.data.data as {
        activity: ActivityEntry[]
        pagination: { page: number; limit: number; total: number; pages: number }
      }
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
  /**
   * Roles that personally clear this queue, or null where nobody owns it.
   *
   * Drives whether the landing page words a queue as the reader's own job or
   * as something the business is waiting on. Only expenses has an owner —
   * final approval rests with admin and super admin.
   */
  approverRoles: number[] | null
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
