import { createToolContext } from '../../context.js'
import { GraftError } from '../../errors.js'
import { isPlainRecord } from '../../object-schema.js'
import type { AuthResult, DispatchEvent, ToolContext } from '../../types.js'
import type { CreatePipelineOptions } from '../types.js'
import type { EntryShape, NormalizedOptions } from './shared.js'

/** Build the parsed args and `ToolContext` used during execution. */
export function buildExecutionContext<TAuth extends AuthResult>(
  entry: EntryShape<TAuth>,
  entryName: string,
  rawArgs: Record<string, unknown>,
  normalized: NormalizedOptions<TAuth>,
  authResult: TAuth | undefined,
  pushEvent: (event: DispatchEvent) => void,
  logger: CreatePipelineOptions<TAuth>['logger'],
): { parsed: Record<string, unknown>; ctx: ToolContext<TAuth> } {
  const parsed = entry.validate ? entry.validate(rawArgs) : rawArgs
  if (!isPlainRecord(parsed)) {
    throw new GraftError('Tool params must resolve to an object', 500)
  }

  const ctx = createToolContext<TAuth>({
    meta: {
      requestId: normalized.requestId,
      transport: normalized.transport,
      toolName: entryName,
      auth: authResult,
      headers: normalized.headers,
      tool: entry.meta,
    },
    params: parsed,
    logger,
    signal: normalized.signal,
    onLog: (level, message, data) => {
      pushEvent({ type: 'log', level, message, data })
      normalized.contextIngredients?.onLog?.(level, message, data)
    },
    onProgress: (progress, total) => {
      pushEvent({ type: 'progress', progress, total })
      normalized.contextIngredients?.onProgress?.(progress, total)
    },
  })

  if (ctx.signal?.aborted) {
    throw new GraftError('Request cancelled', 499, 'REQUEST_CANCELLED')
  }

  return { parsed, ctx }
}
