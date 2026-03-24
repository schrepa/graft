import { vi } from 'vitest'

export function createDeferred<T = void>(): {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
} {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

export function parseJsonText<T>(text: string | undefined): T {
  if (text === undefined) {
    throw new Error('Expected a text payload')
  }
  return JSON.parse(text) as T
}

export function silentLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}
