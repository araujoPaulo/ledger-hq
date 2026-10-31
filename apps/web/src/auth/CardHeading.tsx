/** The card's own heading block: AuthLayout has no PageHeader, by design. */
export function CardHeading({ title, intro }: { title: string; intro?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {intro !== undefined && <p className="text-sm text-muted">{intro}</p>}
    </div>
  )
}
