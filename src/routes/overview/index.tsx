import { useMemo } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowRight, CheckCircle2, CircleAlert, LayoutDashboard } from 'lucide-react'

import { PageHeader } from '#/components/PageHeader'
import { Skeleton } from '#/components/ui/skeleton'
import { PageError } from '#/components/PageError'
import { useWorkQueues, type WorkQueue } from '#/lib/hooks/useDashboard'
import { useRoles } from '#/lib/hooks/useRoles'
import { useAuthStore } from '#/modules/auth'
import { canAccessRoute, isSuperAdmin, ROLE_STRING_TO_ID } from '#/lib/rbac'
import { navCategories } from '#/components/layout/nav-config'
import { formatNumber } from '#/lib/format'
import { cn } from '#/lib/utils'
import { PANEL, MICRO, PANEL_RAIL, PANEL_BODY } from '#/lib/panel'
import { routeGuard } from '#/lib/route-guard'

/**
 * My Dashboard — what is waiting on you, the landing page every role gets.
 *
 * This replaced the full company dashboard as the page login points at. That
 * page showed revenue, PFI stock, fleet utilisation and a depot leaderboard to
 * a gate-security officer whose entire job is on one other screen, and it was
 * the first thing all forty-odd roles saw every morning.
 *
 * The company overview still exists, at /company-dashboard, for the people
 * whose job is the company rather than a desk within it.
 *
 * Nothing here is role-specific by configuration. A queue shows if that person
 * can open the page behind it, and the counts are scoped server-side to their
 * own depots and PFIs — so a Warri ticketing clerk sees Warri's ticketing
 * backlog and nothing else, without anybody maintaining a list of what each
 * role should be shown.
 */
export const Route = createFileRoute('/overview/')({
  beforeLoad: () => routeGuard('/overview'),
  component: MyDashboard,
})

/** Morning / afternoon / evening, by the reader's own clock. */
function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function QueueCard({ queue }: { queue: WorkQueue }) {
  const waiting = queue.count > 0
  return (
    <Link
      to={queue.path as any}
      className={cn(
        'group flex items-start gap-3 rounded-lg border p-4 transition-colors',
        waiting
          ? 'border-foreground/15 bg-background hover:border-primary/40 hover:bg-accent/40'
          : 'border-foreground/10 bg-muted/20 hover:bg-muted/40',
      )}
    >
      <div className="min-w-0 flex-1">
        <p className={cn('font-medium', !waiting && 'text-muted-foreground')}>
          {waiting ? queue.label : queue.emptyLabel}
        </p>
        <p className={cn(MICRO, 'mt-1 text-muted-foreground')}>
          {/* A failed count says so. Showing 0 would read as "all clear", which
              is the one thing an uncomputable count must never claim. */}
          {queue.failed ? 'Count unavailable right now' : waiting ? queue.action : 'Nothing to do here'}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {waiting ? (
          <span className="rounded-full bg-primary px-2.5 py-1 text-sm font-semibold tabular-nums text-primary-foreground">
            {formatNumber(queue.count)}
          </span>
        ) : (
          <CheckCircle2 className="size-5 text-success" />
        )}
        <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </div>
    </Link>
  )
}

