import { ObligationsDashboard } from './obligations/ObligationsDashboard'
import { ReceivablesSection } from './billing/ReceivablesSection'

export function HomePage() {
  return (
    <div className="flex flex-col gap-8">
      <ObligationsDashboard />
      <ReceivablesSection />
    </div>
  )
}
