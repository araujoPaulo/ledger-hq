import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { describe, expect, it } from 'vitest'
import { initI18n } from '../i18n'
import { SearchBox } from './SearchBox'

await initI18n()
await i18next.changeLanguage('pt-PT')

function renderBox() {
  const rootRoute = createRootRoute()
  const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: SearchBox })
  const searchRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/search',
    validateSearch: (search: Record<string, unknown>) => ({ q: typeof search.q === 'string' ? search.q : '' }),
    component: SearchBox,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, searchRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  const result = render(
    <I18nextProvider i18n={i18next}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  )

  return { ...result, router }
}

describe('SearchBox', () => {
  it('navigates to the results route with what was typed', async () => {
    const { router } = renderBox()

    // TanStack Router's RouterProvider resolves its first match in a
    // post-mount effect, one tick after `render()` returns (true for every
    // route here, not just this one — see the other shell suites), so the
    // very first query has to wait rather than assert synchronously.
    const box = await screen.findByRole('searchbox')
    await userEvent.type(box, 'mari')

    // 200 ms debounce, so this is the first navigation, not the fourth.
    await waitFor(() => expect(router.state.location.pathname).toBe('/search'))
    await waitFor(() => expect(router.state.location.searchStr).toContain('q=mari'))
  })

  it('focuses the box when "/" is pressed outside a text field', async () => {
    renderBox()
    const box = await screen.findByRole('searchbox')
    expect(box).not.toHaveFocus()

    await userEvent.keyboard('/')

    expect(box).toHaveFocus()
  })

  it('does not steal "/" while a text field has focus', async () => {
    renderBox()
    const box = await screen.findByRole('searchbox')
    const outside = document.createElement('input')
    document.body.appendChild(outside)
    outside.focus()

    await userEvent.keyboard('/')

    expect(box).not.toHaveFocus()
    expect(outside.value).toBe('/')
    outside.remove()
  })

  it('clears and blurs on Escape', async () => {
    renderBox()
    const box = await screen.findByRole('searchbox')

    await userEvent.type(box, 'mari')
    await userEvent.keyboard('{Escape}')

    expect(box).toHaveValue('')
    expect(box).not.toHaveFocus()
  })
})
