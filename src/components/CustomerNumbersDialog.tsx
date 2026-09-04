import { useState } from 'react'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '#/components/ui/dialog'
import { ConfirmDialog } from '#/components/ConfirmDialog'
import { PhoneLink } from '#/components/ContactLink'
import { Loader2, Trash2, Star, ShieldCheck } from 'lucide-react'
import {
  useCustomerPhones, useAddCustomerPhone, useDeleteCustomerPhone, useMakePhonePrimary,
  type PersonRow, type CustomerPhone,
} from '#/lib/hooks/usePeople'

/**
 * Every number one customer can be reached — and sign in — on.
 *
 * The desk's real problem, not a nicety: a company buys under the manager's
 * line and the director's, and until now each of those had to be a separate
 * customer row. That is where the duplicate groups in the review panel came
 * from, and only one of the two could ever reach the wallet and the order
 * history the business actually holds for that customer.
 *
 * The primary is shown but has no delete button, because it has no row to
 * delete — it lives on the customer record itself (see migration 0019). The
 * way to retire it is to promote another number first, which is the action
 * offered beside every alternate.
 */
export function CustomerNumbersDialog({ person, onClose }: { person: PersonRow | null; onClose: () => void }) {
  const customerId = person?.customerId ?? null
  const { data: phones = [], isLoading } = useCustomerPhones(customerId, { enabled: Boolean(customerId) })
  const addPhone = useAddCustomerPhone(customerId)
  const deletePhone = useDeleteCustomerPhone(customerId)
  const makePrimary = useMakePhonePrimary(customerId)

  const [phone, setPhone] = useState('')
  const [label, setLabel] = useState('')
  const [removing, setRemoving] = useState<CustomerPhone | null>(null)
  const [promoting, setPromoting] = useState<CustomerPhone | null>(null)

  const submit = async () => {
    if (!phone.trim()) return
    await addPhone.mutateAsync({ phone: phone.trim(), label: label.trim() || undefined })
    setPhone('')
    setLabel('')
  }

  return (
    <>
      <Dialog open={person !== null} onOpenChange={(o) => { if (!o) onClose() }}>
        <DialogContent className="sm:max-w-[560px] max-h-[88svh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{person?.name}&rsquo;s numbers</DialogTitle>
            <DialogDescription>
              Every number here signs in to this same account. Adding one does not create
              a second customer &mdash; it is the fix for the same person being on the book twice.
            </DialogDescription>
          </DialogHeader>

          {isLoading ? (
            <div className="flex items-center justify-center py-10"><Loader2 className="size-5 animate-spin text-primary" /></div>
          ) : (
            <div className="divide-y divide-border rounded-lg border border-border">
              {phones.map((entry) => (
                <div key={entry.id ?? 'primary'} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <PhoneLink value={entry.phone} className="font-mono text-sm" />
                      {entry.isPrimary && (
                        <Badge variant="outline" className="h-5 gap-1 px-1.5 text-xs font-normal bg-accent/10 text-accent border-accent/20">
                          <Star className="size-3" />Main
                        </Badge>
                      )}
                      {entry.label && (
                        <Badge variant="outline" className="h-5 px-1.5 text-xs font-normal text-muted-foreground">
                          {entry.label}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                      {entry.verifiedAt ? (
                        <><ShieldCheck className="size-3 text-accent" />Proven by a code on this number</>
                      ) : (
                        // Not a warning. An unverified number still signs in —
                        // the code goes to it, and answering IS the proof.
                        <>Not answered on yet</>
                      )}
                    </p>
                  </div>

                  {!entry.isPrimary && (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost" size="sm" className="h-7 px-2 text-xs"
                        title={`Make ${entry.phone} the main number`}
                        onClick={() => setPromoting(entry)}
                      >
                        Make main
                      </Button>
                      <Button
                        variant="ghost" size="sm"
                        className="size-7 p-0 text-muted-foreground hover:text-destructive"
                        title={`Remove ${entry.phone}`}
                        onClick={() => setRemoving(entry)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="space-y-2 rounded-lg border border-border p-3">
            <Label className="text-xs uppercase text-muted-foreground">Add another number</Label>
            <div className="flex flex-wrap gap-2">
              <Input
                className="flex-1 min-w-[11rem]"
                placeholder="e.g. 08012345678"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
              />
              <Input
                className="w-32"
                placeholder="Label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
              />
              <Button onClick={submit} disabled={!phone.trim() || addPhone.isPending}>
                {addPhone.isPending && <Loader2 className="size-4 mr-2 animate-spin" />}Add
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              A number already on somebody else&rsquo;s account is refused, and the owner is named.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={onClose}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => { if (!o) setRemoving(null) }}
        title={`Remove ${removing?.phone ?? ''}?`}
        description="This number stops signing in to the account and stops receiving messages. The customer's orders, wallet and history are untouched."
        confirmLabel="Remove"
        variant="destructive"
        loading={deletePhone.isPending}
        onConfirm={async () => {
          if (removing?.id) await deletePhone.mutateAsync(removing.id)
          setRemoving(null)
        }}
      />

      <ConfirmDialog
        open={promoting !== null}
        onOpenChange={(o) => { if (!o) setPromoting(null) }}
        title={`Make ${promoting?.phone ?? ''} the main number?`}
        description="Order confirmations, payment messages and the bank account name all follow the main number. The current main number is kept as an alternate — it still signs in."
        confirmLabel="Make main"
        loading={makePrimary.isPending}
        onConfirm={async () => {
          if (promoting?.id) await makePrimary.mutateAsync(promoting.id)
          setPromoting(null)
        }}
      />
    </>
  )
}
