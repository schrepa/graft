import { afterEach, describe, expect, it, vi } from 'vitest'
import { main, runCli } from '../src/cli-main.js'

describe('cli bootstrap', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('maps unexpected bootstrap failures to exit code 1', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(main(['serve'], async () => {
      throw new Error('boom')
    })).resolves.toBe(1)

    expect(consoleError).toHaveBeenCalledWith('boom')
  })

  it('does not expose an init command', async () => {
    await expect(runCli(['init'])).resolves.toBe(1)
  })
})
