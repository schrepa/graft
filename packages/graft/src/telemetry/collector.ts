import { subscribe, unsubscribe } from 'node:diagnostics_channel'
import { TOOL_CALL_CHANNEL, type ToolCallRecord } from '../telemetry.js'
import { isPlainRecord } from '../object-schema.js'

/**
 * Collector tuning options for diagnostics-channel telemetry.
 */
export interface CollectorOptions {
  /** Max records in ring buffer (default: 1000) */
  maxRecords?: number
  /** Max latency samples per tool (default: 200) */
  maxLatencies?: number
}

/**
 * Aggregated per-tool health metrics computed from recent telemetry.
 */
export interface ToolHealthSummary {
  calls: number
  errors: number
  errorRate: number
  p50: number
  p95: number
  p99: number
}

interface ToolAggregate {
  calls: number
  errors: number
  latencies: number[]
}

interface GetRecordsOptions {
  tool?: string
  status?: 'ok' | 'error'
  limit?: number
}

/** Diagnostics-channel collector for recent tool and resource call telemetry. */
export class Collector {
  private maxRecords: number
  private maxLatencies: number
  private records: ToolCallRecord[] = []
  private aggregates = new Map<string, ToolAggregate>()
  private active = false
  private handler: (message: unknown, name: string | symbol) => void

  constructor(options?: CollectorOptions) {
    this.maxRecords = options?.maxRecords ?? 1000
    this.maxLatencies = options?.maxLatencies ?? 200

    // Bind handler once so subscribe/unsubscribe use the same reference
    this.handler = (message: unknown) => {
      if (isToolCallRecord(message)) {
        this.push(message)
      }
    }
  }

  /** Start collecting events. Idempotent. */
  start(): void {
    if (this.active) return
    this.active = true
    subscribe(TOOL_CALL_CHANNEL, this.handler)
  }

  /** Stop collecting events. Idempotent. */
  stop(): void {
    if (!this.active) return
    this.active = false
    unsubscribe(TOOL_CALL_CHANNEL, this.handler)
  }

  /** Get filtered records from the ring buffer */
  getRecords(options: GetRecordsOptions = {}): ToolCallRecord[] {
    let result = this.records

    if (options.tool !== undefined) {
      const tool = options.tool
      result = result.filter(r => r.tool === tool)
    }
    if (options.status !== undefined) {
      const status = options.status
      result = result.filter(r => r.status === status)
    }
    if (options.limit !== undefined) {
      result = options.limit <= 0 ? [] : result.slice(-options.limit)
    }

    return result.map(cloneToolCallRecord)
  }

  /** Get health summary for one or all tools */
  getToolHealth(toolName?: string): Record<string, ToolHealthSummary> {
    const result: Record<string, ToolHealthSummary> = {}

    if (toolName) {
      const agg = this.aggregates.get(toolName)
      if (agg) {
        result[toolName] = this.computeHealth(agg)
      }
      return result
    }

    for (const [name, agg] of this.aggregates) {
      result[name] = this.computeHealth(agg)
    }
    return result
  }

  /** Reset all data */
  clear(): void {
    this.records = []
    this.aggregates.clear()
  }

  private push(record: ToolCallRecord): void {
    // Ring buffer — evict oldest when full
    if (this.records.length >= this.maxRecords) {
      this.records.shift()
    }
    this.records.push(record)

    // Per-tool aggregates
    let agg = this.aggregates.get(record.tool)
    if (!agg) {
      agg = { calls: 0, errors: 0, latencies: [] }
      this.aggregates.set(record.tool, agg)
    }
    agg.calls++
    if (record.status === 'error') agg.errors++

    // Latency ring
    if (agg.latencies.length >= this.maxLatencies) {
      agg.latencies.shift()
    }
    agg.latencies.push(record.durationMs)
  }

  private computeHealth(agg: ToolAggregate): ToolHealthSummary {
    return {
      calls: agg.calls,
      errors: agg.errors,
      errorRate: agg.calls === 0 ? 0 : agg.errors / agg.calls,
      p50: this.percentile(agg.latencies, 0.5),
      p95: this.percentile(agg.latencies, 0.95),
      p99: this.percentile(agg.latencies, 0.99),
    }
  }

  /** Nearest-rank percentile. rank = ceil(p * n) (1-indexed). Returns 0 for empty arrays. */
  private percentile(values: number[], p: number): number {
    if (values.length === 0) return 0
    const sorted = [...values].sort((a, b) => a - b)
    const rank = Math.ceil(p * sorted.length)
    return sorted[rank - 1]
  }
}

function isToolCallRecord(value: unknown): value is ToolCallRecord {
  if (!isPlainRecord(value)) return false
  return hasBaseToolCallShape(value) && hasOptionalErrorShape(value.error)
}

function hasBaseToolCallShape(value: Record<string, unknown>): boolean {
  return isToolCallKind(value.kind)
    && typeof value.tool === 'string'
    && typeof value.callId === 'string'
    && isToolCallTransport(value.transport)
    && typeof value.timestamp === 'number'
    && typeof value.durationMs === 'number'
    && (value.subject === undefined || typeof value.subject === 'string')
    && isToolCallStatus(value.status)
}

function hasOptionalErrorShape(value: unknown): boolean {
  if (value === undefined) return true
  if (!isPlainRecord(value)) return false
  return typeof value.type === 'string'
    && typeof value.message === 'string'
    && typeof value.statusCode === 'number'
}

function isToolCallKind(value: unknown): value is ToolCallRecord['kind'] {
  return value === 'tool' || value === 'resource'
}

function isToolCallTransport(value: unknown): value is ToolCallRecord['transport'] {
  return value === 'http' || value === 'mcp' || value === 'stdio'
}

function isToolCallStatus(value: unknown): value is ToolCallRecord['status'] {
  return value === 'ok' || value === 'error'
}

function cloneToolCallRecord(record: ToolCallRecord): ToolCallRecord {
  return record.error === undefined
    ? { ...record }
    : { ...record, error: { ...record.error } }
}
