import React, { useMemo } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { cn } from "#/lib/utils";
import { LogOut } from "lucide-react";
import { useAuthStore, useAdminLogout } from "#/modules/auth";
import { useLayoutStore } from "#/stores/layoutStore";
import { Avatar, AvatarFallback } from "#/components/ui/avatar";
import { useRoles } from "#/lib/hooks/useRoles";
import { useWorkQueues } from "#/lib/hooks/useDashboard";
import { canAccessRoute, isSuperAdmin } from "#/lib/rbac";
import { navCategories, type NavItem } from "./nav-config";

/**
 * How much work is waiting behind a nav item.
 *
 * Capped in display at 99+ — past that the exact figure stops being a number
 * somebody acts on and starts being a wall the badge has to fit. The real
 * count is still on the landing page and in the title attribute.
 */
function NavBadge({ count, expanded }: { count: number; expanded: boolean }) {
  const shown = count > 99 ? "99+" : String(count);
  return (
    <span
      title={`${count.toLocaleString()} waiting`}
      className={cn(
        "pointer-events-none flex shrink-0 items-center justify-center rounded-full bg-sidebar-primary text-[10px] font-semibold tabular-nums text-sidebar",
        // Expanded: a pill at the end of the row. Collapsed: a dot pinned to
        // the icon's corner, since there is no room for a pill and the count
        // is unreadable at that size anyway.
        expanded
          ? "ml-auto h-4 min-w-4 px-1"
          : "absolute top-1 right-1 h-3.5 min-w-3.5 px-0.5 text-[9px]",
      )}
    >
      {expanded ? shown : count > 9 ? "9+" : shown}
    </span>
  );
}

function NavGroup({
  label,
  items,
  expanded,
  location,
  onItemClick,
  counts,
}: {
  label: string;
  items: NavItem[];
  expanded: boolean;
  location: { pathname: string };
  onItemClick: () => void;
  counts: Record<string, number>;
}) {
  return (
    <div className="mb-2">
      {label && expanded && (
        <div className="px-3 py-2 text-xs uppercase text-muted-foreground/70 select-none">
          {label}
        </div>
      )}
      {label && !expanded && (
        <div className="mx-auto my-2 h-px w-6 bg-sidebar-border" />
      )}
      {items.map((item) => {
        const isActive =
          location.pathname === item.path ||
          location.pathname.startsWith(item.path + "/");

        return (
          <Link
            key={item.title}
            to={item.path as any}
            onClick={onItemClick}
            className={cn(
              "group relative mx-1 flex h-8 cursor-pointer items-center rounded-lg text-sm transition-colors duration-250 ease-luxe outline-none",
              "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-sidebar-ring/50",
              expanded ? "gap-3 px-3" : "justify-center px-0",
              // Emerald marks the active item; everything else stays neutral.
              isActive
                ? "bg-sidebar-accent font-normal text-sidebar-primary"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground",
            )}
            aria-current={isActive ? "page" : undefined}
          >
            <item.icon
              className={cn(
                "size-4 shrink-0",
                isActive ? "text-sidebar-primary" : "text-muted-foreground",
              )}
            />

            {expanded && (
              <span className="min-w-0 flex-1 truncate">{item.title}</span>
            )}

            {counts[item.path] > 0 && (
              <NavBadge count={counts[item.path]} expanded={expanded} />
            )}

            {/* Collapsed rail needs the label on hover; inverted, like the
                Tooltip primitive. Also fires on keyboard focus. */}
            {!expanded && (
              <>
                <span className="sr-only">{item.title}</span>
                <span
                  aria-hidden
                  className="pointer-events-none absolute left-full z-50 ml-3 scale-95 rounded-md bg-foreground px-3 py-1.5 text-xs whitespace-nowrap text-background opacity-0 transition-all duration-200 ease-luxe group-hover:scale-100 group-hover:opacity-100 group-focus-visible:scale-100 group-focus-visible:opacity-100"
                >
                  {item.title}
                </span>
              </>
            )}
          </Link>
        );
      })}
    </div>
  );
}

