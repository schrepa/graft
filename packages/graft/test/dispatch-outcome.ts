import { expect } from 'vitest'
import type { DispatchFailure, DispatchOutcome, DispatchSuccess } from '../src/types.js'

export function expectSuccess(outcome: DispatchOutcome): DispatchSuccess {
  expect(outcome.ok).toBe(true)
  if (!outcome.ok) {
    throw new Error(`Expected success outcome, got ${outcome.error.statusCode}: ${outcome.error.message}`)
  }
  return outcome
}

export function expectFailure(outcome: DispatchOutcome): DispatchFailure {
  expect(outcome.ok).toBe(false)
  if (outcome.ok) {
    throw new Error('Expected failure outcome, got success')
  }
  return outcome
}

export function statusOf(outcome: DispatchOutcome): number {
  return outcome.ok
    ? outcome.response?.statusCode ?? 200
    : outcome.error.statusCode
}

export function bodyOf(outcome: DispatchOutcome): unknown {
  if (outcome.ok) {
    return outcome.value
  }

  return {
    error: outcome.error.message,
    ...(outcome.error.details ? { details: outcome.error.details } : {}),
  }
}

export function codeOf(outcome: DispatchOutcome): string | undefined {
  return outcome.ok ? undefined : outcome.error.code
}

export function headersOf(outcome: DispatchOutcome): Record<string, string> | undefined {
  return outcome.ok ? outcome.response?.headers : outcome.error.headers
}

export function contentTypeOf(outcome: DispatchOutcome): string | undefined {
  return outcome.ok ? outcome.response?.contentType : undefined
}
