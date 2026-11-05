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

const cx = (...classes: Array<string | false>) => classes.filter(Boolean).join(' ')

/**
 * A `div` row's label truncates by default; `wrapLabel` lets it wrap instead,
 * for text the reader needs in full (a ledger description, a file name).
 * `wrap` implies `wrapLabel`, and is for rows whose value is a cluster of badges and buttons: on a
 * phone the value drops under the label (a `dl` stacks term over definition)
 * instead of squeezing the text, and from `sm` up it is one line again.
 */
function Row({
  label,
  value,
  wrap = false,
  wrapLabel = false,
}: {
  label: ReactNode
  value: ReactNode
  wrap?: boolean
  wrapLabel?: boolean
}) {
  const element = useContext(ListElementContext)
  const rowClass = cx(ROW_CLASS, wrap && 'flex-wrap')

  if (element === 'dl') {
    return (
      <div className={rowClass}>
        <dt className={cx('text-sm text-muted', wrap ? 'basis-full sm:basis-auto sm:shrink-0' : 'shrink-0')}>{label}</dt>
        <dd
          className={cx(
            'flex min-w-0 flex-1 items-center gap-3 text-sm',
            wrap ? 'flex-wrap justify-start text-left sm:justify-end sm:text-right' : 'justify-end text-right',
          )}
        >
          {value}
        </dd>
      </div>
    )
  }

  return (
    <div className={rowClass}>
      <span
        className={cx(
          'min-w-0 text-sm',
          wrap || wrapLabel ? 'break-words' : 'truncate',
          wrap ? 'grow basis-full sm:basis-0' : 'flex-1',
        )}
      >
        {label}
      </span>
      <span className={cx('flex shrink-0 items-center gap-3 text-sm', wrap && 'ml-auto')}>{value}</span>
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
