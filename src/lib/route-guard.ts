import { redirect } from '@tanstack/react-router'
import { 
  canAccessRoute, 
  isSuperAdmin, 
  ROUTE_PERMISSIONS,
  getRoutePermissions 
} from '#/lib/rbac'

/**
 * Get current user roles from session storage
 * Returns numeric role IDs
 */
export function getCurrentUserRolesFromStorage(): number[] {
  try {
    const stored = sessionStorage.getItem('dashboard-auth-storage')
    if (!stored) return []

    const parsed = JSON.parse(stored)
    const roles = parsed?.state?.user?.roles
    if (!Array.isArray(roles)) return []

    const ROLE_STRING_TO_ID: Record<string, number> = {
      super_admin: 0,
      admin: 1,
      finance: 2,
      truck_sales: 3,
      ticketing: 4,
      security_entry: 5,
      transport: 6,
      release: 7,
      audit: 8,
      sales_manager: 9,
      product_manager: 10,
      lpg_dashboard: 11,
      lpg_plants: 12,
      lpg_stock: 13,
      lpg_sales: 14,
      commissions: 15,
      commission_officer: 16,
      dispatch: 17,
      it_compliance: 18,
      security_exit: 19,

      // Tiered Subroles - Finance Department
      finance_viewer: 20,
      finance_operator: 21,
      finance_manager: 22,

      // Tiered Subroles - Transport Department
      transport_viewer: 23,
      transport_operator: 24,
      transport_manager: 25,

      // Tiered Subroles - Security Department
      security_viewer: 26,
      security_operator: 27,
      security_manager: 28,

      // Tiered Subroles - Ticketing Department
      ticketing_viewer: 29,
      ticketing_operator: 30,
      ticketing_manager: 31,

      // Tiered Subroles - Orders Department
      orders_viewer: 32,
      orders_operator: 33,
      orders_manager: 34,

      // Tiered Subroles - Sales Department
      sales_viewer: 35,
      sales_operator: 36,
      sales_manager_tier: 37,

      // Tiered Subroles - Dangote Department
      dangote_viewer: 38,
      dangote_operator: 39,
      dangote_manager: 40,

      // Tiered Subroles - LPG Department
      lpg_viewer: 41,
      lpg_operator: 42,
      lpg_manager: 43,

      expenditure_officer: 44,
    }

    return roles
      .map((r: string) => ROLE_STRING_TO_ID[r])
      .filter((r): r is number => r !== undefined)
  } catch {
    return []
  }
}

/**
 * Get the current user's per-page access overrides from session storage,
 * keyed by routePath -> allowed. See the admin form's "Page Access" section.
 */
export function getCurrentUserOverridesFromStorage(): Record<string, boolean> {
  try {
    const stored = sessionStorage.getItem('dashboard-auth-storage')
    if (!stored) return {}

    const parsed = JSON.parse(stored)
    const overrides = parsed?.state?.user?.pageOverrides
    if (!Array.isArray(overrides)) return {}

    const map: Record<string, boolean> = {}
    for (const o of overrides) {
      if (o && typeof o.routePath === 'string') map[o.routePath] = !!o.allowed
    }
    return map
  } catch {
    return {}
  }
}

/**
 * Helper to check if user has active session in storage
 */
export function isAuthenticatedFromStorage(): boolean {
  try {
    const stored = sessionStorage.getItem('dashboard-auth-storage')
    if (!stored) return false

    const parsed = JSON.parse(stored)
    return Boolean(parsed?.state?.accessToken || parsed?.state?.user)
  } catch {
    return false
  }
}

/**
 * Route guard function for TanStack Router's beforeLoad
 * Redirects unauthenticated users to /login and unauthorized users to /overview
 * 
 * @param routePath - The route path to check permissions for
 * @throws redirect to /login or /overview if access is denied
 * 
 * @example
 * // In a route file:
 * export const Route = createFileRoute('/orders/')({
 *   beforeLoad: () => routeGuard('/orders'),
 *   component: OrdersPage,
 * })
 */
