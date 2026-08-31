import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from '#/components/ui/dialog'
import { Pencil, Loader2, DollarSign, Droplets, Split } from 'lucide-react'
import type { Pfi } from '#/lib/hooks/usePfis'

interface EditTarget {
  id: string
  truckPlate: string
  currentCode: string
  currentPfi: string
  currentDepot: string
  currentDate: string
  currentLocation: string
  currentRate: number
  /** The whole load, as shown on the row. */
  currentQty: number
  /** What the load's customers already account for. */
  assignedQty: number
  /** How many customers share this truck. 1 or 0 is not a split. */
  shareCount: number
}

interface EditForm {
  code: string
  pfi: string
  depot: string
  date: string
  location: string
  rate: string
  quantity: string
}

interface EditRecordDialogProps {
  target: EditTarget | null
  form: EditForm
  setForm: (form: EditForm) => void
  deliveryCodes: string[]
  allPfiOptions: { id: string; label: string }[]
  pfiMap: Map<string, Pfi>
  onClose: () => void
  onSave: () => void
  loading: boolean
}

export function EditRecordDialog({
  target, form, setForm, deliveryCodes, allPfiOptions, pfiMap,
  onClose, onSave, loading,
}: EditRecordDialogProps) {
  if (!target) return null

  return (
    <Dialog open={!!target} onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="max-w-lg max-h-[90svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="size-4 text-muted-foreground" />
            Edit Record — {target.truckPlate}
          </DialogTitle>
          <DialogDescription>
            Update the allocation details for this truck record.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-muted-foreground uppercase">
              Allocation Code
            </Label>
            <div className="flex gap-2">
              <select
                aria-label="Allocation code"
                value={form.code}
                onChange={e => setForm({ ...form, code: e.target.value })}
                className="h-8 flex-1 rounded-lg border border-border bg-white px-2.5 text-base md:text-sm"
              >
                <option value="">No code</option>
                {deliveryCodes.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <Input
                placeholder="Custom code"
                value={form.code}
                onChange={e => setForm({ ...form, code: e.target.value.toUpperCase().replace(/\s+/g, '-') })}
                className="h-9 w-32 text-sm"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-muted-foreground uppercase">
              PFI
            </Label>
            <select
              aria-label="PFI"
              value={form.pfi}
              onChange={e => {
                setForm({ ...form, pfi: e.target.value })
                const pfi = pfiMap.get(e.target.value)
                if (pfi?.locationName) setForm({ ...form, pfi: e.target.value, depot: pfi.locationName || form.depot })
              }}
              className="h-8 w-full rounded-lg border border-border bg-white px-2.5 text-base md:text-sm"
            >
              <option value="">Select PFI...</option>
              {allPfiOptions.map(p => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground uppercase">
                Depot
              </Label>
              <Input
                value={form.depot}
                onChange={e => setForm({ ...form, depot: e.target.value })}
                className="h-9 text-sm"
                placeholder="Depot name"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground uppercase">
                Date Loaded
              </Label>
              <Input
                type="date"
                value={form.date}
                onChange={e => setForm({ ...form, date: e.target.value })}
                className="h-9 text-sm"
              />
            </div>
          </div>

          {/* The load's total volume.
              This is the field that had no home. A split truck's total lives
              on the allocation and nowhere else, and the only place it could
              be typed was the ledger's Row Setup, where the number meant one
              customer's share — so editing a share overwrote the load. It is
              editable here now, next to the depot and date it belongs with. */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-muted-foreground uppercase flex items-center gap-1">
              <Droplets className="size-3.5" /> Quantity loaded (whole truck)
            </Label>
            <Input
              type="number"
              value={form.quantity}
              onChange={e => setForm({ ...form, quantity: e.target.value })}
              className="h-9 text-sm"
              placeholder="e.g. 45000"
            />
            {target.shareCount > 1 && (
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <Split className="mt-0.5 size-3 shrink-0 text-blue-600 dark:text-blue-400" />
                <span>
                  Split between {target.shareCount} customers accounting for{' '}
                  <strong className="text-foreground">{target.assignedQty.toLocaleString()} L</strong>. The whole load
                  should be at least that much.
                </span>
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground uppercase">
                Destination / Location
              </Label>
              <Input
                value={form.location}
                onChange={e => setForm({ ...form, location: e.target.value })}
                className="h-9 text-sm"
                placeholder="Destination"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground uppercase flex items-center gap-1">
                <DollarSign className="size-3.5" /> Rate (per litre)
              </Label>
              <Input
                type="number"
                value={form.rate}
                onChange={e => setForm({ ...form, rate: e.target.value })}
                className="h-9 text-sm"
                placeholder="e.g. 850"
              />
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={loading} className="gap-2">
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Pencil className="size-4" />}
            {loading ? 'Saving...' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
