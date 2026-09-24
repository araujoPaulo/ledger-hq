import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Lock, LogOut } from 'lucide-react'
import { DropdownMenu } from '../ui'
import { SUPPORTED_LOCALES, setLocale } from '../i18n'
import type { SupportedLocale } from '../i18n'
import { signOut } from '../auth/credentials'
import { SESSION_QUERY_KEY, useSession } from '../auth/session'
import { lockVault, useVaultState } from '../vault/vault-session'

function initialsOf(email: string): string {
  return email.slice(0, 2).toUpperCase()
}

export function AccountMenu() {
  const { t, i18n } = useTranslation('common')
  const queryClient = useQueryClient()
  const session = useSession()
  const vaultState = useVaultState()
  const email = session.data?.email ?? ''

  const signOutMutation = useMutation({
    mutationFn: signOut,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY })
    },
  })

  return (
    <DropdownMenu>
      {/*
       * The trigger is named by the session's own email: there is no key that
       * means "account menu", and the address says more than "Account" would.
       */}
      <DropdownMenu.Trigger
        aria-label={email}
        className="flex items-center gap-2 rounded-surface border border-line bg-surface p-1.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-50 text-xs font-semibold text-accent-700">
          {initialsOf(email)}
        </span>
      </DropdownMenu.Trigger>

      <DropdownMenu.Content>
        <DropdownMenu.Label>{t('language.label')}</DropdownMenu.Label>
        <DropdownMenu.RadioGroup
          value={i18n.language}
          onValueChange={(value) => void setLocale(value as SupportedLocale)}
        >
          {SUPPORTED_LOCALES.map((locale) => (
            <DropdownMenu.RadioItem key={locale} value={locale}>
              {t(`language.${locale}`)}
            </DropdownMenu.RadioItem>
          ))}
        </DropdownMenu.RadioGroup>

        <DropdownMenu.Separator />

        {vaultState.status === 'unlocked' && (
          <DropdownMenu.Item onSelect={() => lockVault()}>
            <Lock aria-hidden="true" className="h-4 w-4 text-muted" />
            {t('actions.lockVault')}
          </DropdownMenu.Item>
        )}

        <DropdownMenu.Item
          className="text-danger-700"
          disabled={signOutMutation.isPending}
          onSelect={() => signOutMutation.mutate()}
        >
          <LogOut aria-hidden="true" className="h-4 w-4" />
          {t('actions.signOut')}
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu>
  )
}