export function routeGuard(routePath: string): void {
  if (!isAuthenticatedFromStorage()) {
    throw redirect({ to: '/login' })
  }

  const userRoles = getCurrentUserRolesFromStorage()

  // SUPERADMIN bypasses all checks
  if (isSuperAdmin(userRoles)) return

  // Check if user can access the route
  if (!canAccessRoute(userRoles, routePath, getCurrentUserOverridesFromStorage())) {
    if (routePath === '/overview') {
      throw redirect({ to: '/login' })
    }
    throw redirect({ to: '/overview' })
  }
}

/**
 * Guard a page that genuinely is not everyone's business.
 *
 * The ordinary `routeGuard` lets any signed-in staff member through by design
 * — access is open dashboard-wide and location/PFI scope is what narrows what
 * people see (see canAccessRoute in rbac.ts). A `view` list in
 * ROUTE_PERMISSIONS would therefore read like a restriction while restricting
 * nothing, which is worse than no guard at all.
 *
 * This is the explicit exception, for the whole-company dashboard. It names
 * its roles in one place, next to the nav item that names the same ones.
 *
 * @throws redirect to /login when signed out, or to /overview — the landing
 *   page everyone can reach — when signed in without the role.
 */
export function roleOnlyGuard(allowedRoles: number[]): void {
  if (!isAuthenticatedFromStorage()) {
    throw redirect({ to: '/login' })
  }

  const userRoles = getCurrentUserRolesFromStorage()
  if (isSuperAdmin(userRoles)) return
  if (allowedRoles.some((r) => userRoles.includes(r))) return

  throw redirect({ to: '/overview' })
}

/**
 * Route guard that checks a specific action permission
 * 
 * @param routePath - The route path to check permissions for
 * @param action - The action to check (view, create, edit, delete, etc.)
 * @throws redirect to /login or /overview if access is denied
 * 
 * @example
 * // In a route file for a form page:
 * export const Route = createFileRoute('/orders/form')({
 *   beforeLoad: () => routeActionGuard('/orders', 'create'),
 *   component: OrderForm,
 * })
 */
export function routeActionGuard(routePath: string, action: 'view' | 'create' | 'edit' | 'delete'): void {
  if (!isAuthenticatedFromStorage()) {
    throw redirect({ to: '/login' })
  }

  const userRoles = getCurrentUserRolesFromStorage()
  
  // SUPERADMIN bypasses all checks
  if (isSuperAdmin(userRoles)) return
  
  const permissions = getRoutePermissions(routePath)
  if (!permissions) return // No permissions defined = allow access
  
  const allowedRoles = permissions[action]
  if (!allowedRoles || allowedRoles.length === 0) {
    // No roles specified for this action = deny access
    if (routePath === '/overview') {
      throw redirect({ to: '/login' })
    }
    throw redirect({ to: '/overview' })
  }
  
  const hasAccess = allowedRoles.some(role => userRoles.includes(role))
  if (!hasAccess) {
    if (routePath === '/overview') {
      throw redirect({ to: '/login' })
    }
    throw redirect({ to: '/overview' })
  }
}

/**
 * Get filtered navigation categories based on current user's roles
 * For use in the Sidebar component
 */
export function getFilteredNavCategories<T extends { items: { path: string }[] }>(
  categories: T[],
  userRoles?: number[]
): T[] {
  const roles = userRoles ?? getCurrentUserRolesFromStorage()

  // SUPERADMIN sees everything
  if (isSuperAdmin(roles)) return categories

  const overrides = getCurrentUserOverridesFromStorage()
  return categories
    .map(category => ({
      ...category,
      items: category.items.filter(item => canAccessRoute(roles, item.path, overrides)),
    }))
    .filter(category => category.items.length > 0)
}

/**
 * Check if the current user has a specific role
 */
export function currentUserHasRole(roleId: number): boolean {
  const roles = getCurrentUserRolesFromStorage()
  if (isSuperAdmin(roles)) return true
  return roles.includes(roleId)
}

/**
 * Check if the current user has ANY of the specified roles
 */
export function currentUserHasAnyRole(roleIds: number[]): boolean {
  const roles = getCurrentUserRolesFromStorage()
  if (isSuperAdmin(roles)) return true
  return roleIds.some(role => roles.includes(role))
}
