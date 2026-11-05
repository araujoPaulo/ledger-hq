import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import * as RadixDialog from '@radix-ui/react-dialog'
import { cva } from 'class-variance-authority'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { Button } from './Button'

const content = cva(
  'fixed left-1/2 top-1/2 z-50 flex max-h-[90dvh] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-6 overflow-y-auto rounded-surface bg-surface p-6 shadow-overlay',
  {
    variants: { size: { sm: 'max-w-sm', md: 'max-w-lg' } },
    defaultVariants: { size: 'md' },
  },
)

type ContentProps = Omit<ComponentPropsWithoutRef<typeof RadixDialog.Content>, 'title'> & {
  /** Required: it is the dialog's accessible name, and Radix warns without one. */
  title: string
  description?: string | undefined
  size?: 'sm' | 'md' | undefined
}

/**
 * The dialog itself: portal, overlay, title, optional description, then the
 * caller's content. The close button comes after the content in the DOM —
 * positioned top-right, but last in tab order — so Radix's autofocus on open
 * lands on the first field rather than on Close.
 */
function Content({ title, description, size = 'md', className, children, ...rest }: ContentProps) {
  const { t } = useTranslation('common')

  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="fixed inset-0 z-40 bg-ink/40" />
      <RadixDialog.Content
        {...rest}
        // Without a description Radix expects to be told there is none.
        {...(description === undefined ? { 'aria-describedby': undefined } : {})}
        className={[content({ size }), className].filter(Boolean).join(' ')}
      >
        <div className="flex flex-col gap-1.5 pr-10">
          <RadixDialog.Title className="text-lg font-semibold">{title}</RadixDialog.Title>
          {description !== undefined && (
            <RadixDialog.Description className="text-sm font-normal text-muted">{description}</RadixDialog.Description>
          )}
        </div>
        {children}
        <RadixDialog.Close asChild>
          <Button variant="ghost" size="icon" aria-label={t('actions.close')} className="absolute right-4 top-4">
            <X aria-hidden="true" className="h-4 w-4" />
          </Button>
        </RadixDialog.Close>
      </RadixDialog.Content>
    </RadixDialog.Portal>
  )
}

/**
 * The action row at the foot of a dialog's form: right-aligned; on a phone the
 * buttons stretch and stack. Put Cancel first and the primary action last —
 * the stack reverses, so the primary action is on top on a phone.
 */
function Footer({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col-reverse gap-4 pt-2 sm:flex-row sm:justify-end [&>*]:w-full sm:[&>*]:w-auto">
      {children}
    </div>
  )
}

export const Dialog = Object.assign(RadixDialog.Root, {
  Trigger: RadixDialog.Trigger,
  Content,
  Footer,
  Close: RadixDialog.Close,
})
