import React, { useState, useEffect, useMemo } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  Search,
  GaugeIcon,
  ShoppingBag,
  PlusCircle,
  Users,
  Ticket,
  Warehouse,
  Package,
  DollarSign,
  Truck,
  Contact,
  Fuel,
  FileText,
  ShieldCheck,
  Moon,
  Sun,
  ArrowRight,
  Flame,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '#/components/ui/dialog'
import { useLayoutStore } from '#/stores/layoutStore'

interface CommandItem {
  id: string
  title: string
  category: 'Navigation' | 'Actions' | 'Settings'
  icon: React.ComponentType<{ size?: number; className?: string }>
  path?: string
  action?: () => void
  keywords?: string[]
}

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const { theme, toggleTheme } = useLayoutStore()

  const commandItems: CommandItem[] = useMemo(
    () => [
      // Navigation
      { id: 'nav-overview', title: 'Overview Dashboard', category: 'Navigation', icon: GaugeIcon, path: '/overview', keywords: ['home', 'metrics', 'stats'] },
      { id: 'nav-orders', title: 'Orders Ledger', category: 'Navigation', icon: ShoppingBag, path: '/orders', keywords: ['transactions', 'sales'] },
      { id: 'nav-payable-orders', title: 'Payable Orders', category: 'Navigation', icon: DollarSign, path: '/payable-orders', keywords: ['wallet', 'pay', 'pending'] },
      { id: 'nav-create-order', title: 'Create Order Wizard', category: 'Navigation', icon: PlusCircle, path: '/admin-order', keywords: ['new order', 'checkout'] },
      { id: 'nav-people', title: 'Customers & Leads', category: 'Navigation', icon: Users, path: '/people', keywords: ['clients', 'accounts', 'customers', 'leads', 'contacts'] },
      { id: 'nav-dangote-orders', title: 'Dangote Orders', category: 'Navigation', icon: ShoppingBag, path: '/dangote-orders', keywords: ['dangote', 'delivery'] },
      { id: 'nav-dangote-payable', title: 'Payable Dangote Orders', category: 'Navigation', icon: DollarSign, path: '/dangote-payable-orders', keywords: ['dangote', 'wallet', 'pay'] },
      { id: 'nav-tickets', title: 'Loading Tickets', category: 'Navigation', icon: Ticket, path: '/ticket', keywords: ['passes', 'waybills'] },
      { id: 'nav-depots', title: 'Depots & Storage', category: 'Navigation', icon: Warehouse, path: '/depots', keywords: ['warehouses', 'tanks', 'capacity'] },
      { id: 'nav-lpg-stations', title: 'LPG Stations', category: 'Navigation', icon: Flame, path: '/lpg-stations', keywords: ['lpg', 'gas', 'home delivery', 'station'] },
      { id: 'nav-products', title: 'Product Inventory', category: 'Navigation', icon: Package, path: '/products', keywords: ['pms', 'ago', 'dpk', 'lpg'] },
      { id: 'nav-deposits', title: 'Financial Deposits', category: 'Navigation', icon: DollarSign, path: '/deposits', keywords: ['payments', 'ledger', 'balance'] },
      { id: 'nav-trucks', title: 'Fleet', category: 'Navigation', icon: Truck, path: '/fleet-trucks', keywords: ['vehicles', 'tankers'] },
      { id: 'nav-drivers', title: 'Drivers Directory', category: 'Navigation', icon: Contact, path: '/drivers', keywords: ['logistics', 'personnel'] },
      { id: 'nav-delivery-ops', title: 'Delivery Operations', category: 'Navigation', icon: Package, path: '/delivery-operations', keywords: ['dispatch', 'allocations'] },
      { id: 'nav-sales-ledger', title: 'Sales Ledger', category: 'Navigation', icon: DollarSign, path: '/sales-ledger', keywords: ['truck sales', 'filling stations'] },
      { id: 'nav-filling-stations', title: 'Filling Stations', category: 'Navigation', icon: Fuel, path: '/filing-stations', keywords: ['pumps', 'retail'] },
      { id: 'nav-pfi', title: 'PFI Tracking', category: 'Navigation', icon: FileText, path: '/pfi', keywords: ['proforma', 'invoice'] },
      { id: 'nav-admin', title: 'Admin Settings', category: 'Navigation', icon: ShieldCheck, path: '/admin', keywords: ['permissions', 'config'] },

      // Quick Actions
      {
        id: 'act-new-order',
        title: 'Start New Order Process',
        category: 'Actions',
        icon: PlusCircle,
        path: '/admin-order',
        keywords: ['buy', 'create'],
      },

      // Settings
      {
        id: 'set-theme',
        title: `Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`,
        category: 'Settings',
        icon: theme === 'dark' ? Sun : Moon,
        action: () => {
          toggleTheme()
        },
        keywords: ['dark mode', 'light mode', 'theme', 'color'],
      },
    ],
    [theme, toggleTheme]
  )

  const filteredItems = useMemo(() => {
    if (!query.trim()) return commandItems
    const q = query.toLowerCase()
    return commandItems.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q) ||
        item.keywords?.some((k) => k.toLowerCase().includes(q))
    )
  }, [commandItems, query])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  const handleSelect = (item: CommandItem) => {
    onOpenChange(false)
    setQuery('')
    if (item.action) {
      item.action()
    } else if (item.path) {
      navigate({ to: item.path as any })
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((prev) => (prev + 1) % (filteredItems.length || 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((prev) => (prev - 1 + filteredItems.length) % (filteredItems.length || 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (filteredItems[selectedIndex]) {
        handleSelect(filteredItems[selectedIndex])
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl p-0 overflow-hidden border-border bg-background rounded-xl">
        <DialogTitle className="sr-only">Quick Search & Navigation</DialogTitle>
        <div className="flex items-center border-b border-border px-4 py-3 bg-muted/30">
          <Search className="size-5 text-muted-foreground mr-3 shrink-0" />
          <input
            type="text"
            placeholder="Type a command or search dashboard..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            autoFocus
          />
          <kbd className="hidden sm:inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs font-mono text-muted-foreground border border-border">
            ESC
          </kbd>
        </div>

        <div className="max-h-80 overflow-y-auto p-2">
          {filteredItems.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No matching commands or pages found.
            </div>
          ) : (
            <div className="space-y-1">
              {filteredItems.map((item, index) => {
                const Icon = item.icon
                const isSelected = index === selectedIndex

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelect(item)}
                    onMouseEnter={() => setSelectedIndex(index)}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs sm:text-sm text-left transition-colors cursor-pointer ${
 isSelected
 ? 'bg-primary text-primary-foreground font-normal '
 : 'hover:bg-muted text-foreground'
 }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`size-8 rounded-lg flex items-center justify-center shrink-0 ${
 isSelected
 ? 'bg-primary-foreground/20 text-primary-foreground'
 : 'bg-muted text-muted-foreground'
 }`}
                      >
                        <Icon className="size-4" />
                      </div>
                      <div className="min-w-0 truncate">
                        <div className="font-normal truncate">{item.title}</div>
                        <div
                          className={`text-xs truncate ${
 isSelected ? 'text-primary-foreground/80' : 'text-muted-foreground'
 }`}
                        >
                          {item.category}
                        </div>
                      </div>
                    </div>
                    <ArrowRight
                     
                      className={`size-3.5 shrink-0 transition-transform ${
 isSelected ? 'translate-x-0.5 text-primary-foreground' : 'opacity-0'
 }`} />
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="border-t border-border px-4 py-2 bg-muted/30 flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-3">
            <span>
              <kbd className="px-1 py-0.5 rounded bg-muted border border-border">↑↓</kbd> navigate
            </span>
            <span>
              <kbd className="px-1 py-0.5 rounded bg-muted border border-border">↵</kbd> select
            </span>
          </div>
          <div>Soroman Command Search</div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
