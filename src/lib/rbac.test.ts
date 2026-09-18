import { describe, expect, test } from 'vitest'
import { canAccessRoute, isGrantOnly, Roles } from '#/lib/rbac'

/**
 * The CFO report's gate, pinned against the server's.
 *
 * The rule here has to be identical to maySeeCfoReport in
 * Sman-Backend/middleware/cfoReportAccess.js — an override row with
 * allowed = true, and nothing else. A page the menu offers and the API refuses
 * is silent, and it fails in the worse direction.
 */
describe('the CFO report is opened by a grant and nothing else', () => {
  const SUPER = [Roles.SUPERADMIN]
  const ADMIN = [Roles.ADMIN]
  const DRIVER = [Roles.TRANSPORT]

  test('a granted person gets in', () => {
    expect(canAccessRoute(ADMIN, '/cfo-report', { '/cfo-report': true })).toBe(true)
  })

  test('an explicitly denied person does not', () => {
    expect(canAccessRoute(ADMIN, '/cfo-report', { '/cfo-report': false })).toBe(false)
  })

  test('absence of a grant is a refusal, not a fallthrough', () => {
    // The server says so outright: "a staff member created next month is out
    // until somebody grants them in".
    expect(canAccessRoute(ADMIN, '/cfo-report', {})).toBe(false)
    expect(canAccessRoute(DRIVER, '/cfo-report', undefined)).toBe(false)
  })

  test('super admin does NOT bypass it', () => {
    // Four people hold super_admin and only three were named. A role bypass
    // would admit exactly the person the request excluded.
    expect(canAccessRoute(SUPER, '/cfo-report', {})).toBe(false)
    expect(canAccessRoute(SUPER, '/cfo-report', { '/cfo-report': false })).toBe(false)
    expect(canAccessRoute(SUPER, '/cfo-report', { '/cfo-report': true })).toBe(true)
  })

  test('it does not leak onto other pages', () => {
    expect(isGrantOnly('/cfo-report')).toBe(true)
    expect(isGrantOnly('/confirmed-payments')).toBe(false)
    // Delivery costing keeps its own, looser rule — a wider page and a
    // different instruction.
    expect(isGrantOnly('/delivery-costing')).toBe(false)
    expect(canAccessRoute(SUPER, '/delivery-costing', {})).toBe(true)
    expect(canAccessRoute(ADMIN, '/orders', {})).toBe(true)
  })
})
