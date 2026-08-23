import type { ReactNode } from 'react'
import { StatCard, StatCardGrid, type StatTone } from '#/components/ui/stat-card'

export type SummaryCard = {
  title: string
  value: string
  description?: string
  icon: ReactNode
  tone?: StatTone
  /** Overrides the figure colour only — the chip keeps its own tone. */
  className?: string
}

/**
 * The stat-card row that sits under the page header.
 *
 * Tone defaults to green: "no particular state" is the identity case, so the
 * brand mark carries it and the emerald shows up on every page. Pass an
 * explicit tone only when the figure genuinely means something.
 *
 * Columns follow the card count. A page that wants a different shape — the
 * overview's 2 x 2, for one — reaches for StatCardGrid directly.
 */
export function SummaryCards({ cards }: { cards: SummaryCard[] }) {
  return (
    <StatCardGrid count={cards.length}>
      {cards.map((c, idx) => (
        <StatCard
          key={`${c.title}-${idx}`}
          tone={c.tone ?? 'green'}
          icon={c.icon}
          label={c.title}
          value={c.value}
          description={c.description}
          valueClassName={c.className}
        />
      ))}
    </StatCardGrid>
  )
}
