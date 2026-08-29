import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "#/lib/utils"

/**
 * Outlined by default. The house way of showing state.
 *
 * Tones follow the system's colour semantics:
 *   accent       live / best / current / done
 *   warning      pending / price-lock / worse-than-best  (amber, the one
 *                off-token colour in the system)
 *   destructive  errors
 *   inert        not-yet / absent
 *
 * Sits at 0.6rem by default; 0.65rem when it sits in a panel header rail.
 *
 * `fill="solid"` gives the same tones a tinted background instead of a border.
 * Opt-in rather than the default, so the outlined chip stays the house style
 * everywhere it already is — solid is for a dense card where several chips sit
 * together and outlines start reading as clutter rather than as state.
 */
const statusChipVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 whitespace-nowrap uppercase [&>svg]:size-3",
  {
    variants: {
      tone: {
        accent: "",
        warning: "",
        destructive: "",
        inert: "",
      },
      fill: {
        outline: "border",
        solid: "border-0 font-semibold",
      },
      size: {
        default: "text-xs",
        rail: "text-xs",
      },
    },
    compoundVariants: [
      { fill: "outline", tone: "accent", class: "border-accent/40 text-accent" },
      { fill: "outline", tone: "warning", class: "border-warning/40 text-warning" },
      { fill: "outline", tone: "destructive", class: "border-destructive/40 text-destructive" },
      { fill: "outline", tone: "inert", class: "border-foreground/15 text-muted-foreground/60" },
      // Tinted, never fully saturated — a card can carry two of these side by
      // side without either shouting over the figures they sit above.
      { fill: "solid", tone: "accent", class: "bg-accent/15 text-accent" },
      { fill: "solid", tone: "warning", class: "bg-warning/15 text-warning" },
      { fill: "solid", tone: "destructive", class: "bg-destructive/15 text-destructive" },
      { fill: "solid", tone: "inert", class: "bg-muted text-muted-foreground" },
    ],
    defaultVariants: {
      tone: "accent",
      fill: "outline",
      size: "default",
    },
  },
)

function StatusChip({
  className,
  tone,
  fill,
  size,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof statusChipVariants>) {
  return (
    <span
      data-slot="status-chip"
      className={cn(statusChipVariants({ tone, fill, size, className }))}
      {...props}
    />
  )
}

/**
 * The live indicator. Paused state swaps the fill for a ring so the dot still
 * occupies its space without reading as active.
 */
function LiveDot({
  paused = false,
  className,
  ...props
}: React.ComponentProps<"span"> & { paused?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-2 shrink-0 rounded-full",
        paused
          ? "bg-transparent text-muted-foreground shadow-[inset_0_0_0_1.5px_currentColor]"
          : "live-dot bg-accent",
        className,
      )}
      {...props}
    />
  )
}

export { StatusChip, LiveDot, statusChipVariants }
