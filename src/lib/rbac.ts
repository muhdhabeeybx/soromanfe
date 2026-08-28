import { Roles } from '#/routes/admin/-roles'

// Re-export for convenience
export { Roles }

// Backend role string to numeric ID mapping (matches useAdmin.ts ROLE_MAP_REVERSE)
export const ROLE_STRING_TO_ID: Record<string, number> = {
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

// Numeric ID to backend role string mapping
export const ROLE_ID_TO_STRING: Record<number, string> = Object.fromEntries(
  Object.entries(ROLE_STRING_TO_ID).map(([str, id]) => [id, str])
) as Record<number, string>

// Action types for granular permissions
export type ActionType = 'view' | 'create' | 'edit' | 'delete' | 'review' | 'approve' | 'pay' | 'dispatch' | 'export'

// Route permission definition
export interface RoutePermissions {
  view: number[]
  create: number[]
  edit: number[]
  delete: number[]
  review?: number[]
  approve?: number[]
  pay?: number[]
  dispatch?: number[]
  export?: number[]
}

// ============================================================================
// ROUTE-PERMISSION MAPPINGS
// Based on backend requireRole() analysis and business logic
// ============================================================================

const ADMIN_SUPERADMIN = [Roles.ADMIN, Roles.SUPERADMIN]
const ALL_AUTHENTICATED: number[] = Object.values(Roles as Record<string, number>).filter((v) => typeof v === 'number')

export const ROUTE_PERMISSIONS: Record<string, RoutePermissions> = {
  // --------------------------------------------------------------------------
  // OVERVIEW - All authenticated users
  // --------------------------------------------------------------------------
  '/overview': {
    view: [...ADMIN_SUPERADMIN, Roles.FINANCE, Roles.ORDERS_MANAGER],
    create: [],
    edit: [],
    delete: [],
  },

  // --------------------------------------------------------------------------
  // ORDERS
  // --------------------------------------------------------------------------
  '/orders': {
    view: [...ADMIN_SUPERADMIN, Roles.SALES_MANAGER, Roles.PRODUCT_MANAGER, Roles.FINANCE, Roles.TRUCK_SALES, Roles.AUDIT, Roles.ORDERS_VIEWER, Roles.ORDERS_OPERATOR, Roles.ORDERS_MANAGER],
    create: [...ADMIN_SUPERADMIN, Roles.ORDERS_OPERATOR, Roles.ORDERS_MANAGER],
    edit: [...ADMIN_SUPERADMIN, Roles.ORDERS_MANAGER],
    delete: [Roles.SUPERADMIN],
    export: [...ADMIN_SUPERADMIN, Roles.FINANCE, Roles.ORDERS_MANAGER],
  },
  '/admin-order': {
    view: [...ADMIN_SUPERADMIN, Roles.SALES_MANAGER, Roles.PRODUCT_MANAGER, Roles.ORDERS_VIEWER, Roles.ORDERS_OPERATOR, Roles.ORDERS_MANAGER],
    create: [...ADMIN_SUPERADMIN, Roles.SALES_MANAGER, Roles.PRODUCT_MANAGER, Roles.ORDERS_OPERATOR, Roles.ORDERS_MANAGER],
    edit: [...ADMIN_SUPERADMIN, Roles.ORDERS_MANAGER],
    delete: [],
  },
  '/payable-orders': {
    view: [...ADMIN_SUPERADMIN, Roles.FINANCE, Roles.FINANCE_VIEWER, Roles.FINANCE_OPERATOR, Roles.FINANCE_MANAGER],
    create: [],
    edit: [],
    delete: [],
    pay: [Roles.FINANCE, Roles.SUPERADMIN, Roles.FINANCE_MANAGER],
  },
  '/customers': {
    view: [...ADMIN_SUPERADMIN, Roles.SALES_MANAGER, Roles.PRODUCT_MANAGER, Roles.FINANCE, Roles.TRUCK_SALES, Roles.AUDIT, Roles.ORDERS_VIEWER, Roles.ORDERS_OPERATOR, Roles.ORDERS_MANAGER, Roles.SALES_VIEWER, Roles.SALES_OPERATOR, Roles.SALES_MANAGER_TIER],
    create: [...ADMIN_SUPERADMIN, Roles.ORDERS_OPERATOR, Roles.ORDERS_MANAGER],
    edit: [...ADMIN_SUPERADMIN, Roles.ORDERS_MANAGER],
    delete: [Roles.SUPERADMIN],
  },
  /**
   * The merged book — customers and leads on one page.
   *
   * Viewing takes the union of what /customers and /contacts allowed, since
   * it shows both. `delete` is the SuperAdmin line from /customers rather
   * than the looser one from /contacts: this page can remove customer
   * records through the number-review panel, and the stricter of the two
   * gates has to win when one page covers both.
   */
  '/people': {
    view: [...ADMIN_SUPERADMIN, Roles.SALES_MANAGER, Roles.PRODUCT_MANAGER, Roles.FINANCE, Roles.TRUCK_SALES, Roles.AUDIT, Roles.ORDERS_VIEWER, Roles.ORDERS_OPERATOR, Roles.ORDERS_MANAGER, Roles.SALES_VIEWER, Roles.SALES_OPERATOR, Roles.SALES_MANAGER_TIER],
    create: [...ADMIN_SUPERADMIN, Roles.ORDERS_OPERATOR, Roles.ORDERS_MANAGER, Roles.SALES_OPERATOR, Roles.SALES_MANAGER_TIER],
    edit: [...ADMIN_SUPERADMIN, Roles.ORDERS_MANAGER, Roles.SALES_OPERATOR, Roles.SALES_MANAGER_TIER],
    delete: [Roles.SUPERADMIN],
  },
  // A lead is a sales record, so it answers to the same people as the
  // customer book. Deleting is not held to SuperAdmin the way a customer is:
  // a contact carries no orders, no wallet and no payment history, so removing
  // a bad import row destroys nothing that has to reconcile.
  '/contacts': {
    view: [...ADMIN_SUPERADMIN, Roles.SALES_MANAGER, Roles.PRODUCT_MANAGER, Roles.FINANCE, Roles.TRUCK_SALES, Roles.AUDIT, Roles.ORDERS_VIEWER, Roles.ORDERS_OPERATOR, Roles.ORDERS_MANAGER, Roles.SALES_VIEWER, Roles.SALES_OPERATOR, Roles.SALES_MANAGER_TIER],
    create: [...ADMIN_SUPERADMIN, Roles.ORDERS_OPERATOR, Roles.ORDERS_MANAGER, Roles.SALES_OPERATOR, Roles.SALES_MANAGER_TIER],
    edit: [...ADMIN_SUPERADMIN, Roles.ORDERS_MANAGER, Roles.SALES_OPERATOR, Roles.SALES_MANAGER_TIER],
    delete: [...ADMIN_SUPERADMIN, Roles.ORDERS_MANAGER, Roles.SALES_MANAGER_TIER],
  },

  // --------------------------------------------------------------------------
  // OPERATIONS - Tickets, Depots, Products
  // --------------------------------------------------------------------------
  '/ticket': {
    view: [...ADMIN_SUPERADMIN, Roles.TICKETING, Roles.RELEASE, Roles.DISPATCH, Roles.AUDIT, Roles.TICKETING_VIEWER, Roles.TICKETING_OPERATOR, Roles.TICKETING_MANAGER],
    create: [Roles.TICKETING, Roles.SUPERADMIN, Roles.TICKETING_OPERATOR, Roles.TICKETING_MANAGER],
    edit: [],
    delete: [],
  },
  '/depots': {
    view: [...ADMIN_SUPERADMIN, Roles.PRODUCT_MANAGER, Roles.AUDIT],
    create: ADMIN_SUPERADMIN,
    edit: ADMIN_SUPERADMIN,
    delete: ADMIN_SUPERADMIN,
  },
  '/products': {
    view: [...ADMIN_SUPERADMIN, Roles.PRODUCT_MANAGER, Roles.AUDIT],
    create: ADMIN_SUPERADMIN,
    edit: ADMIN_SUPERADMIN,
    delete: ADMIN_SUPERADMIN,
  },
  '/product-pricing': {
    view: [...ADMIN_SUPERADMIN, Roles.PRODUCT_MANAGER, Roles.FINANCE, Roles.AUDIT, Roles.FINANCE_VIEWER, Roles.FINANCE_OPERATOR, Roles.FINANCE_MANAGER],
    create: [...ADMIN_SUPERADMIN, Roles.FINANCE, Roles.FINANCE_MANAGER],
    edit: [...ADMIN_SUPERADMIN, Roles.FINANCE, Roles.FINANCE_MANAGER],
    delete: [Roles.SUPERADMIN],
  },

  // --------------------------------------------------------------------------
  // SECURITY
  // --------------------------------------------------------------------------
  '/security/entry': {
    view: [...ADMIN_SUPERADMIN, Roles.SECURITY_ENTRY, Roles.AUDIT, Roles.SECURITY_VIEWER, Roles.SECURITY_OPERATOR, Roles.SECURITY_MANAGER],
    create: [Roles.SECURITY_ENTRY, Roles.SUPERADMIN, Roles.SECURITY_OPERATOR, Roles.SECURITY_MANAGER],
    edit: [],
    delete: [],
  },
  '/security/exit': {
    view: [...ADMIN_SUPERADMIN, Roles.SECURITY_EXIT, Roles.AUDIT, Roles.SECURITY_VIEWER, Roles.SECURITY_OPERATOR, Roles.SECURITY_MANAGER],
    create: [Roles.SECURITY_EXIT, Roles.SUPERADMIN, Roles.SECURITY_OPERATOR, Roles.SECURITY_MANAGER],
    edit: [],
    delete: [],
  },
  '/security-report': {
    view: [...ADMIN_SUPERADMIN, Roles.SECURITY_ENTRY, Roles.SECURITY_EXIT, Roles.AUDIT, Roles.SECURITY_VIEWER, Roles.SECURITY_OPERATOR, Roles.SECURITY_MANAGER],
    create: [],
    edit: [],
    delete: [],
    export: [...ADMIN_SUPERADMIN, Roles.SECURITY_ENTRY, Roles.SECURITY_EXIT, Roles.SECURITY_MANAGER],
  },

  // --------------------------------------------------------------------------
  // FINANCE - PFI, Expenses, Deposits, Commissions, Bank
  // --------------------------------------------------------------------------
  '/pfi': {
    view: [...ADMIN_SUPERADMIN, Roles.FINANCE, Roles.COMMISSIONS, Roles.COMMISSION_OFFICER, Roles.AUDIT, Roles.FINANCE_VIEWER, Roles.FINANCE_OPERATOR, Roles.FINANCE_MANAGER],
    create: [...ADMIN_SUPERADMIN, Roles.FINANCE, Roles.FINANCE_OPERATOR, Roles.FINANCE_MANAGER],
    edit: [...ADMIN_SUPERADMIN, Roles.FINANCE, Roles.FINANCE_MANAGER],
    delete: [Roles.SUPERADMIN],
    export: [...ADMIN_SUPERADMIN, Roles.FINANCE, Roles.FINANCE_OPERATOR, Roles.FINANCE_MANAGER],
  },
  '/expenses': {
    view: [...ADMIN_SUPERADMIN, Roles.FINANCE, Roles.AUDIT, Roles.FINANCE_VIEWER, Roles.FINANCE_OPERATOR, Roles.FINANCE_MANAGER, Roles.EXPENDITURE_OFFICER],
    create: [...ADMIN_SUPERADMIN, Roles.FINANCE, Roles.FINANCE_OPERATOR, Roles.FINANCE_MANAGER],
    edit: [...ADMIN_SUPERADMIN, Roles.FINANCE, Roles.FINANCE_MANAGER],
    delete: [Roles.SUPERADMIN],
  },
  '/vendors': {
    view: [...ADMIN_SUPERADMIN, Roles.FINANCE, Roles.AUDIT, Roles.FINANCE_VIEWER, Roles.FINANCE_OPERATOR, Roles.FINANCE_MANAGER, Roles.EXPENDITURE_OFFICER],
    create: [...ADMIN_SUPERADMIN, Roles.FINANCE, Roles.FINANCE_OPERATOR, Roles.FINANCE_MANAGER],
    edit: [...ADMIN_SUPERADMIN, Roles.FINANCE, Roles.FINANCE_MANAGER],
    delete: [],
  },
  '/deposits': {
    view: [...ADMIN_SUPERADMIN, Roles.FINANCE, Roles.AUDIT, Roles.FINANCE_VIEWER, Roles.FINANCE_OPERATOR, Roles.FINANCE_MANAGER],
    create: [Roles.SUPERADMIN, Roles.FINANCE, Roles.FINANCE_OPERATOR, Roles.FINANCE_MANAGER],
    edit: [],
    delete: [],
  },
  '/commissions': {
    view: [...ADMIN_SUPERADMIN, Roles.FINANCE, Roles.COMMISSIONS, Roles.COMMISSION_OFFICER, Roles.AUDIT, Roles.FINANCE_VIEWER, Roles.FINANCE_OPERATOR, Roles.FINANCE_MANAGER],
    create: [...ADMIN_SUPERADMIN, Roles.FINANCE, Roles.FINANCE_OPERATOR, Roles.FINANCE_MANAGER],
    edit: [...ADMIN_SUPERADMIN, Roles.FINANCE, Roles.FINANCE_MANAGER],
    delete: [Roles.SUPERADMIN],
  },
  '/commission-rates': {
    view: [...ADMIN_SUPERADMIN, Roles.FINANCE, Roles.COMMISSIONS, Roles.AUDIT, Roles.FINANCE_VIEWER, Roles.FINANCE_OPERATOR, Roles.FINANCE_MANAGER],
    create: [...ADMIN_SUPERADMIN, Roles.FINANCE, Roles.FINANCE_OPERATOR, Roles.FINANCE_MANAGER],
    edit: [...ADMIN_SUPERADMIN, Roles.FINANCE, Roles.FINANCE_MANAGER],
    delete: [Roles.SUPERADMIN],
  },
  '/bank-accounts': {
    view: [...ADMIN_SUPERADMIN, Roles.FINANCE, Roles.AUDIT, Roles.FINANCE_VIEWER, Roles.FINANCE_OPERATOR, Roles.FINANCE_MANAGER],
    create: [...ADMIN_SUPERADMIN, Roles.FINANCE, Roles.FINANCE_OPERATOR, Roles.FINANCE_MANAGER],
    edit: [...ADMIN_SUPERADMIN, Roles.FINANCE, Roles.FINANCE_MANAGER],
    delete: [Roles.SUPERADMIN],
  },
  '/bank-statements': {
    view: [...ADMIN_SUPERADMIN, Roles.FINANCE, Roles.AUDIT, Roles.FINANCE_VIEWER, Roles.FINANCE_OPERATOR, Roles.FINANCE_MANAGER],
    create: [],
    edit: [],
    delete: [],
    export: [...ADMIN_SUPERADMIN, Roles.FINANCE, Roles.FINANCE_MANAGER],
  },

  // --------------------------------------------------------------------------
  // TRANSPORT - Fleet, Trucks, Drivers
  // --------------------------------------------------------------------------
  '/fleet-trucks': {
    view: [...ADMIN_SUPERADMIN, Roles.TRANSPORT, Roles.AUDIT, Roles.TRANSPORT_VIEWER, Roles.TRANSPORT_OPERATOR, Roles.TRANSPORT_MANAGER],
    create: [...ADMIN_SUPERADMIN, Roles.TRANSPORT, Roles.TRANSPORT_OPERATOR, Roles.TRANSPORT_MANAGER],
    edit: [...ADMIN_SUPERADMIN, Roles.TRANSPORT, Roles.TRANSPORT_MANAGER],
    delete: [Roles.SUPERADMIN],
  },
  '/fleet-ledger': {
    view: [...ADMIN_SUPERADMIN, Roles.TRANSPORT, Roles.AUDIT, Roles.TRANSPORT_VIEWER, Roles.TRANSPORT_OPERATOR, Roles.TRANSPORT_MANAGER],
    create: [],
    edit: [],
    delete: [],
    export: [...ADMIN_SUPERADMIN, Roles.TRANSPORT, Roles.TRANSPORT_VIEWER, Roles.TRANSPORT_OPERATOR, Roles.TRANSPORT_MANAGER],
  },
  '/drivers': {
    view: [...ADMIN_SUPERADMIN, Roles.TRANSPORT, Roles.AUDIT, Roles.TRANSPORT_VIEWER, Roles.TRANSPORT_OPERATOR, Roles.TRANSPORT_MANAGER],
    create: [...ADMIN_SUPERADMIN, Roles.TRANSPORT, Roles.TRANSPORT_OPERATOR, Roles.TRANSPORT_MANAGER],
    edit: [...ADMIN_SUPERADMIN, Roles.TRANSPORT, Roles.TRANSPORT_MANAGER],
    delete: [Roles.SUPERADMIN],
  },

  // --------------------------------------------------------------------------
  // DANGOTE DELIVERY
  // --------------------------------------------------------------------------
  '/dangote-orders': {
    view: [...ADMIN_SUPERADMIN, Roles.TRANSPORT, Roles.SALES_MANAGER, Roles.AUDIT, Roles.DANGOTE_VIEWER, Roles.DANGOTE_OPERATOR, Roles.DANGOTE_MANAGER],
    create: [],
    edit: [],
    delete: [],
  },
  '/dangote-order-request': {
    view: [...ADMIN_SUPERADMIN, Roles.TRANSPORT, Roles.SALES_MANAGER, Roles.DANGOTE_VIEWER, Roles.DANGOTE_OPERATOR, Roles.DANGOTE_MANAGER],
    create: [...ADMIN_SUPERADMIN, Roles.DANGOTE_OPERATOR, Roles.DANGOTE_MANAGER],
    edit: [],
    delete: [],
    review: [...ADMIN_SUPERADMIN, Roles.DANGOTE_MANAGER],
  },
  '/dangote-payable-orders': {
    view: [...ADMIN_SUPERADMIN, Roles.FINANCE, Roles.DANGOTE_VIEWER, Roles.DANGOTE_OPERATOR, Roles.DANGOTE_MANAGER, Roles.FINANCE_VIEWER, Roles.FINANCE_OPERATOR, Roles.FINANCE_MANAGER],
    create: [],
    edit: [],
    delete: [],
    pay: [Roles.FINANCE, Roles.SUPERADMIN, Roles.FINANCE_MANAGER],
  },
  '/dangote-products': {
    view: [...ADMIN_SUPERADMIN, Roles.TRANSPORT, Roles.PRODUCT_MANAGER, Roles.AUDIT, Roles.DANGOTE_VIEWER, Roles.DANGOTE_OPERATOR, Roles.DANGOTE_MANAGER],
    create: [...ADMIN_SUPERADMIN, Roles.DANGOTE_OPERATOR, Roles.DANGOTE_MANAGER],
    edit: [...ADMIN_SUPERADMIN, Roles.DANGOTE_MANAGER],
    delete: [Roles.SUPERADMIN],
  },

  // --------------------------------------------------------------------------
  // TRUCK SALES - Delivery Operations, Sales Ledger, Filling Stations
  // --------------------------------------------------------------------------
  '/delivery-operations': {
    view: [...ADMIN_SUPERADMIN, Roles.TRUCK_SALES, Roles.SALES_MANAGER, Roles.AUDIT, Roles.SALES_VIEWER, Roles.SALES_OPERATOR, Roles.SALES_MANAGER_TIER],
    create: [...ADMIN_SUPERADMIN, Roles.SALES_OPERATOR, Roles.SALES_MANAGER_TIER],
    edit: [...ADMIN_SUPERADMIN, Roles.SALES_MANAGER_TIER],
    delete: [Roles.SUPERADMIN],
  },
  '/sales-ledger': {
    view: [...ADMIN_SUPERADMIN, Roles.TRUCK_SALES, Roles.SALES_MANAGER, Roles.AUDIT, Roles.SALES_VIEWER, Roles.SALES_OPERATOR, Roles.SALES_MANAGER_TIER],
    create: [...ADMIN_SUPERADMIN, Roles.SALES_OPERATOR, Roles.SALES_MANAGER_TIER],
    edit: [...ADMIN_SUPERADMIN, Roles.SALES_MANAGER_TIER],
    delete: [Roles.SUPERADMIN],
    export: [...ADMIN_SUPERADMIN, Roles.TRUCK_SALES, Roles.SALES_MANAGER, Roles.SALES_VIEWER, Roles.SALES_OPERATOR, Roles.SALES_MANAGER_TIER],
  },
  '/filing-stations': {
    view: [...ADMIN_SUPERADMIN, Roles.TRUCK_SALES, Roles.SALES_MANAGER, Roles.AUDIT, Roles.SALES_VIEWER, Roles.SALES_OPERATOR, Roles.SALES_MANAGER_TIER],
    create: [...ADMIN_SUPERADMIN, Roles.SALES_OPERATOR, Roles.SALES_MANAGER_TIER],
    edit: [...ADMIN_SUPERADMIN, Roles.SALES_MANAGER_TIER],
    delete: [Roles.SUPERADMIN],
  },
  '/delivery-customer': {
    view: [...ADMIN_SUPERADMIN, Roles.TRUCK_SALES, Roles.SALES_MANAGER, Roles.AUDIT, Roles.SALES_VIEWER, Roles.SALES_OPERATOR, Roles.SALES_MANAGER_TIER],
    create: [...ADMIN_SUPERADMIN, Roles.SALES_OPERATOR, Roles.SALES_MANAGER_TIER],
    edit: [...ADMIN_SUPERADMIN, Roles.SALES_MANAGER_TIER],
    delete: [Roles.SUPERADMIN],
  },

  // --------------------------------------------------------------------------
  // LPG HOME DELIVERY
  // --------------------------------------------------------------------------
  '/lpg-orders': {
    view: [...ADMIN_SUPERADMIN, Roles.LPG_DASHBOARD, Roles.LPG_SALES, Roles.AUDIT, Roles.LPG_VIEWER, Roles.LPG_OPERATOR, Roles.LPG_MANAGER],
    create: [],
    edit: [],
    delete: [],
    dispatch: [Roles.LPG_SALES, Roles.SUPERADMIN, Roles.LPG_OPERATOR, Roles.LPG_MANAGER],
  },
  '/lpg-order-request': {
    view: [...ADMIN_SUPERADMIN, Roles.LPG_DASHBOARD, Roles.LPG_SALES, Roles.LPG_VIEWER, Roles.LPG_OPERATOR, Roles.LPG_MANAGER],
    create: [...ADMIN_SUPERADMIN, Roles.LPG_OPERATOR, Roles.LPG_MANAGER],
    edit: [],
    delete: [],
    review: [Roles.LPG_SALES, Roles.SUPERADMIN, Roles.LPG_OPERATOR, Roles.LPG_MANAGER],
  },
  '/lpg-payable-orders': {
    view: [...ADMIN_SUPERADMIN, Roles.FINANCE, Roles.LPG_SALES, Roles.LPG_VIEWER, Roles.LPG_OPERATOR, Roles.LPG_MANAGER, Roles.FINANCE_VIEWER, Roles.FINANCE_OPERATOR, Roles.FINANCE_MANAGER],
    create: [],
    edit: [],
    delete: [],
    pay: [Roles.FINANCE, Roles.SUPERADMIN, Roles.FINANCE_MANAGER],
  },
  '/lpg-stations': {
    view: [...ADMIN_SUPERADMIN, Roles.LPG_PLANTS, Roles.LPG_STOCK, Roles.AUDIT, Roles.LPG_VIEWER, Roles.LPG_OPERATOR, Roles.LPG_MANAGER],
    create: [...ADMIN_SUPERADMIN, Roles.LPG_PLANTS, Roles.LPG_OPERATOR, Roles.LPG_MANAGER],
    edit: [...ADMIN_SUPERADMIN, Roles.LPG_PLANTS, Roles.LPG_MANAGER],
    delete: [Roles.SUPERADMIN],
  },

  // --------------------------------------------------------------------------
  // ADMINISTRATION - User Management, Licence Verification
  // --------------------------------------------------------------------------
  '/admin': {
    view: [...ADMIN_SUPERADMIN, Roles.AUDIT],
    create: [Roles.SUPERADMIN],
    edit: ADMIN_SUPERADMIN,
    delete: [Roles.SUPERADMIN],
  },
  '/licence-verification': {
    view: [...ADMIN_SUPERADMIN, Roles.IT_COMPLIANCE, Roles.AUDIT],
    create: [],
    edit: [],
    delete: [],
    review: [Roles.IT_COMPLIANCE, Roles.SUPERADMIN],
  },

  // ---------------------------------------------------------------------
  // Ported from the other dashboard. Roles are its numeric ids, which
  // this file already maps to. Pages are placeholders for now; the
  // permissions are real so the nav hides what a role may not open.
  // ---------------------------------------------------------------------
  '/home': { view: ALL_AUTHENTICATED, create: [], edit: [], delete: [] },
  '/sales-manager-view': { view: [0, 9], create: [], edit: [], delete: [] },
  '/product-manager-view': { view: [0, 10], create: [], edit: [], delete: [] },
  '/customer-desk': { view: [0, 1], create: [], edit: [], delete: [] },
  '/my-report': { view: [0, 5, 9, 10, 15, 16, 18], create: [], edit: [], delete: [] },
  '/payment-verify': { view: [0, 1, 2, 8], create: [], edit: [], delete: [] },
  '/confirmed-payments': { view: [0, 1, 2, 8], create: [], edit: [], delete: [] },
  '/overpayment-refunds': { view: [0], create: [], edit: [], delete: [] },
  '/overpayment-requests': { view: [0], create: [], edit: [], delete: [] },
  '/lpg': { view: [0, 1, 8, 11, 13, 14], create: [], edit: [], delete: [] },
  '/lpg/dashboard': { view: [0, 1, 8, 11, 13], create: [], edit: [], delete: [] },
  '/lpg/plants': { view: [0, 1, 8, 11], create: [], edit: [], delete: [] },
  '/lpg/stock': { view: [0, 1, 8, 11, 13], create: [], edit: [], delete: [] },
  '/lpg/sales': { view: [0, 1, 8, 11, 13, 14], create: [], edit: [], delete: [] },
  '/delivery-inventory': { view: [0, 1, 3, 6, 8], create: [], edit: [], delete: [] },
  '/admin-reports': { view: [0, 1, 8], create: [], edit: [], delete: [] },
  '/messaging': { view: [0, 1], create: [Roles.SUPERADMIN, Roles.ADMIN], edit: [], delete: [] },
  '/orders-pfi': { view: [0], create: [], edit: [], delete: [] },
  '/inventory': { view: [0], create: [], edit: [], delete: [] },
  '/order-audit': { view: [0, 1, 8], create: [], edit: [], delete: [] },
  '/feedback-dashboard': { view: [0, 1, 8], create: [], edit: [], delete: [] },
}

// ============================================================================
// CORE RBAC FUNCTIONS
// ============================================================================

/**
 * Check if user has the SUPERADMIN role
 */
export function isSuperAdmin(userRoles: number[]): boolean {
  return userRoles.includes(Roles.SUPERADMIN)
}

/**
 * Check if user has ANY of the specified roles
 */
export function hasAnyRole(userRoles: number[], requiredRoles: number[]): boolean {
  if (isSuperAdmin(userRoles)) return true
  return requiredRoles.some(role => userRoles.includes(role))
}

/**
 * Check if user has ALL of the specified roles
 */
export function hasAllRoles(userRoles: number[], requiredRoles: number[]): boolean {
  if (isSuperAdmin(userRoles)) return true
  return requiredRoles.every(role => userRoles.includes(role))
}

/**
 * Per-user page-visibility exceptions on top of the role-derived default —
 * see the admin form's "Page Access" section. Only `view` is overridable;
 * create/edit/delete/etc. stay role-derived (see canPerformAction).
 */
function resolveOverride(overrides: Record<string, boolean> | undefined, routePath: string): boolean | undefined {
  if (!overrides) return undefined
  if (routePath in overrides) return overrides[routePath]
  const sortedPaths = Object.keys(overrides).sort((a, b) => b.length - a.length)
  for (const basePath of sortedPaths) {
    if (routePath.startsWith(basePath + '/')) return overrides[basePath]
  }
  return undefined
}

/**
 * Get the permissions for a specific route
 * Supports both exact matches and prefix matches for nested routes
 */
export function getRoutePermissions(routePath: string): RoutePermissions | null {
  // Try exact match first
  if (ROUTE_PERMISSIONS[routePath]) {
    return ROUTE_PERMISSIONS[routePath]
  }

  // Try prefix match for nested routes (e.g., /orders/123 -> /orders)
  const sortedPaths = Object.keys(ROUTE_PERMISSIONS).sort((a, b) => b.length - a.length)
  for (const basePath of sortedPaths) {
    if (routePath.startsWith(basePath + '/') || routePath === basePath) {
      return ROUTE_PERMISSIONS[basePath]
    }
  }

  return null
}

/**
 * Check if user can access a route (has view permission).
 *
 * Role gating is OFF dashboard-wide: any signed-in staff member may open any
 * page. This mirrors the same decision already taken on the server (see
 * config/apiPermissions.js) — the two have to agree, or the nav hides a page
 * whose API would have answered perfectly well, which is exactly what used to
 * happen: someone who raised an expense or a daily report could not open the
 * page listing it, because /expenses, /my-report and /admin-reports each named
 * a short list of roles that did not include theirs.
 *
 * What still narrows what a person sees is location/PFI scope, applied
 * server-side per row (lib/scopeFilter.js) — that is untouched by this and is
 * the mechanism to reach for if access ever needs restricting again.
 *
 * `overrides` (routePath -> allowed) is the per-user page-access exception
 * list from the admin form. It is still honoured, in both directions, because
 * it is a deliberate per-person decision someone made in the UI rather than a
 * blanket role rule — it is the supported way to close a single page to a
 * single user.
 */
export function canAccessRoute(userRoles: number[], routePath: string, overrides?: Record<string, boolean>): boolean {
  if (isSuperAdmin(userRoles)) return true

  const override = resolveOverride(overrides, routePath)
  if (override !== undefined) return override

  return true
}

/**
 * Check if user can perform a specific action on a route.
 *
 * Open for the same reason as canAccessRoute above — and this one mattered
 * more than it looked: most entries in ROUTE_PERMISSIONS declare
 * `create: [], edit: [], delete: []`, and an empty list denied everyone but
 * superadmin, so "can open the page but can do nothing on it" was the norm
 * rather than the exception.
 */
export function canPerformAction(
  userRoles: number[],
  routePath: string,
  action: ActionType
): boolean {
  // Signature kept so every call site stays valid and enforcement can be
  // restored here alone.
  void userRoles
  void routePath
  void action
  return true
}

/**
 * Check if a user's role is read-only (AUDIT)
 */
export function isAuditRole(userRoles: number[]): boolean {
  return userRoles.includes(Roles.AUDIT) && !isSuperAdmin(userRoles)
}

/**
 * Get all route paths that a user can access
 */
export function getAccessibleRoutes(userRoles: number[]): string[] {
  return Object.keys(ROUTE_PERMISSIONS).filter(path => canAccessRoute(userRoles, path))
}

/**
 * Get the sidebar navigation categories filtered by user roles
 */
export function getFilteredNavCategories<T extends { items: { path: string }[] }>(
  categories: T[],
  userRoles: number[],
  overrides?: Record<string, boolean>
): T[] {
  return categories
    .map(category => ({
      ...category,
      items: category.items.filter(item => canAccessRoute(userRoles, item.path, overrides)),
    }))
    .filter(category => category.items.length > 0)
}
