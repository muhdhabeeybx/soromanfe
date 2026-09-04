/**
 * Phone numbers and email addresses, made actionable.
 *
 * A number on a screen is there to be rung and an address is there to be
 * written to. Rendering either as inert text means the reader copies it by
 * hand into another app, which is both slower and a place to make a typo —
 * and on a phone, where a good half of these pages get opened, it throws away
 * the one gesture the device is best at.
 *
 * ── Why it does not look like a link ─────────────────────────────────────
 *
 * These sit inside muted table cells, inside bold summary lines, inside
 * headings. A blue underlined link would repaint whatever it lands in and
 * make a directory table look like a list of hyperlinks. So the default
 * inherits its colour and weight from the surrounding text and carries only a
 * dotted rule underneath — enough to say "this does something" without
 * restyling the row. Colour arrives on hover.
 *
 * ── Empty is not a link ──────────────────────────────────────────────────
 *
 * Half the call sites already render a placeholder for a missing value, and a
 * `tel:` link wrapped around "N/A" dials nothing. Anything blank, or one of
 * the placeholders this codebase already uses, renders as quiet text instead.
 */

import * as React from 'react'
import { cn } from '#/lib/utils'

/** Values that mean "we don't have one", not values worth dialling. */
const PLACEHOLDERS = new Set(['—', '-', 'n/a', 'na', 'nil', 'none', 'not provided', 'not set', ''])

const isMissing = (raw: unknown) =>
  raw === null || raw === undefined || PLACEHOLDERS.has(String(raw).trim().toLowerCase())

/**
 * Dial strings keep the leading + and nothing else non-numeric.
 *
 * Handsets are forgiving about spaces but not about the "(0)" and "ext." that
 * turn up in free-text fields, and a malformed tel: fails silently — the tap
 * simply does nothing, which reads as the app being broken.
 */
export const telHref = (raw: string) => {
  const trimmed = raw.trim()
  const digits = trimmed.replace(/[^\d+]/g, '')
  // A + anywhere but the front is noise; keep it only as a country prefix.
  return digits.startsWith('+') ? `+${digits.slice(1).replace(/\+/g, '')}` : digits.replace(/\+/g, '')
}

const BASE = [
  'underline decoration-dotted decoration-foreground/25 underline-offset-[3px]',
  'transition-colors duration-250 ease-luxe outline-none',
  'hover:text-accent hover:decoration-accent focus-visible:text-accent focus-visible:decoration-accent',
].join(' ')

interface ContactLinkProps extends Omit<React.ComponentProps<'a'>, 'href' | 'children'> {
  /** The number or address as it should be read. */
  value?: string | number | null
  /** Shown, unlinked, when there is nothing to act on. */
  fallback?: React.ReactNode
  /** Overrides the displayed text; the href still comes from `value`. */
  children?: React.ReactNode
}

/** A phone number that dials. */
export function PhoneLink({ value, fallback = '—', className, children, ...props }: ContactLinkProps) {
  if (isMissing(value)) {
    return <span className={cn('text-muted-foreground', className)}>{fallback}</span>
  }
  const text = String(value)
  return (
    <a
      href={`tel:${telHref(text)}`}
      // These frequently sit inside a clickable row or card, and ringing
      // someone should not also navigate.
      onClick={(e) => e.stopPropagation()}
      className={cn(BASE, 'tabular-nums', className)}
      {...props}
    >
      {children ?? text}
    </a>
  )
}

/** An email address that opens a compose window. */
export function EmailLink({ value, fallback = '—', className, children, ...props }: ContactLinkProps) {
  if (isMissing(value)) {
    return <span className={cn('text-muted-foreground', className)}>{fallback}</span>
  }
  const text = String(value).trim()
  return (
    <a
      href={`mailto:${text}`}
      onClick={(e) => e.stopPropagation()}
      className={cn(BASE, 'break-all', className)}
      {...props}
    >
      {children ?? text}
    </a>
  )
}
