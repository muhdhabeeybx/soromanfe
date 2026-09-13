import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '#/lib/api/http'
import { useToast } from '#/lib/hooks/useToast'
import { getErrorMessage } from '#/lib/utils'

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

// ── Desk backlogs, and chasing them ─────────────────────────────────────────

/**
 * What is sitting on each desk, company-wide, with the staff a text would
 * reach.
 *
 * Distinct from useWorkQueues, which answers "what is waiting on ME". This
 * answers "what is waiting on anybody, and who do I chase" — the question an
 * admin asks, and the reason it carries contacts rather than just counts.
 */
export interface DeskBacklog {
  desk: 'tickets' | 'entry' | 'exit'
  count: number
  hours: number
  oldestHours: number
  examples: string[]
  depots: string[]
  contacts: Array<{
    id: number
    name: string
    phone: string | null
    email: string | null
    reachable: boolean
  }>
}

export function useDeskBacklogs() {
  return useQuery({
    queryKey: ['dashboard', 'desk-nudges'],
    staleTime: 60_000,
    queryFn: async () => {
      const res = await api.get('/dashboard/desk-nudges')
      return (res.data?.data?.desks || []) as DeskBacklog[]
    },
  })
}

/** Send the in-app nudge to every desk with a backlog, now. */
export function useSendDeskNudges() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: async () => (await api.post('/dashboard/desk-nudges/notify', {})).data,
    onSuccess: (res) => {
      toast.success(res?.message || 'Desks notified')
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  })
}

/**
 * Text one desk.
 *
 * `dryRun` returns the exact message and recipient list without sending, which
 * is what the confirm dialog shows — nobody should discover who was texted
 * afterwards.
 */
export function useSmsDesk() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: async ({ desk, dryRun }: { desk: string; dryRun?: boolean }) => {
      const res = await api.post('/dashboard/desk-nudges/sms', { desk, dryRun: dryRun === true })
      return res.data as {
        success: boolean
        message: string
        data: {
          text?: string
          wouldText?: Array<{ name: string; phone: string | null }>
          sent?: Array<{ name: string }>
          failed?: Array<{ name: string; error?: string }>
          unreachable?: Array<{ name: string }>
        }
      }
    },
    onSuccess: (res, vars) => {
      if (vars.dryRun) return
      if (res.success) toast.success(res.message)
      else toast.error(res.message)
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'desk-nudges'] })
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  })
}
