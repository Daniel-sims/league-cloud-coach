import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { CompanionConnection } from './CompanionConnection'
const rpc = vi.hoisted(() => vi.fn())
vi.mock('../lib/supabase', () => ({ rpc }))
it('requires explicit approval and offers scoped device revocation', async () => {
  const hash = 'a'.repeat(64)
  rpc.mockImplementation(async (name: string) => (name === 'list_companions' ? [] : null))
  render(<CompanionConnection hash={hash} />)
  expect(rpc).not.toHaveBeenCalledWith('connect_companion', expect.anything())
  expect(screen.getByText('AAAAAAAA')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Connect League Helper' }))
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('connect_companion', { p_hash: hash }))
  expect(await screen.findByRole('status')).toHaveTextContent('Return to League Helper')
})
