import { useState, useEffect, useMemo } from 'react'
import { PageHeader } from '#/components/PageHeader'
import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '#/components/ui/select'
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '#/components/ui/card'
import { Badge } from '#/components/ui/badge'
import { ArrowLeft, Landmark, Warehouse, Loader2, Search, Check, X, Star, Flame } from 'lucide-react'
import {
  useBankAccounts,
  useCreateBankAccount,
  useUpdateBankAccount,
  useBankAccountDetails,
  type BankAccount,
} from '#/lib/hooks/useBankAccounts'
import { useDepots } from '#/lib/hooks/useDepots'
import { usePfiList } from '#/lib/hooks/usePfis'
import { useLpgStations } from '#/lib/hooks/useLpgStations'
import { useToast } from '#/lib/hooks/useToast'
import { routeGuard } from '#/lib/route-guard'

export const Route = createFileRoute('/bank-accounts/form')({
  beforeLoad: () => routeGuard('/bank-accounts'),
  component: BankAccountForm,
})

const NIGERIAN_BANKS = [
  'Zenith Bank',
  'Guaranty Trust Bank (GTBank)',
  'First Bank of Nigeria',
  'Access Bank',
  'United Bank for Africa (UBA)',
  'Wema Bank',
  'Sterling Bank',
  'Fidelity Bank',
  'Union Bank',
  'Stanbic IBTC Bank',
  'Kuda Bank',
  'Moniepoint Microfinance Bank',
  'OPay',
  'Ecobank Nigeria',
  'First City Monument Bank (FCMB)',
  'Providus Bank',
  'Other (Custom Bank)',
]

const BANK_CODES_MAP: Record<string, string> = {
  'Zenith Bank': '057',
  'Guaranty Trust Bank (GTBank)': '058',
  'First Bank of Nigeria': '011',
  'Access Bank': '044',
  'United Bank for Africa (UBA)': '033',
  'Wema Bank': '035',
  'Sterling Bank': '232',
  'Fidelity Bank': '070',
  'Union Bank': '032',
  'Stanbic IBTC Bank': '221',
  'Kuda Bank': '50211',
  'Moniepoint Microfinance Bank': '50515',
  'OPay': '999992',
  'Ecobank Nigeria': '050',
  'First City Monument Bank (FCMB)': '214',
  'Providus Bank': '101',
}

