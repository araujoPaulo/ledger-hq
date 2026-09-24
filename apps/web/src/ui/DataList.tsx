import type { ReactNode } from 'react'

function DataListRoot({ children }: { children: ReactNode }) {
  return <div className="flex flex-col">{children}</div>
}

function Row({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex min-h-[44px] items-center justify-between gap-4 border-b border-line py-3 last:border-b-0">
      <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
      <span className="flex shrink-0 items-center gap-3 text-sm">{value}</span>
    </div>
  )
}

function Total({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex min-h-[44px] items-center justify-between gap-4 border-t border-line-strong pt-3">
      <span className="text-sm font-semibold">{label}</span>
      <span className="flex shrink-0 items-center gap-3 text-sm font-semibold">{value}</span>
    </div>
  )
}

export const DataList = Object.assign(DataListRoot, { Row, Total })
