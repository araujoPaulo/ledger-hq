import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../i18n'
import { ApiError } from '../api/client'

const listEmployments = vi.hoisted(() => vi.fn())
const createEmployment = vi.hoisted(() => vi.fn())
const endEmployment = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({ listEmployments, createEmployment, endEmployment }))

const listClients = vi.hoisted(() => vi.fn())
vi.mock('../clients/api', () => ({ listClients }))

const { EmploymentSection } = await import('./EmploymentSection')

await initI18n()

afterEach(() => {
  vi.clearAllMocks()
})

const spell = {
  id: 'e1',
  employerId: 'c1',
  employerName: 'Padaria Central, Lda.',
  employeeId: 'p1',
  employeeName: 'Maria Santos',
  startedOn: '2024-01-15',
  endedOn: null,
  jobTitle: 'Bookkeeper',
  notes: null,
}

// The brief's own render helper mounts `<EmploymentSection>` bare, but the
// section renders `<Link>` from '@tanstack/react-router' for each
// counterparty (so a company's employee row can be followed to that
// person's own client record, and vice versa), which throws
// (`Cannot read properties of null (reading 'isServer')`) without a
// `<RouterProvider>` ancestor — proven empirically before writing this.
// Same fix as ClientListPage.test.tsx/ClientFormPage.test.tsx: wrap in a
// minimal router whose root route renders the component under test. No
// child route for `/clients/$clientId` needs to be registered for `<Link>`
// to render or for a click to navigate without throwing — confirmed
// empirically, matching ClientListPage.test.tsx's own comment on this.
function renderSection(kind: 'COMPANY' | 'INDIVIDUAL', id: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const rootRoute = createRootRoute({
    component: () => <EmploymentSection client={{ id, kind, name: 'X' }} />,
  })
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>
        <RouterProvider router={router} />
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

describe('EmploymentSection', () => {
  it('shows the counterparty name from a company page', async () => {
    listEmployments.mockResolvedValue([spell])
    listClients.mockResolvedValue([])
    renderSection('COMPANY', 'c1')

    expect(await screen.findByText('Maria Santos')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /empregados|employees/i })).toBeInTheDocument()
  })

  it('shows the counterparty name from a person page', async () => {
    listEmployments.mockResolvedValue([spell])
    listClients.mockResolvedValue([])
    renderSection('INDIVIDUAL', 'p1')

    expect(await screen.findByText('Padaria Central, Lda.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /vínculos|employments/i })).toBeInTheDocument()
  })

  it('marks an open spell as current', async () => {
    listEmployments.mockResolvedValue([spell])
    listClients.mockResolvedValue([])
    renderSection('COMPANY', 'c1')

    expect(await screen.findByText(/em vigor|current/i)).toBeInTheDocument()
  })

  it('renders dates in day-first format', async () => {
    listEmployments.mockResolvedValue([{ ...spell, endedOn: '2025-06-30' }])
    listClients.mockResolvedValue([])
    renderSection('COMPANY', 'c1')

    expect(await screen.findByText(/15\/01\/2024/)).toBeInTheDocument()
    expect(screen.getByText(/30\/06\/2025/)).toBeInTheDocument()
  })

  it('shows an empty state', async () => {
    listEmployments.mockResolvedValue([])
    listClients.mockResolvedValue([])
    renderSection('COMPANY', 'c1')

    expect(await screen.findByText(/sem vínculos|no employment/i)).toBeInTheDocument()
  })

  it('ends an open spell and reflects it in the list without a manual refresh', async () => {
    listClients.mockResolvedValue([])
    listEmployments
      .mockResolvedValueOnce([spell])
      .mockResolvedValueOnce([{ ...spell, endedOn: '2025-06-30' }])
    endEmployment.mockResolvedValue({ ...spell, endedOn: '2025-06-30' })
    renderSection('COMPANY', 'c1')

    const endButton = await screen.findByRole('button', { name: /cessar vínculo|end employment/i })
    await userEvent.click(endButton)

    expect(endEmployment).toHaveBeenCalledWith('e1', expect.any(String))
    // The list re-fetches (query invalidation, not a page reload) and the
    // spell that was just ended no longer offers the action nor the
    // "current" badge — an already-ended spell cannot be ended again.
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /cessar vínculo|end employment/i })).not.toBeInTheDocument()
    })
    expect(screen.queryByText(/em vigor|current/i)).not.toBeInTheDocument()
  })

  it('renders employment.overlapping_spell through ErrorMessage when ending a spell fails', async () => {
    listClients.mockResolvedValue([])
    listEmployments.mockResolvedValue([spell])
    endEmployment.mockRejectedValue(new ApiError('employment.overlapping_spell', {}, 409))
    renderSection('COMPANY', 'c1')

    const endButton = await screen.findByRole('button', { name: /cessar vínculo|end employment/i })
    await userEvent.click(endButton)

    const alert = await screen.findByText(/vínculo sobreposto|overlapping spell/i)
    expect(alert).toHaveAttribute('role', 'alert')
  })

  it('shows an error, not a silently empty picker, when eligible counterparties fail to load', async () => {
    listEmployments.mockResolvedValue([])
    listClients.mockRejectedValue(new ApiError('common.internal_error', {}, 500))
    renderSection('COMPANY', 'c1')

    const alert = await screen.findByText(/erro no servidor|server error/i)
    expect(alert).toHaveAttribute('role', 'alert')
  })
})