function BankAccountForm() {
  const navigate = useNavigate()
  const router = useRouter()
  const toast = useToast()
  const createBankAccount = useCreateBankAccount()
  const updateBankAccount = useUpdateBankAccount()

  const stateData = router.history.location.state as { bankAccount?: BankAccount; isEdit?: boolean } | undefined
  const searchParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
  const accountIdFromUrl = searchParams?.get('id') || searchParams?.get('accountId') || ''

  const stateAccount = stateData?.bankAccount
  const accountId = stateAccount?.id || accountIdFromUrl
  const isEdit = Boolean(stateData?.isEdit || accountId)

  const { data: fetchedAccount, isLoading: isLoadingAccount } = useBankAccountDetails(accountId)
  const editingAccount = stateAccount || fetchedAccount

  const { data: depots = [], isLoading: isLoadingDepots } = useDepots()
  // Assignment is per PFI now: two PFIs can run out of one location at the
  // same time and need separate accounts, which a location-level link cannot
  // express. The location is shown, never chosen — it is whatever the selected
  // PFIs sit in, and the server derives depotIds from exactly that.
  const { data: pfiData, isLoading: isLoadingPfis } = usePfiList({ limit: 500 })
  const allPfis = pfiData?.pfis ?? []
  const depotNameById = new Map(depots.map((d) => [Number(d.id), d.name]))
  const locationOf = (pfi: { locationId?: number | string | null; locationName?: string | null }) =>
    pfi.locationName || depotNameById.get(Number(pfi.locationId)) || 'No location'
  const { data: lpgStations = [], isLoading: isLoadingStations } = useLpgStations({ limit: 100 })
  const { data: allBankAccounts = [] } = useBankAccounts()

  const alreadyAssignedPfiIds = useMemo(() => {
    const assignedSet = new Set<number>()
    for (const acc of allBankAccounts) {
      if (isEdit && accountId && String(acc.id) === String(accountId)) {
        continue
      }
      const rawIds = acc.pfiIds
      if (Array.isArray(rawIds)) {
        for (const dId of rawIds) {
          const numId = Number(dId)
          if (!isNaN(numId) && numId > 0) {
            assignedSet.add(numId)
          }
        }
      }
    }
    return assignedSet
  }, [allBankAccounts, isEdit, accountId])

  const alreadyAssignedStationIds = useMemo(() => {
    const assignedSet = new Set<number>()
    for (const acc of allBankAccounts) {
      if (isEdit && accountId && String(acc.id) === String(accountId)) {
        continue
      }
      const rawIds = acc.lpgStationIds || (acc.lpgStations || []).map((s: any) => typeof s === 'object' ? (s.id || s._id) : s)
      if (Array.isArray(rawIds)) {
        for (const sId of rawIds) {
          const numId = Number(sId)
          if (!isNaN(numId) && numId > 0) {
            assignedSet.add(numId)
          }
        }
      }
    }
    return assignedSet
  }, [allBankAccounts, isEdit, accountId])

  // A PFI already collecting into another account is not offered here — one
  // PFI, one account. Two PFIs in the same location can now differ, which is
  // the whole point of moving the assignment off the location.
  const availablePfis = allPfis.filter((p) => !alreadyAssignedPfiIds.has(Number(p.id)))
  const availableLpgStations = lpgStations.filter(
    (s: any) => !alreadyAssignedStationIds.has(Number(s.id || s._id))
  )

  // Form State
  const [selectedBankPreset, setSelectedBankPreset] = useState<string>(
    () => {
      if (!stateAccount) return 'Zenith Bank'
      const bank = (stateAccount.bankName || '').trim()
      if (NIGERIAN_BANKS.includes(bank)) return bank
      if (bank) return 'Other (Custom Bank)'
      return 'Zenith Bank'
    }
  )
  const [customBankName, setCustomBankName] = useState<string>(
    () => {
      if (!stateAccount) return ''
      const bank = (stateAccount.bankName || '').trim()
      return NIGERIAN_BANKS.includes(bank) ? '' : bank
    }
  )
  const [accountName, setAccountName] = useState<string>(stateAccount?.accountName || '')
  const [accountNumber, setAccountNumber] = useState<string>(stateAccount?.accountNumber || '')
  const [bankCode, setBankCode] = useState<string>(
    () => stateAccount?.bankCode || BANK_CODES_MAP[stateAccount?.bankName || 'Zenith Bank'] || '057'
  )
  const [branchName, setBranchName] = useState<string>(stateAccount?.branchName || '')
  const [currency, setCurrency] = useState<string>(stateAccount?.currency || 'NGN')
  const [status, setStatus] = useState<'Active' | 'Inactive' | 'Suspended'>(stateAccount?.status || 'Active')
  const [isDefault, setIsDefault] = useState<boolean>(Boolean(stateAccount?.isDefault))
  const [notes, setNotes] = useState<string>(stateAccount?.notes || '')

  // Depot Multi-Select State
  const [selectedDepotIds, setSelectedDepotIds] = useState<number[]>(() => {
    if (!stateAccount) return []
    const rawDepotIds = stateAccount.pfiIds
    return (Array.isArray(rawDepotIds) ? rawDepotIds : [])
      .map((i) => Number(i))
      .filter((i) => !isNaN(i) && i > 0)
  })
  const [depotSearchTerm, setDepotSearchTerm] = useState<string>('')

  // LPG Station Multi-Select State
  const [selectedLpgStationIds, setSelectedLpgStationIds] = useState<number[]>(() => {
    if (!stateAccount) return []
    const rawStationIds = stateAccount.lpgStationIds || (stateAccount.lpgStations || []).map((s: any) => typeof s === 'object' ? (s.id || s._id) : s)
    return (Array.isArray(rawStationIds) ? rawStationIds : [])
      .map((i) => Number(i))
      .filter((i) => !isNaN(i) && i > 0)
  })
  const [stationSearchTerm, setStationSearchTerm] = useState<string>('')

  const handleBankPresetChange = (preset: string) => {
    setSelectedBankPreset(preset)
    if (preset !== 'Other (Custom Bank)' && BANK_CODES_MAP[preset]) {
      setBankCode(BANK_CODES_MAP[preset])
    }
  }

  // Populate form when fetched account loads
  useEffect(() => {
    const acc = fetchedAccount || stateAccount
    if (acc) {
      const bank = (acc.bankName || '').trim()
      if (NIGERIAN_BANKS.includes(bank)) {
        setSelectedBankPreset(bank)
      } else if (bank) {
        setSelectedBankPreset('Other (Custom Bank)')
        setCustomBankName(bank)
      }
      setAccountName(acc.accountName || '')
      setAccountNumber(acc.accountNumber || '')
      setBankCode(acc.bankCode || BANK_CODES_MAP[bank] || '')
      setBranchName(acc.branchName || '')
      setCurrency(acc.currency || 'NGN')
      setStatus(acc.status || 'Active')
      setIsDefault(Boolean(acc.isDefault))
      setNotes(acc.notes || '')

      const rawDepotIds = acc.pfiIds
      const numericIds = (Array.isArray(rawDepotIds) ? rawDepotIds : [])
        .map((i) => Number(i))
        .filter((i) => !isNaN(i) && i > 0)
      setSelectedDepotIds(numericIds)

      const rawStationIds = acc.lpgStationIds || (acc.lpgStations || []).map((s: any) => typeof s === 'object' ? (s.id || s._id) : s)
      const numericStationIds = (Array.isArray(rawStationIds) ? rawStationIds : [])
        .map((i) => Number(i))
        .filter((i) => !isNaN(i) && i > 0)
      setSelectedLpgStationIds(numericStationIds)
    }
  }, [fetchedAccount])

  const toggleDepotSelection = (id: number) => {
    setSelectedDepotIds((prev) =>
      prev.includes(id) ? prev.filter((dId) => dId !== id) : [...prev, id]
    )
  }

  const handleSelectAllDepots = () => {
    setSelectedDepotIds(availablePfis.map((p) => Number(p.id)).filter((id) => !isNaN(id)))
  }

  const handleClearDepotSelection = () => {
    setSelectedDepotIds([])
  }

  const toggleStationSelection = (id: number) => {
    setSelectedLpgStationIds((prev) =>
      prev.includes(id) ? prev.filter((sId) => sId !== id) : [...prev, id]
    )
  }

  const handleSelectAllStations = () => {
    setSelectedLpgStationIds(availableLpgStations.map((s: any) => Number(s.id || s._id)).filter((id) => !isNaN(id)))
  }

  const handleClearStationSelection = () => {
    setSelectedLpgStationIds([])
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const finalBankName = selectedBankPreset === 'Other (Custom Bank)' ? customBankName.trim() : selectedBankPreset.trim()
    const resolvedBankCode = bankCode.trim() || BANK_CODES_MAP[finalBankName] || ''

    if (!finalBankName) {
      toast.error('Please select or specify a bank name')
      return
    }
    if (!accountName.trim()) {
      toast.error('Please enter the account name')
      return
    }
    if (!accountNumber.trim() || accountNumber.trim().length < 5) {
      toast.error('Please enter a valid account number')
      return
    }

    const payload = {
      bankName: finalBankName,
      accountName: accountName.trim(),
      accountNumber: accountNumber.trim(),
      bankCode: resolvedBankCode,
      branchName: branchName.trim(),
      currency,
      status,
      isDefault,
      pfiIds: selectedDepotIds,
      lpgStationIds: selectedLpgStationIds,
      notes: notes.trim(),
    }

    try {
      if (isEdit && accountId) {
        await updateBankAccount.mutateAsync({ id: accountId, data: payload })
      } else {
        await createBankAccount.mutateAsync(payload)
      }
      navigate({ to: '/bank-accounts' })
    } catch (err) {
      // Handled in mutation onError toast
    }
  }

  const filteredPfis = availablePfis.filter((pfi) =>
    (pfi.pfiNumber || '').toLowerCase().includes(depotSearchTerm.toLowerCase()) ||
    locationOf(pfi).toLowerCase().includes(depotSearchTerm.toLowerCase()) ||
    (pfi.productName || '').toLowerCase().includes(depotSearchTerm.toLowerCase())
  )

  const isSubmitting = createBankAccount.isPending || updateBankAccount.isPending

  if (isEdit && isLoadingAccount && !editingAccount) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <Loader2 className="size-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground mt-3">Loading bank account details...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-4xl mx-auto pb-12">
      {/* Top Header */}
      <div className="flex items-center justify-between gap-4">
        <Button variant="ghost" size="sm" onClick={() => navigate({ to: '/bank-accounts' })}>
          <ArrowLeft className="size-4 mr-2" /> Back to Bank Accounts
        </Button>
      </div>

      <PageHeader
      eyebrow="Finance"
      title={isEdit ? 'Edit Bank Account' : 'Add New Bank Account'}
      description={isEdit ? 'Update bank account details and depot assignments' : 'Create a new corporate bank account and assign it to operational depots'}
    />

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Card 1: Bank & Account Info */}
        <Card className="border-border/60">
          <CardHeader className="border-b border-border/40 pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Landmark className="size-4 text-primary" /> Account Information
            </CardTitle>
            <CardDescription className="text-xs">Provide official bank and account details</CardDescription>
          </CardHeader>
          <CardContent className="pt-6 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Bank Name Preset */}
              <div className="space-y-1.5">
                <Label htmlFor="bankPreset" className="text-xs font-semibold">
                  Bank Name <span className="text-destructive">*</span>
                </Label>
                <Select value={selectedBankPreset} onValueChange={handleBankPresetChange}>
                  <SelectTrigger id="bankPreset" className="bg-background/50">
                    <SelectValue placeholder="Select Bank" />
                  </SelectTrigger>
                  <SelectContent className="max-h-60">
                    {NIGERIAN_BANKS.map((b) => (
                      <SelectItem key={b} value={b}>
                        {b}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Custom Bank Name input if "Other" */}
              {selectedBankPreset === 'Other (Custom Bank)' ? (
                <div className="space-y-1.5">
                  <Label htmlFor="customBank" className="text-xs font-semibold">
                    Custom Bank Name <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="customBank"
                    placeholder="Enter custom bank name"
                    value={customBankName}
                    onChange={(e) => setCustomBankName(e.target.value)}
                    className="bg-background/50"
 />
                </div>
              ) : (
                /* Bank Code / Sort Code */
                <div className="space-y-1.5">
                  <Label htmlFor="bankCode" className="text-xs font-semibold">
                    Bank Code / Sort Code (Optional)
                  </Label>
                  <Input
                    id="bankCode"
                    placeholder="e.g. 057"
                    value={bankCode}
                    onChange={(e) => setBankCode(e.target.value)}
                    className="bg-background/50 font-mono"
 />
                </div>
              )}

              {/* Account Number */}
              <div className="space-y-1.5">
                <Label htmlFor="accountNumber" className="text-xs font-semibold">
                  Account Number <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="accountNumber"
                  placeholder="e.g. 1012345678"
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value)}
                  className="bg-background/50 font-mono text-base font-semibold"
 />
              </div>

              {/* Account Name */}
              <div className="space-y-1.5">
                <Label htmlFor="accountName" className="text-xs font-semibold">
                  Account Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="accountName"
                  placeholder="e.g. Soroman Logistics Ltd - Apapa Ops"
                  value={accountName}
                  onChange={(e) => setAccountName(e.target.value)}
                  className="bg-background/50"
 />
              </div>

              {/* Branch Name */}
              <div className="space-y-1.5">
                <Label htmlFor="branchName" className="text-xs font-semibold">
                  Branch Name (Optional)
                </Label>
                <Input
                  id="branchName"
                  placeholder="e.g. Ikeja Main Branch"
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  className="bg-background/50"
 />
              </div>

              {/* Currency */}
              <div className="space-y-1.5">
                <Label htmlFor="currency" className="text-xs font-semibold">
                  Currency
                </Label>
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger id="currency" className="bg-background/50">
                    <SelectValue placeholder="Select Currency" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NGN">NGN (Nigerian Naira ₦)</SelectItem>
                    <SelectItem value="USD">USD (US Dollar $)</SelectItem>
                    <SelectItem value="EUR">EUR (Euro €)</SelectItem>
                    <SelectItem value="GBP">GBP (Pound Sterling £)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Status */}
              <div className="space-y-1.5">
                <Label htmlFor="status" className="text-xs font-semibold">
                  Status
                </Label>
                <Select value={status} onValueChange={(val) => setStatus(val as any)}>
                  <SelectTrigger id="status" className="bg-background/50">
                    <SelectValue placeholder="Select Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Active">Active</SelectItem>
                    <SelectItem value="Inactive">Inactive</SelectItem>
                    <SelectItem value="Suspended">Suspended</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Default Account Checkbox */}
            <div className="pt-3 border-t border-border/40">
              <label className="flex items-center gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={isDefault}
                  onChange={(e) => setIsDefault(e.target.checked)}
                  className="size-4 rounded border-border text-primary focus:ring-primary accent-primary"
 />
                <div>
                  <span className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                    <Star className="size-4 text-warning fill-warning" /> Set as Primary / Default Company Account
                  </span>
                  <p className="text-xs text-muted-foreground">
                    When checked, this account will be highlighted as the primary operating collection account.
                  </p>
                </div>
              </label>
            </div>
          </CardContent>
        </Card>

        {/* Card 2: Depot Assignments */}
        <Card className="border-border/60">
          <CardHeader className="border-b border-border/40 pb-3 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Warehouse className="size-4 text-primary" /> Assign PFIs
              </CardTitle>
              <CardDescription className="text-xs mt-0.5">
                Choose the PFI(s) that collect into this account. The location follows the PFI — two PFIs at the same location can use different accounts.
              </CardDescription>
            </div>
            <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20 text-xs px-2.5 py-1 font-semibold">
              {selectedDepotIds.length} Selected
            </Badge>
          </CardHeader>
          <CardContent className="pt-4 space-y-4">
            {/* Search and Quick Selection Tools */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Filter by PFI, location or product..."
                  value={depotSearchTerm}
                  onChange={(e) => setDepotSearchTerm(e.target.value)}
                  className="pl-9 text-xs h-9 bg-background/50"
 />
                {depotSearchTerm && (
                  <button
                    type="button"
                    onClick={() => setDepotSearchTerm('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground hover:text-foreground"
 >
                    <X className="size-3" />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleSelectAllDepots}
                  className="h-9 text-xs"
 >
                  Select All
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleClearDepotSelection}
                  className="h-9 text-xs text-muted-foreground"
 >
                  Deselect All
                </Button>
              </div>
            </div>

            {/* Selected Depot Chips */}
            {selectedDepotIds.length > 0 && (
              <div className="p-3 bg-muted/30 border border-border/40 rounded-xl">
                <p className="text-xs font-semibold uppercase text-muted-foreground mb-2">
                  Currently Assigned ({selectedDepotIds.length}):
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {selectedDepotIds.map((id) => {
                    const pfi = allPfis.find((p) => Number(p.id) === id)
                    return (
                      <Badge
                        key={id}
                        variant="secondary"
                        className="bg-primary/15 text-primary border-primary/30 text-xs font-normal py-1 px-2.5 flex items-center gap-1.5"
 >
                        <Warehouse className="size-3" />
                        {pfi ? `${pfi.pfiNumber} · ${locationOf(pfi)}` : `PFI #${id}`}
                        <button
                          type="button"
                          onClick={() => toggleDepotSelection(id)}
                          className="hover:text-destructive transition-colors ml-1 duration-250 ease-luxe"
 >
                          <X className="size-3" />
                        </button>
                      </Badge>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Depots Checkbox List */}
            {isLoadingPfis || isLoadingDepots ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="size-5 animate-spin text-primary mr-2" />
                <span className="text-xs text-muted-foreground">Loading PFIs...</span>
              </div>
            ) : filteredPfis.length === 0 ? (
              <div className="p-6 text-center text-xs text-muted-foreground border border-dashed rounded-lg">
                {availablePfis.length === 0
                  ? 'Every PFI already collects into a bank account.'
                  : 'No available PFI matches your search.'}
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 max-h-72 overflow-y-auto pr-1">
                {filteredPfis.map((depot) => {
                  const numericId = Number(depot.id)
                  const isChecked = selectedDepotIds.includes(numericId)
                  return (
                    <div
                      key={depot.id}
                      onClick={() => toggleDepotSelection(numericId)}
                      className={`p-3 rounded-lg border cursor-pointer transition-all flex items-center justify-between select-none ${isChecked
 ? 'border-primary/50 bg-primary/10 text-foreground '
 : 'border-border/40 hover:bg-muted/30 text-muted-foreground'
 }`}
 >
                      <div className="min-w-0 flex-1 pr-2">
                        <div className="flex items-center gap-2">
                          <span className={`font-semibold text-xs ${isChecked ? 'text-primary' : 'text-foreground'}`}>
                            {depot.pfiNumber}
                          </span>
                          {depot.status !== 'active' && (
                            <span className="text-xs font-mono opacity-80">({depot.status})</span>
                          )}
                        </div>
                        {/* The location, shown rather than chosen — picking the
                            PFI is what decides it. */}
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {locationOf(depot)}{depot.productName ? ` · ${depot.productName}` : ''}
                        </p>
                      </div>

                      <div
                        className={`size-5 rounded-md border flex items-center justify-center transition-colors shrink-0 ${isChecked ? 'bg-primary border-primary text-primary-foreground' : 'border-border bg-background'
 }`}
 >
                        {isChecked && <Check className="size-3.5 stroke-[3]" />}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Card 3: LPG Station Assignments */}
        <Card className="border-border/60">
          <CardHeader className="border-b border-border/40 pb-3 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Flame className="size-4 text-primary" /> Assign LPG Cooking Gas Stations
              </CardTitle>
              <CardDescription className="text-xs mt-0.5">
                Select which LPG station(s) use this bank account for payment collection.
              </CardDescription>
            </div>
            <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20 text-xs px-2.5 py-1 font-semibold">
              {selectedLpgStationIds.length} Selected
            </Badge>
          </CardHeader>
          <CardContent className="pt-4 space-y-4">
            {/* Search and Quick Selection Tools */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Filter LPG stations..."
                  value={stationSearchTerm}
                  onChange={(e) => setStationSearchTerm(e.target.value)}
                  className="pl-9 text-xs h-9 bg-background/50"
                />
                {stationSearchTerm && (
                  <button
                    type="button"
                    onClick={() => setStationSearchTerm('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3" />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleSelectAllStations}
                  className="h-9 text-xs"
                >
                  Select All
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleClearStationSelection}
                  className="h-9 text-xs text-muted-foreground"
                >
                  Deselect All
                </Button>
              </div>
            </div>

            {/* Selected Station Chips */}
            {selectedLpgStationIds.length > 0 && (
              <div className="p-3 bg-muted/30 border border-border/40 rounded-xl">
                <p className="text-xs font-semibold uppercase text-muted-foreground mb-2">
                  Currently Assigned ({selectedLpgStationIds.length}):
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {selectedLpgStationIds.map((id) => {
                    const station = lpgStations.find((s: any) => Number(s.id || s._id) === id) as any
                    return (
                      <Badge
                        key={id}
                        variant="secondary"
                        className="bg-primary/15 text-primary border-primary/30 text-xs font-normal py-1 px-2.5 flex items-center gap-1.5"
                      >
                        <Flame className="size-3 text-primary" />
                        {station ? `${station.name} (${station.code})` : `Station #${id}`}
                        <button
                          type="button"
                          onClick={() => toggleStationSelection(id)}
                          className="hover:text-destructive transition-colors ml-1 duration-250 ease-luxe"
                        >
                          <X className="size-3" />
                        </button>
                      </Badge>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Stations Checkbox List */}
            {(() => {
              const filteredStations = availableLpgStations.filter((station: any) =>
                station.name?.toLowerCase().includes(stationSearchTerm.toLowerCase()) ||
                station.code?.toLowerCase().includes(stationSearchTerm.toLowerCase()) ||
                (station.city && station.city.toLowerCase().includes(stationSearchTerm.toLowerCase()))
              )

              if (isLoadingStations) {
                return (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="size-5 animate-spin text-primary mr-2" />
                    <span className="text-xs text-muted-foreground">Loading LPG stations list...</span>
                  </div>
                )
              }

              if (filteredStations.length === 0) {
                return (
                  <div className="p-6 text-center text-xs text-muted-foreground border border-dashed rounded-lg">
                    {availableLpgStations.length === 0
                      ? 'All operational LPG stations already have bank accounts assigned.'
                      : 'No available LPG stations match your search query.'}
                  </div>
                )
              }

              return (
                <div className="grid gap-2 sm:grid-cols-2 max-h-72 overflow-y-auto pr-1">
                  {filteredStations.map((station: any) => {
                    const numericId = Number(station.id || station._id)
                    const isChecked = selectedLpgStationIds.includes(numericId)
                    return (
                      <div
                        key={station.id || station._id}
                        onClick={() => toggleStationSelection(numericId)}
                        className={`p-3 rounded-lg border cursor-pointer transition-all flex items-center justify-between select-none ${isChecked
                          ? 'border-primary/50 bg-primary/10 text-foreground '
                          : 'border-border/40 hover:bg-muted/30 text-muted-foreground'
                        }`}
                      >
                        <div className="min-w-0 flex-1 pr-2">
                          <div className="flex items-center gap-2">
                            <span className={`font-semibold text-xs ${isChecked ? 'text-primary' : 'text-foreground'}`}>
                              {station.name}
                            </span>
                            <span className="text-xs font-mono opacity-80">({station.code})</span>
                          </div>
                          {station.city && (
                            <p className="text-xs text-muted-foreground truncate mt-0.5">{station.city}, {station.state}</p>
                          )}
                        </div>

                        <div
                          className={`size-5 rounded-md border flex items-center justify-center transition-colors shrink-0 ${isChecked ? 'bg-primary border-primary text-primary-foreground' : 'border-border bg-background'
                          }`}
                        >
                          {isChecked && <Check className="size-3.5 stroke-[3]" />}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })()}
          </CardContent>
        </Card>

        {/* Card 3: Additional Notes */}
        <Card className="border-border/60">
          <CardHeader className="border-b border-border/40 pb-3">
            <CardTitle className="text-base font-semibold">Notes & Description</CardTitle>
            <CardDescription className="text-xs">Internal notes regarding usage or specific instructions</CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            <textarea
              rows={3}
              placeholder="e.g. Primary collection account for Western Region depots..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-md border border-border/60 bg-background/50 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
 />
          </CardContent>
        </Card>

        {/* Submit Actions */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-border/40">
          <Button type="button" variant="outline" onClick={() => navigate({ to: '/bank-accounts' })}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting} className="px-6">
            {isSubmitting ? (
              <>
                <Loader2 className="size-4 animate-spin mr-2" />
                Saving...
              </>
            ) : isEdit ? (
              'Update Bank Account'
            ) : (
              'Create Bank Account'
            )}
          </Button>
        </div>
      </form>
    </div>
  )
}
