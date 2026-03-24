import { GraftError } from '../../errors.js'
import type { AuthResult } from '../../types.js'
import type { EntryShape } from './shared.js'

/**
 * Create a synthetic not-found entry so missing tools/resources flow through the
 * same execution path as real dispatchables.
 */
export function createNotFoundEntry<TAuth extends AuthResult>(
  kind: 'tool' | 'resource',
  name: string,
): EntryShape<TAuth> {
  return {
    name,
    handler: () => {
      throw new GraftError(`Unknown ${kind}: ${name}`, 404, 'NOT_FOUND')
    },
  }
}
