import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import api from '#/lib/api/http'
import { getErrorMessage } from '#/lib/utils'
import { useToast } from '#/lib/hooks/useToast'

/**
 * The bell's inbox.
 *
 * The API for this has existed all along — a per-staff feed, an unread count,
 * mark-read, mark-all-read, even an SSE stream — and the bell in the navbar
 * called none of it. It held `const notifications = []` and `const unreadCount
 * = 0`, so it rendered "No notifications yet" whatever had happened.
 */

export interface AppNotification {
  id: number
  type: string
  category: string | null
  title: string
  body: string
  /** Where the notification wants to send you, when it knows. */
  actionUrl?: string | null
  readAt: string | null
  createdAt: string
}

/** Newest first. Small page: this is a dropdown, not an inbox page. */
export function useNotifications(limit = 12) {
  return useQuery({
    queryKey: ['notifications', 'list', limit],
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const res = await api.get('/notifications', { params: { page: 1, limit } })
      const payload = res.data?.data
      return {
        items: (payload?.data || []) as AppNotification[],
        unreadCount: Number(payload?.unreadCount ?? 0),
      }
    },
  })
}

/**
 * The unread count on its own, polled.
 *
 * Separate from the list so the dot on the bell stays current without
 * refetching a dozen rows the user has not opened the menu to see.
 */
export function useUnreadNotificationCount() {
  return useQuery({
    queryKey: ['notifications', 'unread-count'],
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const res = await api.get('/notifications/unread-count')
      return Number(res.data?.data?.unreadCount ?? 0)
    },
  })
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => (await api.patch(`/notifications/${id}/read`)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: async () => (await api.post('/notifications/read-all', {})).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  })
}
