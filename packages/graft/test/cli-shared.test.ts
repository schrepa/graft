import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildProxyApp } from '../src/cli-shared.js'

describe('buildProxyApp', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('passes openapiTimeoutMs through remote OpenAPI loading', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal
        if (!signal) {
          reject(new Error('Missing signal'))
          return
        }

        if (signal.aborted) {
          reject(signal.reason)
          return
        }

        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const buildPromise = buildProxyApp({
      openapi: 'https://example.com/openapi.json',
      target: 'https://api.example.com',
      openapiTimeoutMs: 5,
    })

    await vi.advanceTimersByTimeAsync(5)

    await expect(buildPromise).rejects.toThrow(/Failed to fetch OpenAPI spec/)
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
