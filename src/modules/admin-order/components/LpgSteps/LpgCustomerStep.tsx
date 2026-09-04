import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Badge } from '#/components/ui/badge'
import {
  Loader2,
  Search,
  User,
  Plus,
} from 'lucide-react'
import { formatCurrency } from '../../utils/formatters'
import type { LpgOrderWizardReturn } from '../../hooks/useLpgOrderWizard'
import { PhoneLink } from '#/components/ContactLink'

interface LpgCustomerStepProps {
  wizard: LpgOrderWizardReturn
}

export function LpgCustomerStep({ wizard }: LpgCustomerStepProps) {
  const {
    customerSearch,
    setCustomerSearch,
    isSearchOpen,
    setIsSearchOpen,
    searchPage,
    setSearchPage,
    selectedCustomer,
    setSelectedCustomer,
    isRegisteringCustomer,
    setIsRegisteringCustomer,
    newCustomerForm,
    setNewCustomerForm,
    customers,
    totalCustomers,
    hasMore,
    isSearchingCustomers,
    createCustomerMutation,
    handleRegisterCustomer,
  } = wizard

  return (
    <div key="lpg-step-1" className="space-y-6 animate-fade-in">

      {!isRegisteringCustomer ? (
        <div className="space-y-4">
          {selectedCustomer && !isSearchOpen ? (
            <div className="p-4 border rounded-xl bg-muted/30 space-y-3">
              <div className="flex items-center gap-2 border-b border-border pb-2">
                <div className="size-6 rounded bg-primary/10 flex items-center justify-center">
                  <User className="text-primary size-3.5" />
                </div>
                <span className="font-semibold text-sm">Selected Customer</span>
                <Badge variant="outline" className={`ml-auto ${selectedCustomer.status === 'Active' ? 'bg-success/10 text-success border-success/20' : ''}`}>
                  {selectedCustomer.status}
                </Badge>
              </div>
              <div className="flex items-center gap-3">
                <div className="bg-primary size-10 rounded-full flex items-center justify-center text-white text-sm font-semibold shrink-0">
                  {selectedCustomer.name?.charAt(0)?.toUpperCase() || '?'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-foreground">{selectedCustomer.name}</p>
                  <p className="text-xs text-muted-foreground">{selectedCustomer.companyName || 'No Company'} &bull; {selectedCustomer.phone}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => { setIsSearchOpen(true); setSelectedCustomer(null); }}>
                  Change
                </Button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                <div>
                  <span className="text-muted-foreground block">Full Name</span>
                  <span className="font-normal">{selectedCustomer.name}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Company</span>
                  <span className="font-normal">{selectedCustomer.companyName || '—'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Phone</span>
                  <PhoneLink value={selectedCustomer.phone} className="font-normal" />
                </div>
                <div>
                  <span className="text-muted-foreground block">Account Balance</span>
                  <span className={`font-semibold ${(selectedCustomer.balance || 0) < 0 ? 'text-destructive' : 'text-success'}`}>
                    {formatCurrency(selectedCustomer.balance || 0)}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground size-4" />
                  <Input
                    placeholder="Search by name, email, phone, or company..."
                    value={customerSearch}
                    onChange={(e) => { setCustomerSearch(e.target.value); setSelectedCustomer(null); setIsSearchOpen(true); }}
                    className="pl-10"
                    autoFocus
                  />
                  {customerSearch && (
                    <button
                      onClick={() => { setCustomerSearch(''); setSelectedCustomer(null); setIsSearchOpen(false); }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors duration-250 ease-luxe"
                    >
                      &times;
                    </button>
                  )}
                </div>
                <Button variant="outline" onClick={() => setIsRegisteringCustomer(true)} className="shrink-0">
                  <Plus className="size-4 mr-2" /> Register New
                </Button>
              </div>

              {!customerSearch.trim() ? (
                <div className="p-10 text-center border border-dashed rounded-xl bg-muted/20">
                  <div className="inline-flex size-12 items-center justify-center rounded-xl bg-muted border border-border mb-3">
                    <Search className="size-5 text-muted-foreground" />
                  </div>
                  <p className="text-sm font-normal text-foreground">Search for a customer</p>
                  <p className="text-xs text-muted-foreground mt-1">Type at least 2 characters to search by name, email, phone, or company.</p>
                </div>
              ) : customerSearch.trim().length < 2 ? (
                <div className="p-10 text-center border border-dashed rounded-xl bg-muted/20">
                  <div className="inline-flex size-12 items-center justify-center rounded-xl bg-muted border border-border mb-3">
                    <Search className="size-5 text-muted-foreground" />
                  </div>
                  <p className="text-sm font-normal text-foreground">Keep typing...</p>
                  <p className="text-xs text-muted-foreground mt-1">Enter at least 2 characters to start searching.</p>
                </div>
              ) : isSearchingCustomers && searchPage === 1 ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="size-6 animate-spin text-muted-foreground" />
                </div>
              ) : customers.length === 0 ? (
                <div className="p-10 text-center border border-dashed rounded-xl">
                  <div className="inline-flex size-12 items-center justify-center rounded-xl bg-muted border border-border mb-3">
                    <User className="size-5 text-muted-foreground" />
                  </div>
                  <p className="text-sm font-normal text-foreground">No customer matches found</p>
                  <p className="text-xs text-muted-foreground mt-1">Try a different search or register a new customer.</p>
                  <Button variant="ghost" size="sm" onClick={() => setIsRegisteringCustomer(true)} className="mt-3 text-primary">
                    <Plus className="size-3.5 mr-1" /> Register "{customerSearch}"
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="max-h-[320px] overflow-y-auto pr-1 space-y-2">
                    {customers.map((c: any) => (
                      <div
                        key={c._id}
                        onClick={() => { setSelectedCustomer(c); setIsSearchOpen(false); setCustomerSearch(''); }}
                        className="p-3 sm:p-4 rounded-xl border cursor-pointer transition-all duration-200 flex items-center gap-3 hover:bg-muted/50 hover:border-muted-foreground/20 border-border ease-luxe"
                      >
                        <div className="bg-primary size-10 rounded-full flex items-center justify-center text-white text-sm font-semibold shrink-0">
                          {c.name?.charAt(0)?.toUpperCase() || '?'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-sm text-foreground truncate">{c.name}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {c.companyName || 'No Company'} &bull; {c.phone}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-xs text-muted-foreground block">Balance</span>
                          <span className={`font-semibold text-sm ${(c.balance || 0) < 0 ? 'text-destructive' : 'text-foreground'}`}>
                            {formatCurrency(c.balance || 0)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <p className="text-xs text-muted-foreground">
                      Showing {customers.length} of {totalCustomers} customers
                    </p>
                    {hasMore && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs text-primary"
                        onClick={() => setSearchPage(prev => prev + 1)}
                        disabled={isSearchingCustomers}
                      >
                        {isSearchingCustomers ? (
                          <><Loader2 className="size-3 animate-spin mr-1" /> Loading...</>
                        ) : (
                          'Load More'
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="space-y-4 border p-5 rounded-xl bg-card">
          <div className="flex justify-between items-center border-b border-border pb-2">
            <div className="flex items-center gap-2">
              <div className="size-6 rounded bg-primary/10 flex items-center justify-center">
                <Plus className="text-primary size-3.5" />
              </div>
              <span className="font-semibold text-sm">New Customer Registration</span>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setIsRegisteringCustomer(false)}>Cancel</Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Customer Name *</Label>
              <Input
                placeholder="e.g. Ahmad Oluwafemi"
                value={newCustomerForm.name}
                onChange={(e) => setNewCustomerForm({ ...newCustomerForm, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Phone Number *</Label>
              <Input
                type="tel"
                inputMode="numeric"
                maxLength={14}
                placeholder="e.g. 08012345678"
                value={newCustomerForm.phone}
                onChange={(e) => setNewCustomerForm({ ...newCustomerForm, phone: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Email Address</Label>
              <Input
                type="email"
                placeholder="e.g. customer@example.com"
                value={newCustomerForm.email}
                onChange={(e) => setNewCustomerForm({ ...newCustomerForm, email: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Company Name</Label>
              <Input
                placeholder="e.g. Ahmad Logistics Ltd"
                value={newCustomerForm.companyName}
                onChange={(e) => setNewCustomerForm({ ...newCustomerForm, companyName: e.target.value })}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Address</Label>
              <Input
                placeholder="e.g. 12 Link Road, Ikeja, Lagos"
                value={newCustomerForm.address}
                onChange={(e) => setNewCustomerForm({ ...newCustomerForm, address: e.target.value })}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <Button variant="outline" onClick={() => setIsRegisteringCustomer(false)}>Cancel</Button>
            <Button
              onClick={handleRegisterCustomer}
              disabled={createCustomerMutation.isPending}
            >
              {createCustomerMutation.isPending ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
              Register & Proceed
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
