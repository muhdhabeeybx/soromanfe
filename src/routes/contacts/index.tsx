import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * Contacts and leads now live on /people, alongside the customers.
 *
 * Kept as a redirect rather than deleted: the path is bookmarked and older
 * links point at it. The /api/contacts endpoints are untouched — they still
 * own creating, editing and converting a lead; /people only owns finding one.
 */
export const Route = createFileRoute('/contacts/')({
  beforeLoad: () => {
    throw redirect({ to: '/people' as any, replace: true } as any)
  },
})
