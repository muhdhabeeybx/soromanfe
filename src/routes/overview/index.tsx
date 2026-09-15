import { useMemo, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import {
  ArrowRight, CheckCircle2, ChevronDown, CircleAlert, Download, FileQuestion, LayoutDashboard,
  Loader2, UserX,
} from 'lucide-react'

import { PageHeader } from '#/components/PageHeader'
import { Skeleton } from '#/components/ui/skeleton'
import { PageError } from '#/components/PageError'
import {
  useWorkQueues, useDeskBacklogs, useSendDeskNudges, useSmsDesk, useDeskAssignments,
  type DeskAssignments,
  type WorkQueue, type DeskBacklog,
} from '#/lib/hooks/useDashboard'
import { ConfirmDialog } from '#/components/ConfirmDialog'
import { Button } from '#/components/ui/button'
import { BellRing, MessageSquare } from 'lucide-react'
import { useRoles } from '#/lib/hooks/useRoles'
import { useToast } from '#/lib/hooks/useToast'
import { useAuthStore } from '#/modules/auth'
import { canAccessRoute, isSuperAdmin, ROLE_STRING_TO_ID } from '#/lib/rbac'
import { navCategories } from '#/components/layout/nav-config'
import { formatNumber } from '#/lib/format'
import { cn, getErrorMessage } from '#/lib/utils'
import { PANEL, MICRO, PANEL_RAIL, PANEL_BODY } from '#/lib/panel'
import { routeGuard } from '#/lib/route-guard'
import { exportAllDeskTasks, exportPersonTasks } from './-desk-tasks-export'

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

  /** The company overview is for the people whose job is the whole company. */
  const canSeeCompany =
    isSuperAdmin(userRoles) || userRoles.includes(ROLE_STRING_TO_ID.admin)

  /**
   * Is this queue the reader's own job, or something they are watching?
   *
   * Admin and super admin hold general access — they can open every desk's
   * page without any of that work being theirs to do. Telling them five
   * queues are "waiting on you" reads as an accusation and, worse, as a claim
   * that they are the bottleneck on work belonging to finance, ticketing and
   * the gate.
   *
   * Expenses is the exception, and a real one: final approval rests with them
   * and nobody else can clear it. So a queue is personal when it names roles
   * the reader holds; for anyone who is not an admin, their queues are their
   * own as before.
   */
  const isMine = (q: WorkQueue) =>
    !canSeeCompany || Boolean(q.approverRoles?.some((r) => userRoles.includes(r)))

  const mine = queues.filter(isMine)
  const overseeing = queues.filter((q) => !isMine(q))

  const waitingOnMe = mine.filter((q) => q.count > 0)
  const waitingElsewhere = overseeing.filter((q) => q.count > 0)
  const totalWaiting = waitingOnMe.length + waitingElsewhere.length

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
          ? 'Checking what needs attention…'
          : totalWaiting === 0
            ? canSeeCompany
              ? 'Every queue is clear.'
              : 'Nothing is waiting on you right now.'
            : canSeeCompany
              // Impersonal for an admin: these are the desks' queues, not
              // theirs, and only the approval one is actually on them.
              ? `${totalWaiting === 1 ? 'One queue is' : `${totalWaiting} queues are`} awaiting action` +
                (waitingOnMe.length > 0 ? ', including one that needs your approval.' : '.')
              : `${totalWaiting === 1 ? 'One queue needs' : `${totalWaiting} queues need`} your attention.`
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
          <div className={PANEL_RAIL}><span className={MICRO}>Work queues</span></div>
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

      {/* Two sections for an admin — the one queue that is genuinely theirs,
          then everything they are simply watching. One section for everyone
          else, because all of their queues are their own. */}
      {mine.length > 0 && (
        <section className={PANEL} aria-label={canSeeCompany ? 'Needs your approval' : 'Waiting on you'}>
          <div className={PANEL_RAIL}>
            <span className={MICRO}>{canSeeCompany ? 'Needs your approval' : 'Waiting on you'}</span>
          </div>
          <div className={cn(PANEL_BODY, 'grid gap-3 sm:grid-cols-2')}>
            {mine.map((q) => <QueueCard key={q.key} queue={q} />)}
          </div>
        </section>
      )}

      {overseeing.length > 0 && (
        <section className={PANEL} aria-label="Awaiting action">
          <div className={PANEL_RAIL}>
            <span className={MICRO}>Awaiting action</span>
            <span className="text-xs text-muted-foreground">
              Across the desks you oversee
            </span>
          </div>
          <div className={cn(PANEL_BODY, 'grid gap-3 sm:grid-cols-2')}>
            {overseeing.map((q) => <QueueCard key={q.key} queue={q} />)}
          </div>
        </section>
      )}

      {/*
        Chasing the desks. Admins only — this is the company's backlog, not
        the reader's own, and the actions on it reach other people's phones.

        It sits under the personal queues rather than above them because
        "what should I do" comes before "who should I chase".
      */}
      {canSeeCompany && <DeskBacklogPanel />}

      {queues.length === 0 && (
        <section className={PANEL}>
          <div className={PANEL_RAIL}><span className={MICRO}>Your work</span></div>
          <div className={PANEL_BODY}>
            {/* Not an error state: plenty of roles have no tracked queue, and
                telling them "nothing to do" would be wrong. */}
            <p className="flex items-start gap-2 rounded-lg border border-foreground/15 bg-muted/20 p-4 text-sm text-muted-foreground">
              <CircleAlert className="mt-0.5 size-4 shrink-0" />
              None of the tracked queues belong to your role. Your pages are below.
            </p>
          </div>
        </section>
      )}

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

/**
 * The company's backlogs, and the two ways of chasing them.
 *
 * Separate from the queue cards above, which are about the reader. This is
 * about everybody else: what each desk is sitting on, who is on that desk, and
 * a way to reach them. It only renders for somebody who can act on it.
 *
 * A desk with nothing waiting is drawn quiet rather than hidden — "the gate is
 * clear" is worth seeing, and a panel whose contents move around as queues
 * empty is harder to read than one whose rows stay put.
 */
function DeskBacklogPanel() {
  const { data: desks = [], isLoading } = useDeskBacklogs()
  // Who owes what. Separate request because it is admin-only and much heavier
  // than the counts — the panel still renders without it.
  const { data: assignments = [] } = useDeskAssignments()
  const byDesk = useMemo(
    () => new Map(assignments.map((a) => [a.desk, a])),
    [assignments],
  )

  /**
   * Which download is running, by key, so one spinner shows on the button that
   * was actually pressed rather than on all of them.
   */
  const [downloading, setDownloading] = useState<string | null>(null)
  const toast = useToast()
  const download = async (key: string, run: () => Promise<void>) => {
    setDownloading(key)
    try {
      await run()
    } catch (e) {
      toast.error(getErrorMessage(e))
    } finally {
      setDownloading(null)
    }
  }
  const sendNudges = useSendDeskNudges()
  const smsDesk = useSmsDesk()

  /** The desk a text has been asked for, holding the previewed message. */
  const [texting, setTexting] = useState<{
    desk: DeskBacklog
    text: string
    recipients: Array<{ name: string; phone: string | null }>
  } | null>(null)

  const NAMES: Record<string, { label: string; action: string }> = {
    tickets: { label: 'Awaiting loading tickets', action: 'Generate them' },
    entry: { label: 'Trucks not gated in', action: 'Record their entry' },
    exit: { label: 'Trucks still on the yard', action: 'Gate them out' },
  }

  const withWork = desks.filter((d) => d.count > 0)
  if (isLoading || desks.length === 0) return null

  const waited = (h: number) => (h >= 48 ? `${Math.floor(h / 24)} days` : `${h} hours`)

  return (
    <section className={PANEL} aria-label="Desk backlogs">
      <div className={PANEL_RAIL}>
        <span className={MICRO}>Desk backlogs</span>
        {withWork.length > 0 && (
          <div className="ml-auto flex gap-2">
            {/* One book, a sheet per person — what an admin walks into a
                meeting with. */}
            {assignments.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={downloading !== null}
                onClick={() => download('all', () => exportAllDeskTasks(assignments))}
              >
                {downloading === 'all'
                  ? <Loader2 className="size-3.5 animate-spin" />
                  : <Download className="size-3.5" />}
                Download all tasks
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={sendNudges.isPending}
              onClick={() => sendNudges.mutate()}
            >
              <BellRing className="size-3.5" />
              Notify all desks
            </Button>
          </div>
        )}
      </div>

      <div className={cn(PANEL_BODY, 'space-y-3')}>
        {desks.map((d) => {
          const meta = NAMES[d.desk] || { label: d.desk, action: '' }
          const reachable = d.contacts.filter((c) => c.reachable)
          return (
            <div
              key={d.desk}
              className={cn(
                'rounded-lg border p-3',
                d.count > 0 ? 'border-warning/30 bg-warning/5' : 'border-foreground/10 bg-muted/20',
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">
                    {d.count > 0 ? `${d.count} ${meta.label.toLowerCase()}` : `${meta.label} — clear`}
                  </p>
                  {d.count > 0 && (
                    <p className={cn(MICRO, 'mt-0.5 text-muted-foreground')}>
                      Oldest waiting {waited(d.oldestHours)}
                      {d.depots?.length ? ` · ${d.depots.join(', ')}` : ''}
                      {` · ${d.contacts.length} on this desk`}
                      {reachable.length < d.contacts.length
                        ? `, ${d.contacts.length - reachable.length} with no number`
                        : ''}
                    </p>
                  )}
                </div>

                {d.count > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    disabled={reachable.length === 0 || smsDesk.isPending}
                    title={reachable.length === 0 ? 'Nobody on this desk has a phone number on file' : undefined}
                    onClick={async () => {
                      // Preview first, always. Nobody should find out who was
                      // texted after the fact.
                      const res = await smsDesk.mutateAsync({ desk: d.desk, dryRun: true })
                      setTexting({
                        desk: d,
                        text: res.data?.text || '',
                        recipients: res.data?.wouldText || [],
                      })
                    }}
                  >
                    <MessageSquare className="size-3.5" />
                    Text the desk
                  </Button>
                )}
              </div>

              {/* Whose it is. A count belongs to nobody, which is how a queue
                  sitting for months becomes everybody's and therefore no-one's. */}
              {d.count > 0 && (
                <DeskResponsibility
                  assignments={byDesk.get(d.desk)}
                  allDesks={assignments}
                  downloading={downloading}
                  onDownload={download}
                />
              )}
            </div>
          )
        })}
      </div>

      {/* The text, and who gets it, before it goes. */}
      <ConfirmDialog
        open={texting !== null}
        onOpenChange={(open: boolean) => { if (!open) setTexting(null) }}
        title={texting ? `Text ${texting.recipients.length} people on the ${texting.desk.desk} desk?` : ''}
        description="This sends an SMS to each of them now. It costs money and reaches personal phones, so it is worth being sure."
        confirmLabel="Send the text"
        loading={smsDesk.isPending}
        onConfirm={async () => {
          if (!texting) return
          await smsDesk.mutateAsync({ desk: texting.desk.desk })
          setTexting(null)
        }}
      >
        {texting && (
          <div className="space-y-2">
            <p className="rounded-lg border border-foreground/15 bg-muted/30 p-3 text-sm">
              {texting.text}
            </p>
            <p className="text-xs text-muted-foreground">
              {texting.recipients.map((r: { name: string }) => r.name).join(', ')}
            </p>
          </div>
        )}
      </ConfirmDialog>
    </section>
  )
}

/**
 * Who is responsible, and for exactly what.
 *
 * The panel above says a desk has ten orders waiting. This says Usman Ibrahim
 * has five of them at Liquid Bulk and Sadeeq Umar has thirty-nine at Calabar,
 * and names the orders. An admin chasing a backlog needs a person and a
 * reference, not a total.
 *
 * Work with nobody scoped to it is called out separately and last. It is not a
 * rounding error: it is a staffing gap, and no amount of chasing will clear it
 * — somebody has to be assigned to that depot.
 */
function DeskResponsibility({
  assignments, allDesks, downloading, onDownload,
}: {
  assignments?: DeskAssignments
  /** Every desk, so a person's file covers all of theirs — not just this one. */
  allDesks: DeskAssignments[]
  downloading: string | null
  onDownload: (key: string, run: () => Promise<void>) => void
}) {
  const [open, setOpen] = useState<number | 'unassigned' | 'nobatch' | null>(null)

  // Absent for a non-admin (the endpoint 403s) or still loading. The counts
  // above stand on their own, so this simply does not render.
  if (!assignments || assignments.failed) return null

  const { assignments: people, unassigned, unit } = assignments
  if (people.length === 0 && unassigned.count === 0 && assignments.noBatch.count === 0) return null

  const waited = (h: number) => (h >= 48 ? `${Math.floor(h / 24)}d` : `${h}h`)
  const plural = (n: number) => `${n} ${unit}${n === 1 ? '' : 's'}`

  return (
    <div className="mt-2.5 space-y-1.5 border-t border-foreground/10 pt-2.5">
      {people.map((a) => {
        const isOpen = open === a.staffId
        return (
          <div key={a.staffId}>
            <div className="flex items-start gap-1">
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : a.staffId)}
              className="flex min-w-0 flex-1 items-start gap-2 rounded-md px-1 py-1 text-left hover:bg-foreground/5"
            >
              <ChevronDown
                className={cn(
                  'mt-0.5 size-3 shrink-0 text-muted-foreground transition-transform',
                  !isOpen && '-rotate-90',
                )}
              />
              <span className="min-w-0 flex-1 text-xs">
                {/* The sentence comes composed from the server so the wording
                    cannot drift between the panel and the SMS. */}
                <span className="font-medium">{a.sentence}</span>{' '}
                <span className="font-semibold">{plural(a.count)}</span>
                <span className="text-muted-foreground">
                  {' · '}{a.locations.map((l) => `${l.location} (${l.count})`).join(', ')}
                  {' · oldest '}{waited(a.oldestHours)}
                </span>
              </span>
            </button>
            {/* Their whole list, every desk they are on — a file to hand over
                rather than a screen to read out. */}
            <Button
              variant="ghost"
              size="sm"
              className="h-6 shrink-0 gap-1 px-1.5 text-muted-foreground"
              title={`Download ${a.name}'s pending tasks`}
              disabled={downloading !== null}
              onClick={() => onDownload(
                `person:${a.staffId}`,
                () => exportPersonTasks(a.staffId, a.name, allDesks),
              )}
            >
              {downloading === `person:${a.staffId}`
                ? <Loader2 className="size-3 animate-spin" />
                : <Download className="size-3" />}
              <span className="sr-only">Download {a.name}'s tasks</span>
            </Button>
            </div>

            {isOpen && (
              <ul className="mt-1 mb-1.5 ml-5 space-y-0.5 border-l border-foreground/10 pl-3">
                {a.items.slice(0, 25).map((i) => (
                  <li key={i.id} className="text-xs text-muted-foreground">
                    <span className="text-foreground">{i.label}</span>
                    {i.customerName ? ` · ${i.customerName}` : ''}
                    {i.quantity ? ` · ${i.quantity.toLocaleString()} litres` : ''}
                    {i.pfiNumber ? ` · ${i.pfiNumber}` : ''}
                    {` · waiting ${waited(i.hoursWaiting)}`}
                  </li>
                ))}
                {a.items.length > 25 && (
                  <li className="text-xs text-muted-foreground/60">
                    and {a.items.length - 25} more
                  </li>
                )}
              </ul>
            )}
          </div>
        )
      })}

      {unassigned.count > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setOpen(open === 'unassigned' ? null : 'unassigned')}
            className="flex w-full items-start gap-2 rounded-md px-1 py-1 text-left hover:bg-foreground/5"
          >
            <UserX className="mt-0.5 size-3 shrink-0 text-destructive" />
            <span className="min-w-0 flex-1 text-xs">
              <span className="font-medium text-destructive">
                Nobody is assigned to {plural(unassigned.count)}
              </span>
              <span className="text-muted-foreground">
                {' · '}{unassigned.locations.map((l) => `${l.location} (${l.count})`).join(', ')}
              </span>
            </span>
          </button>
          {open === 'unassigned' && (
            <>
              <ul className="mt-1 ml-5 space-y-0.5 border-l border-destructive/20 pl-3">
                {unassigned.items.slice(0, 25).map((i) => (
                  <li key={i.id} className="text-xs text-muted-foreground">
                    <span className="text-foreground">{i.label}</span>
                    {i.depotName ? ` · ${i.depotName}` : ''}
                    {` · waiting ${waited(i.hoursWaiting)}`}
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 ml-5 text-xs text-muted-foreground/70">
                Nobody holding this desk's role is scoped to these locations. Chasing will not
                clear it — assign somebody to the depot under Manage Users.
              </p>
            </>
          )}
        </div>
      )}

      {assignments.noBatch.count > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setOpen(open === 'nobatch' ? null : 'nobatch')}
            className="flex w-full items-start gap-2 rounded-md px-1 py-1 text-left hover:bg-foreground/5"
          >
            <FileQuestion className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 text-xs text-muted-foreground">
              <span className="font-medium">{plural(assignments.noBatch.count)} with no batch</span>
              {' — not counted above, and not anybody\u2019s task'}
            </span>
          </button>
          {open === 'nobatch' && (
            <>
              <ul className="mt-1 ml-5 space-y-0.5 border-l border-foreground/10 pl-3">
                {assignments.noBatch.items.slice(0, 25).map((i) => (
                  <li key={i.id} className="text-xs text-muted-foreground">
                    <span className="text-foreground">{i.label}</span>
                    {i.depotName ? ` · ${i.depotName}` : ''}
                    {` · waiting ${waited(i.hoursWaiting)}`}
                  </li>
                ))}
                {assignments.noBatch.items.length > 25 && (
                  <li className="text-xs text-muted-foreground/60">
                    and {assignments.noBatch.items.length - 25} more
                  </li>
                )}
              </ul>
              <p className="mt-1.5 ml-5 text-xs text-muted-foreground/70">
                These carry no PFI, so they cannot be ticketed or gated — a loading ticket draws
                against stock and there is no batch to draw from. They are shown because orders
                that took money and went nowhere are worth knowing about, but they are a records
                problem rather than a queue, and nobody is behind on them.
              </p>
            </>
          )}
        </div>
      )}

      {assignments.idle.length > 0 && (
        <p className="px-1 text-xs text-muted-foreground/60">
          Clear on this desk: {assignments.idle.map((i) => i.name).join(', ')}
        </p>
      )}
    </div>
  )
}
