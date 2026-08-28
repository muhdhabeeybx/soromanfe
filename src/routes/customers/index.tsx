import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * The customer list now lives on /people, alongside the leads.
 *
 * Kept as a redirect rather than deleted: the path is bookmarked, it is in the
 * command palette's history, and older links point at it. `/customers/details`
 * is untouched — merging the two LISTS was the point; a customer's own record,
 * with its wallet and order history, is still its own page.
 */
export const Route = createFileRoute('/customers/')({
  beforeLoad: () => {
    throw redirect({ to: '/people' as any, replace: true } as any)
  },
})
