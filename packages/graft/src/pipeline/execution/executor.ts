import type { AuthResult, DispatchEvent, ToolContext } from '../../types.js'
import type { CreatePipelineOptions, DispatchOptions } from '../types.js'
import { checkAuthorization, resolveAuth } from './auth.js'
import { buildExecutionContext } from './context.js'
import {
  attachDispatchEvents,
  buildSuccessOutcome,
  classifyError,
  mergeResponseContext,
} from './outcome.js'
import {
  createExecutionDeps,
  normalizeOptions,
  type DispatchExecutor,
  type EntryShape,
  type ExecutionDeps,
  type ExecutionResult,
} from './shared.js'
import { toolCallChannel } from '../../telemetry.js'
import type { ToolCallRecord } from '../../telemetry.js'

/** Maximum number of events buffered per dispatch. */
const MAX_DISPATCH_EVENTS = 1000

function createEventSink(
  events: DispatchEvent[],
  eventsDroppedRef: { count: number },
): (event: DispatchEvent) => void {
  return (event) => {
    if (events.length < MAX_DISPATCH_EVENTS) {
      events.push(event)
    } else {
      eventsDroppedRef.count++
    }
  }
}

async function runLifecycleHooks<THook>(
  pipelineLogger: NonNullable<CreatePipelineOptions['logger']>,
  hooks: readonly THook[],
  invoke: (hook: THook) => void | Promise<void>,
  label: 'onError' | 'onSuccess',
): Promise<void> {
  for (const hook of hooks) {
    try {
      await invoke(hook)
    } catch (error) {
      pipelineLogger.error(`[graft] ${label} hook failed:`, error)
    }
  }
}

async function fireLifecycleHooks<TAuth extends AuthResult>(
  deps: ExecutionDeps<TAuth>,
  caughtError: unknown,
  dispatchOutcome: ReturnType<typeof attachDispatchEvents>,
  info: {
    requestId: string
    toolName: string
    transport: 'http' | 'mcp' | 'stdio'
    headers: Record<string, string>
    auth?: TAuth
    tool?: EntryShape<TAuth>['meta']
    toolContext?: ToolContext<TAuth>
  },
): Promise<void> {
  if (caughtError && deps.onError?.length) {
    await runLifecycleHooks(deps.pipelineLogger, deps.onError, (hook) => hook(caughtError, info), 'onError')
  }
  if (!caughtError && dispatchOutcome.ok && deps.onSuccess?.length) {
    await runLifecycleHooks(deps.pipelineLogger, deps.onSuccess, (hook) => hook(dispatchOutcome, info), 'onSuccess')
  }
}

function publishTelemetry<TAuth extends AuthResult>(
  kind: 'tool' | 'resource',
  name: string,
  callId: string,
  transport: 'http' | 'mcp' | 'stdio',
  callStart: number,
  callStartHr: number,
  authResult: TAuth | undefined,
  status: 'ok' | 'error',
  error?: ToolCallRecord['error'],
): void {
  if (!toolCallChannel.hasSubscribers) return

  toolCallChannel.publish({
    kind,
    tool: name,
    callId,
    transport,
    timestamp: callStart,
    durationMs: performance.now() - callStartHr,
    subject: authResult?.subject,
    status,
    error,
  } satisfies ToolCallRecord)
}

async function executeEntry<TAuth extends AuthResult>(
  deps: ExecutionDeps<TAuth>,
  entry: EntryShape<TAuth>,
  entryName: string,
  rawArgs: Record<string, unknown>,
  normalized: ReturnType<typeof normalizeOptions<TAuth>>,
  events: DispatchEvent[],
  eventsDroppedRef: { count: number },
): Promise<ExecutionResult<TAuth>> {
  let authResult: TAuth | undefined
  let ctx: ToolContext<TAuth> | undefined

  try {
    authResult = await resolveAuth(deps, entry, normalized)
    await checkAuthorization(deps.authorize, entry, authResult, rawArgs)

    const pushEvent = createEventSink(events, eventsDroppedRef)
    const built = buildExecutionContext(
      entry,
      entryName,
      rawArgs,
      normalized,
      authResult,
      pushEvent,
      deps.logger,
    )
    ctx = built.ctx
    const run = () => Promise.resolve(entry.handler(built.parsed, built.ctx))
    const middleware = entry.middleware ?? deps.composedMiddleware
    const result = middleware ? await middleware(built.ctx, run) : await run()

    return {
      dispatchOutcome: buildSuccessOutcome(normalized.requestId, result),
      telemetryStatus: 'ok',
      authResult,
      ctx,
    }
  } catch (error) {
    const classified = classifyError(normalized.requestId, error)
    return {
      dispatchOutcome: classified.dispatchOutcome,
      telemetryStatus: classified.telemetryStatus,
      telemetryError: classified.telemetryError,
      authResult,
      ctx,
      caughtError: error,
    }
  }
}

/**
 * Create the low-level dispatch executor used by the pipeline facade.
 *
 * @param options Middleware, auth, logging, and lifecycle-hook dependencies.
 * @returns A function that executes one tool or resource dispatch.
 * @throws {import('../../errors.js').GraftError} When auth, validation, or handler execution fails.
 */
export function createDispatchExecutor<TAuth extends AuthResult = AuthResult>(
  options: CreatePipelineOptions<TAuth>,
): DispatchExecutor<TAuth> {
  const deps = createExecutionDeps(options)

  return async function execute(
    entry: EntryShape<TAuth>,
    kind: 'tool' | 'resource',
    entryName: string,
    rawArgs: Record<string, unknown>,
    opts?: DispatchOptions<TAuth>,
  ) {
    const callStart = Date.now()
    const callStartHr = performance.now()
    const normalized = normalizeOptions(opts)

    const events: DispatchEvent[] = []
    const eventsDroppedRef = { count: 0 }
    const executed = await executeEntry(
      deps,
      entry,
      entryName,
      rawArgs,
      normalized,
      events,
      eventsDroppedRef,
    )
    let dispatchOutcome = executed.dispatchOutcome

    dispatchOutcome = mergeResponseContext(executed.ctx, dispatchOutcome)
    dispatchOutcome = attachDispatchEvents(dispatchOutcome, events, eventsDroppedRef.count)

    await fireLifecycleHooks(deps, executed.caughtError, dispatchOutcome, {
      requestId: normalized.requestId,
      toolName: entryName,
      transport: normalized.transport,
      headers: normalized.headers,
      auth: executed.authResult,
      tool: entry.meta,
      toolContext: executed.ctx,
    })

    publishTelemetry(
      kind,
      entryName,
      normalized.requestId,
      normalized.transport,
      callStart,
      callStartHr,
      executed.authResult,
      executed.telemetryStatus,
      executed.telemetryError,
    )

    return dispatchOutcome
  }
}
