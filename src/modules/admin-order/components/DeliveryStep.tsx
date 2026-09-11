import { Truck, Warehouse, Building2, MapPin } from 'lucide-react'
import { ChoiceCard, ChoiceGrid } from '#/components/ui/choice-card'
import { Label } from '#/components/ui/label'
import { Input } from '#/components/ui/input'
import { NativeSelect } from '#/components/ui/native-select'
import { nigeriaStates, nigeriaLgas } from '#/lib/nigeria-data'
import type { OrderWizardReturn } from '../hooks/useOrderWizard'

interface DeliveryStepProps {
  wizard: OrderWizardReturn
}

const OPTIONS = [
  {
    value: 'pickup' as const,
    icon: <Warehouse />,
    title: 'Customer loads with their truck',
    subtitle: 'The customer sends their own trucks to load at the depot.',
  },
  {
    value: 'delivery' as const,
    icon: <Truck />,
    title: 'Delivery by Soroman',
    subtitle: 'Soroman delivers it with our trucks to the customer.',
  },
]

/**
 * The towns offered for a state.
 *
 * LGAs, because that is the list the system already holds and it covers the
 * place names people use. Abuja is asked for by half a dozen names and is one
 * entry in the data, so it is matched loosely rather than left empty.
 */
function townsInState(stateName: string): string[] {
  if (!stateName) return []
  const trimmed = stateName.trim()
  const lower = trimmed.toLowerCase()
  if (lower.includes('fct') || lower.includes('federal capital') || lower.includes('abuja')) {
    return nigeriaLgas['Federal Capital Territory (FCT)'] || []
  }
  const cleaned = trimmed.replace(/\s+state$/i, '').trim()
  const matched = nigeriaStates.find(
    (s) => s.toLowerCase() === lower || s.toLowerCase() === cleaned.toLowerCase(),
  )
  return nigeriaLgas[matched || stateName] || []
}

export function DeliveryStep({ wizard }: DeliveryStepProps) {
  const {
    deliveryType, setDeliveryType,
    deliveryState, setDeliveryState,
    deliveryTown, setDeliveryTown,
  } = wizard

  const towns = townsInState(deliveryState)

  return (
    <div className="space-y-6">
      <ChoiceGrid>
        {OPTIONS.map((o) => (
          <ChoiceCard
            key={o.value}
            selected={deliveryType === o.value}
            onSelect={() => {
              setDeliveryType(o.value)
              // A destination only means something while we are the ones
              // driving. Switching back to pickup clears it rather than
              // leaving it to be submitted against an order nobody delivers.
              if (o.value === 'pickup') {
                setDeliveryState('')
                setDeliveryTown('')
              }
            }}
            icon={o.icon}
            title={o.title}
            subtitle={o.subtitle}
          />
        ))}
      </ChoiceGrid>

      {/* Asked only when Soroman is driving. On a pickup the depot IS the
          address, and a destination field there is a question with no answer. */}
      {deliveryType === 'delivery' && (
        <div className="space-y-4 rounded-xl border border-border bg-muted/30 p-4 animate-fade-in">
          <div>
            <p className="text-sm font-semibold">Where is it going?</p>
            <p className="text-xs text-muted-foreground">
              The destination for the truck. The depot's own state is where it loads, not where it lands.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <Building2 className="size-3.5 text-muted-foreground" />
                State *
              </Label>
              <NativeSelect
                value={deliveryState}
                onChange={(e) => {
                  setDeliveryState(e.target.value)
                  // The towns list is per state, so a town held over from the
                  // last one would be a place in the wrong state.
                  setDeliveryTown('')
                }}
              >
                <option value="">Select state</option>
                {nigeriaStates.map((s) => <option key={s} value={s}>{s}</option>)}
              </NativeSelect>
            </div>

            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <MapPin className="size-3.5 text-muted-foreground" />
                Town *
              </Label>
              {/*
                Typed or picked, in one control.

                A plain select would refuse every delivery to somewhere the LGA
                list does not name — which is most of how people actually give
                an address ("Ijora", "Mile 2", a filling station on a road). A
                plain input would throw away a list the system already has. A
                datalist is both: the state's LGAs drop down, and anything else
                can be typed straight over them.
              */}
              <Input
                list="delivery-town-options"
                value={deliveryTown}
                onChange={(e) => setDeliveryTown(e.target.value)}
                disabled={!deliveryState}
                placeholder={deliveryState ? 'Select or type a town' : 'Select a state first'}
                autoComplete="off"
              />
              <datalist id="delivery-town-options">
                {towns.map((t) => <option key={t} value={t} />)}
              </datalist>
            </div>
          </div>

          {(deliveryState || deliveryTown) && (
            <p className="text-sm">
              <span className="text-muted-foreground">Delivering to: </span>
              <span className="font-semibold">
                {[deliveryTown.trim(), deliveryState].filter(Boolean).join(', ')}
              </span>
            </p>
          )}
        </div>
      )}
    </div>
  )
}
