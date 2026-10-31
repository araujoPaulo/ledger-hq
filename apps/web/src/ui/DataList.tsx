import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'

type ListElement = 'div' | 'dl'

const ListElementContext = createContext<ListElement>('div')

/**
 * Label/value rows. `as="dl"` is for genuine name/value descriptions — a
 * client's details, a fiscal profile — and renders each row as
 * `<div><dt/><dd/></div>` (valid inside `<dl>` since HTML 5.2). Lists of
 * records (a ledger, employments) stay `div`. `Total` belongs to `div` lists.
 */
function DataListRoot({ as = 'div', children }: { as?: ListElement; children: ReactNode }) {
  const Element = as

  return (
    <ListElementContext.Provider value={as}>
      <Element className="flex flex-col">{children}</Element>
    </ListElementContext.Provider>
  )
}

const ROW_CLASS = 'flex min-h-[44px] items-center justify-between gap-4 border-b border-line py-3 last:border-b-0'

function Row({ label, value }: { label: ReactNode; value: ReactNode }) {
  const element = useContext(ListElementContext)

  if (element === 'dl') {
    return (
      <div className={ROW_CLASS}>
        <dt className="shrink-0 text-sm text-muted">{label}</dt>
        <dd className="flex min-w-0 flex-1 items-center justify-end gap-3 text-right text-sm">{value}</dd>
      </div>
    )
  }

  return (
    <div className={ROW_CLASS}>
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
