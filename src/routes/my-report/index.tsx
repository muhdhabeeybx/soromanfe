import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '#/components/PageHeader'
import { cn } from '#/lib/utils'
import { useRoles } from '#/lib/hooks/useRoles'
import { routeGuard } from '#/lib/route-guard'
import { REPORTS, ROLE_REPORT, ALL_TYPES, type ReportType } from './-report-config'
import { ReportPanel } from './-report-panel'

export const Route = createFileRoute('/my-report/')({
  beforeLoad: () => routeGuard('/my-report'),
  component: MyReportPage,
})

/**
 * One URL, five different reports — which one you get depends on your role.
 *
 * A security officer and a commissions officer share nothing here but the
 * page frame. Super admin gets a tab bar over all five so they can file on
 * behalf of any role.
 *
 * Role only decides what is *rendered*; the server checks who may file and
 * who may delete. Upstream this was localStorage alone, with the API
 * enforcing nothing.
 */
function MyReportPage() {
  const { userRoles, isSuperAdmin } = useRoles()

  const mine = userRoles.map((r) => ROLE_REPORT[r]).filter(Boolean) as ReportType[]
  const available = isSuperAdmin ? ALL_TYPES : [...new Set(mine)]
  const [active, setActive] = useState<ReportType | null>(available[0] ?? null)

  /**
   * No filing role — but possibly a filing history.
   *
   * This used to return the empty state and stop, which meant anyone moved
   * off a reporting role lost sight of everything they had ever filed: the
   * page never rendered a panel, so it never asked the server for their
   * reports. On live data one filer sat on four submissions reachable by no
   * route in the app at all.
   *
   * Filing and reading are separate questions. The role decides whether the
   * form appears; what you already filed is yours to see either way, so the
   * submissions panel renders regardless — in history-only mode, with no form
   * above it.
   */
  if (available.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="My Reports"
          title="My report"
          description="Your filing history."
        />
        <div className="rounded-lg border border-foreground/15 bg-muted/30 p-4 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">No report is assigned to your role.</span>{' '}
          Daily returns are filed by security, commissions, compliance and the sales and location
          managers — ask an administrator to add the role if you should be filing one. Anything you
          filed previously is listed below.
        </div>
        <ReportPanel def={REPORTS[ALL_TYPES[0]]} historyOnly />
      </div>
    )
  }

  const current = REPORTS[active ?? available[0]]

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="My Reports"
        title={current.title}
        description={current.description}
      />

      {/* Only a super admin sees more than one, so the tabs stay hidden for
          everyone who files a single report. */}
      {available.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {available.map((t) => {
            const on = (active ?? available[0]) === t
            return (
              <button
                key={t}
                type="button"
                onClick={() => setActive(t)}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-sm transition-colors duration-250 ease-luxe',
                  on
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-foreground/15 text-muted-foreground hover:border-foreground/30',
                )}
              >
                {t === 'sales_manager'
                  ? 'Sales manager'
                  : t === 'product_manager'
                    ? 'Location manager'
                    : REPORTS[t].title}
              </button>
            )
          })}
        </div>
      )}

      {/* Keyed so switching tabs resets the form rather than carrying one
          report's half-filled values into another's fields. */}
      <ReportPanel key={current.type} def={current} />
    </div>
  )
}
