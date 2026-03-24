import { channel } from 'node:diagnostics_channel'

/** Diagnostics-channel topic used for tool and resource call telemetry. */
export const TOOL_CALL_CHANNEL = 'graft:tool:call'

/** One emitted telemetry record for a completed tool or resource dispatch. */
export interface ToolCallRecord {
  kind: 'tool' | 'resource'
  tool: string
  callId: string
  transport: 'http' | 'mcp' | 'stdio'
  timestamp: number       // Date.now() at call start
  durationMs: number      // performance.now() delta
  subject?: string        // authenticated user/service identifier (from AuthResult)
  status: 'ok' | 'error'
  error?: {
    type: string          // error class name (e.g. 'ValidationError')
    message: string       // full error message
    statusCode: number    // pipeline failure or response status code
  }
}

/** Diagnostics channel publishing `ToolCallRecord` events for observers. */
export const toolCallChannel = channel(TOOL_CALL_CHANNEL)