function MyDashboard() {
  const user = useAuthStore((s) => s.user)
  const { userRoles } = useRoles()
  const { data, isLoading, isError, error, refetch } = useWorkQueues()

  const pageOverrides = useMemo(() => {
    const map: Record<string, boolean> = {}
    for (const o of user?.pageOverrides || []) map[o.routePath] = o.allowed
    return map
  }, [user?.pageOverrides])

  /**
   * Only queues whose page this person can actually open.
   *
   * Sending someone to a page they will be bounced off is worse than not
   * mentioning the work at all.
   */
  const queues = useMemo(
    () => (data?.queues || []).filter((q) => canAccessRoute(userRoles, q.path, pageOverrides)),
    [data?.queues, userRoles, pageOverrides],
  )

  const waiting = queues.filter((q) => q.count > 0)
  const clear = queues.filter((q) => q.count === 0)

  /** The company dashboard is for the people whose job is the whole company. */
  const canSeeCompany =
    isSuperAdmin(userRoles) || userRoles.includes(ROLE_STRING_TO_ID.admin)

  /**
   * A short list of the pages this person actually has, for getting somewhere
   * on a morning with an empty queue. Taken from the same nav config the
   * sidebar uses, so it cannot drift from what they can really reach.
   */
  const shortcuts = useMemo(() => {
    const items: { title: string; path: string; icon: React.ComponentType<{ className?: string }> }[] = []
    for (const group of navCategories) {
      for (const item of group.items) {
        // This page, and the one already offered as a button in the header.
        if (item.path === '/overview' || item.path === '/company-dashboard') continue
        if (!canAccessRoute(userRoles, item.path, pageOverrides)) continue
        items.push(item)
      }
    }
    return items.slice(0, 8)
  }, [userRoles, pageOverrides])

  const header = (
    <PageHeader
      eyebrow="My dashboard"
      title={`${greeting()}, ${user?.firstName || 'there'}`}
      description={
        isLoading
          ? 'Checking what needs your attention…'
          : waiting.length === 0
            ? 'Nothing is waiting on you right now.'
            : `${waiting.length === 1 ? 'One queue needs' : `${waiting.length} queues need`} your attention.`
      }
      actions={
        canSeeCompany ? (
          <Link
            to={'/company-dashboard' as any}
            className="inline-flex items-center gap-2 rounded-lg border border-foreground/15 px-3 py-2 text-sm transition-colors hover:bg-accent"
          >
            <LayoutDashboard className="size-4" />
            Company overview
          </Link>
        ) : undefined
      }
    />
  )

  if (isLoading) {
    return (
      <div className="animate-fade-in space-y-6">
        {header}
        <section className={PANEL}>
          <div className={PANEL_RAIL}><span className={MICRO}>Waiting on you</span></div>
          <div className={cn(PANEL_BODY, 'grid gap-3 sm:grid-cols-2')}>
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 rounded-lg" />)}
          </div>
        </section>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="animate-fade-in space-y-6">
        {header}
        <PageError
          message={(error as Error)?.message || 'Could not load your work queues.'}
          onRetry={() => refetch()}
        />
      </div>
    )
  }

  return (
    <div className="animate-fade-in space-y-6">
      {header}

      <section className={PANEL} aria-label="Waiting on you">
        <div className={PANEL_RAIL}>
          <span className={MICRO}>Waiting on you</span>
        </div>
        <div className={cn(PANEL_BODY, 'space-y-3')}>
          {queues.length === 0 ? (
            // Not an error state: plenty of roles have no queue of their own,
            // and telling them "nothing to do" would be wrong. Point them at
            // their pages instead.
            <p className="flex items-start gap-2 rounded-lg border border-foreground/15 bg-muted/20 p-4 text-sm text-muted-foreground">
              <CircleAlert className="mt-0.5 size-4 shrink-0" />
              None of the tracked queues belong to your role. Your pages are below.
            </p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                {waiting.map((q) => <QueueCard key={q.key} queue={q} />)}
              </div>
              {clear.length > 0 && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {clear.map((q) => <QueueCard key={q.key} queue={q} />)}
                </div>
              )}
            </>
          )}
        </div>
      </section>

      {shortcuts.length > 0 && (
        <section className={PANEL} aria-label="Your pages">
          <div className={PANEL_RAIL}>
            <span className={MICRO}>Your pages</span>
          </div>
          <div className={cn(PANEL_BODY, 'grid gap-2 sm:grid-cols-2 lg:grid-cols-4')}>
            {shortcuts.map((item) => (
              <Link
                key={item.path}
                to={item.path as any}
                className="group flex items-center gap-2.5 rounded-lg border border-foreground/10 px-3 py-2.5 text-sm transition-colors hover:border-primary/40 hover:bg-accent/40"
              >
                <item.icon className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{item.title}</span>
                <ArrowRight className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
