import { useState, useEffect } from 'react'
import {
  Menu,
  Search,
  Bell,
  LogOut,
  ChevronsLeft,
  ChevronsRight,
  Sun,
  Moon,
  Monitor,
  Check,
  SidebarCloseIcon,
  SidebarOpenIcon,
} from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Separator } from '#/components/ui/separator'
import { Avatar, AvatarFallback } from '#/components/ui/avatar'
import { StatusChip } from '#/components/ui/status-chip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { useAuthStore, useAdminLogout } from '#/modules/auth'
import { useLayoutStore, type ThemePreference } from '#/stores/layoutStore'
import { MICRO } from '#/lib/panel'
import CommandPalette from './CommandPalette'
import {
  useNotifications, useUnreadNotificationCount,
  useMarkNotificationRead, useMarkAllNotificationsRead,
} from '#/lib/hooks/useNotifications'
import { useWorkQueues } from '#/lib/hooks/useDashboard'
import { Link } from '@tanstack/react-router'

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
]

export default function Navbar() {
  const {
    isCollapsed,
    toggleCollapsed,
    toggleMobileOpen,
    themePreference,
    setTheme,
  } = useLayoutStore()
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const user = useAuthStore((s) => s.user)
  const logoutMutation = useAdminLogout()

  // Notifications are not yet integrated with the backend.
  // When a notification API is available, replace this with a useQuery hook.
  /**
   * The bell, connected to the feed that was always there.
   *
   * This held two hardcoded values — an empty array and a zero — so it read
   * "No notifications yet" no matter what had happened, while a per-staff
   * inbox, an unread count and a live stream sat unused on the API.
   */
  const { data: inbox } = useNotifications()
  const { data: polledUnread } = useUnreadNotificationCount()
  const markRead = useMarkNotificationRead()
  const markAllRead = useMarkAllNotificationsRead()
  const notifications = inbox?.items ?? []
  // The polled count is the fresher of the two; the list's own figure covers
  // the moment before the first poll returns.
  const unreadCount = polledUnread ?? inbox?.unreadCount ?? 0

  /**
   * What is waiting on this person, from the same source as the sidebar
   * badges and the overview page — so the bell cannot disagree with either.
   *
   * Shown above the inbox because it is the answer to "what should I do now",
   * which is the question somebody opens this menu with. A notification says
   * what happened; a queue says what is still undone.
   */
  const { data: workQueues } = useWorkQueues()
  const pendingTasks = (workQueues?.queues ?? []).filter((q) => q.count > 0)
  const pendingTotal = pendingTasks.reduce((sum, q) => sum + q.count, 0)

  const initials = user
    ? `${user.firstName?.[0] || ''}${user.surname?.[0] || ''}`.toUpperCase()
    : 'A'

  const displayName = user ? `${user.firstName} ${user.surname}` : 'Admin'
  const displayEmail = user?.email || 'admin@soroman.com'

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setCommandPaletteOpen((prev) => !prev)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const handleLogout = async () => {
    try {
      await logoutMutation.mutateAsync()
    } catch {
      // Logout may fail if server is unreachable; clear local session anyway
    }
    window.location.href = '/login'
  }

  return (
    <>
      <header className="sticky top-0 z-30 flex h-12 w-full shrink-0 items-center justify-between gap-2 border-b border-border bg-background/80 px-4 backdrop-blur-md">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={toggleMobileOpen}
            className="md:hidden"
          >
            <Menu />
            <span className="sr-only">Toggle navigation menu</span>
          </Button>

          <Button
            variant="ghost"
            size="icon-sm"
            onClick={toggleCollapsed}
            className="-ml-1 hidden text-muted-foreground hover:text-foreground md:flex"
          >
            {isCollapsed ? <SidebarOpenIcon /> : <SidebarCloseIcon />}
            <span className="sr-only">
              {isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            </span>
          </Button>

          <button
            type="button"
            onClick={() => setCommandPaletteOpen(true)}
            className="relative ml-auto hidden h-7 w-64 cursor-pointer items-center justify-between rounded-lg border border-input px-2.5 text-sm text-muted-foreground transition-colors duration-250 ease-luxe outline-none hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:flex lg:w-80 dark:bg-input/30"
          >
            <span className="flex items-center gap-2 truncate">
              <Search className="size-3.5 shrink-0" />
              <span className="truncate">Search dashboard…</span>
            </span>
            <kbd className="pointer-events-none inline-flex h-5 items-center gap-0.5 rounded border border-border bg-muted px-1.5 font-mono text-xs font-normal select-none">
              {navigator.userAgent?.includes('Mac') ? '⌘' : 'Ctrl+'}K
            </kbd>
          </button>

          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setCommandPaletteOpen(true)}
            className="ml-auto md:hidden"
          >
            <Search />
            <span className="sr-only">Open search</span>
          </Button>
        </div>

        <div className="flex items-center gap-1">
          {/* Appearance is a three-option menu, never a blind flip — system
              preference has to stay reachable. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" className="relative">
                <Sun className="size-4 scale-100 rotate-0 transition-transform duration-700 ease-luxe dark:scale-0 dark:-rotate-90" />
                <Moon className="absolute size-4 scale-0 rotate-90 transition-transform duration-700 ease-luxe dark:scale-100 dark:rotate-0" />
                <span className="sr-only">Change appearance</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
                <DropdownMenuItem
                  key={value}
                  onClick={() => setTheme(value)}
                  className="cursor-pointer"
                >
                  <Icon />
                  <span className="flex-1">{label}</span>
                  {themePreference === value && (
                    <Check className="size-3.5 text-accent" />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" className="relative">
                <Bell />
                {/* One dot for either kind of attention: something unread, or
                    something still waiting to be done. */}
                {(unreadCount > 0 || pendingTotal > 0) && (
                  <span
                    aria-hidden
                    className="absolute top-1 right-1 size-1.5 rounded-full bg-accent"
                  />
                )}
                <span className="sr-only">
                  {`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
                  {pendingTotal > 0 ? `, ${pendingTotal} task${pendingTotal === 1 ? '' : 's'} waiting` : ''}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-[70svh] w-96 overflow-y-auto p-0">
              {/*
                Waiting on you, first.

                Somebody opens this menu asking "what should I do now", and a
                queue answers that where a notification only says what already
                happened. Same source as the sidebar badges and the overview
                page, so the three cannot disagree.
              */}
              {pendingTasks.length > 0 && (
                <>
                  <div className="flex items-center justify-between border-b border-foreground/15 px-3 py-2.5">
                    <span className={MICRO}>Waiting on you</span>
                    <StatusChip tone="warning">{pendingTotal}</StatusChip>
                  </div>
                  <div className="p-1">
                    {pendingTasks.map((q) => (
                      <DropdownMenuItem key={q.key} asChild className="cursor-pointer p-0">
                        <Link to={q.path as string} className="flex w-full items-start gap-2 p-3">
                          <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-warning" />
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium">{q.label}</span>
                            <span className="block text-xs text-muted-foreground">{q.action}</span>
                          </span>
                          <span className="shrink-0 text-sm font-semibold tabular-nums">{q.count}</span>
                        </Link>
                      </DropdownMenuItem>
                    ))}
                  </div>
                </>
              )}

              <div className="flex items-center justify-between border-y border-foreground/15 px-3 py-2.5">
                <span className={MICRO}>Notifications</span>
                <div className="flex items-center gap-2">
                  {unreadCount > 0 && <StatusChip tone="accent">{unreadCount} new</StatusChip>}
                  {unreadCount > 0 && (
                    <button
                      type="button"
                      className="cursor-pointer text-xs text-muted-foreground hover:text-foreground"
                      onClick={(e) => { e.preventDefault(); markAllRead.mutate() }}
                    >
                      Mark all read
                    </button>
                  )}
                </div>
              </div>
              <div className="p-1">
                {notifications.length === 0 ? (
                  <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                    {pendingTasks.length > 0 ? 'Nothing new to report' : 'No notifications yet'}
                  </div>
                ) : (
                  notifications.map((n) => (
                    <DropdownMenuItem
                      key={n.id}
                      className="flex cursor-pointer flex-col items-start gap-0.5 p-3"
                      onClick={() => { if (!n.readAt) markRead.mutate(n.id) }}
                    >
                      <div className="flex w-full justify-between gap-2">
                        <span className="text-sm font-medium">{n.title}</span>
                        {!n.readAt && (
                          <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" />
                        )}
                      </div>
                      {n.body && (
                        <span className="line-clamp-2 text-xs text-muted-foreground">{n.body}</span>
                      )}
                      <span className="text-xs text-muted-foreground/70">
                        {new Date(n.createdAt).toLocaleString('en-GB', {
                          day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                        })}
                      </span>
                    </DropdownMenuItem>
                  ))
                )}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          <Separator orientation="vertical" className="mx-1 hidden h-5 sm:block" />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" className="rounded-full">
                <Avatar size="sm">
                  <AvatarFallback className="text-xs font-normal">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <span className="sr-only">User menu</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56" align="end">
              <div className="px-2 py-1.5">
                <p className="truncate text-sm font-normal">{displayName}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {displayEmail}
                </p>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                className="cursor-pointer"
                onClick={handleLogout}
              >
                <LogOut />
                Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <CommandPalette open={commandPaletteOpen} onOpenChange={setCommandPaletteOpen} />
    </>
  )
}