export default function Sidebar() {
  const location = useLocation();
  const { isCollapsed, isMobileOpen, setMobileOpen } = useLayoutStore();
  const expanded = !isCollapsed;
  const user = useAuthStore((s) => s.user);
  const logoutMutation = useAdminLogout();
  const { userRoles } = useRoles();
  // Badge counts, keyed by nav path. An in-flight or failed request simply
  // means no badges — the nav must render regardless of whether this resolves.
  const { data: workQueues } = useWorkQueues();
  const queueCounts = workQueues?.counts ?? {};

  const pageOverrides = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const o of user?.pageOverrides || []) map[o.routePath] = o.allowed;
    return map;
  }, [user?.pageOverrides]);

  // Filter navigation categories based on user roles
  const filteredNavCategories = useMemo(() => {
    // SUPERADMIN sees everything
    if (isSuperAdmin(userRoles)) return navCategories;

    return navCategories
      .map((category) => ({
        ...category,
        items: category.items.filter((item) =>
          canAccessRoute(userRoles, item.path, pageOverrides) &&
          // An item that names its own audience is the deliberate exception to
          // dashboard-wide open access — see NavItem.roles.
          (!item.roles || item.roles.some((r) => userRoles.includes(r)))
        ),
      }))
      .filter((category) => category.items.length > 0);
  }, [userRoles, pageOverrides]);

  const handleLogout = async () => {
    try {
      await logoutMutation.mutateAsync();
    } catch {
      // Clear local state even if endpoint fails
    }
    window.location.href = "/login";
  };

  const initials = user
    ? `${user.firstName?.[0] || ""}${user.surname?.[0] || ""}`.toUpperCase()
    : "AH";

  const displayName = user ? `${user.firstName} ${user.surname}` : "Admin";

  return (
    <>
      {isMobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity duration-300 ease-luxe md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          "fixed top-0 bottom-0 left-0 z-50 flex flex-col overflow-hidden border-r",
          "border-sidebar-border bg-sidebar text-sidebar-foreground",
          // The guide drives sidebar width at 200ms on a linear curve — the
          // one place in the system that isn't ease-luxe.
          "transition-[width] duration-200 ease-linear",
          isMobileOpen ? "translate-x-0" : "-translate-x-full",
          "md:translate-x-0",
          expanded ? "w-64" : "w-12",
        )}
        aria-label="Sidebar navigation"
      >
        {/* Header */}
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-sidebar-border px-3">
          <div
            className={cn(
              "flex min-w-0 items-center gap-2.5",
              !expanded && "flex-1 justify-center",
            )}
          >
            <img
              src="/logo.png"
              alt=""
              aria-hidden
              className="size-6 shrink-0"
            />
            {expanded && (
              <span className="min-w-0 truncate text-sm font-normal tracking-tight">
                Soroman
              </span>
            )}
          </div>
        </div>

        {/* Navigation Categories */}
        <nav
          className="flex-1 space-y-1 overflow-x-hidden overflow-y-auto py-3"
          aria-label="Primary"
        >
          {filteredNavCategories.map((group) => (
            <NavGroup
              key={group.category || "__overview"}
              label={group.category}
              items={group.items}
              expanded={expanded}
              location={location}
              onItemClick={() => setMobileOpen(false)}
              counts={queueCounts}
            />
          ))}
        </nav>

        {/* User / Logout Footer */}
        <div className="shrink-0 border-t border-sidebar-border p-2">
          {expanded ? (
            <Link
              to="/profile"
              className="mb-2 flex items-center gap-2.5 rounded-lg px-1 py-1.5 outline-none transition-colors duration-250 ease-luxe hover:bg-sidebar-accent focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <Avatar>
                <AvatarFallback className="text-xs font-normal">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <div className="truncate text-sm font-normal">{displayName}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {user?.email || "admin"}
                </div>
              </div>
            </Link>
          ) : (
            <Link to="/profile" className="mb-2 flex justify-center" title="My profile">
              <Avatar>
                <AvatarFallback className="text-xs font-normal">
                  {initials}
                </AvatarFallback>
              </Avatar>
            </Link>
          )}

          {/* Tinted, never solid red. */}
          <button
            type="button"
            className={cn(
              "flex h-8 w-full cursor-pointer items-center rounded-lg text-sm font-normal",
              "text-destructive transition-colors duration-250 ease-luxe outline-none",
              "hover:bg-destructive/10 focus-visible:ring-3 focus-visible:ring-destructive/20",
              expanded ? "justify-start gap-2 px-3" : "justify-center px-0",
            )}
            onClick={handleLogout}
          >
            <LogOut className="size-4 shrink-0" />
            {expanded ? <span>Logout</span> : <span className="sr-only">Logout</span>}
          </button>
        </div>
      </aside>
    </>
  );
}
