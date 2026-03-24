import type { ExampleTestableApp } from './cli/entry-loader.js'
import type { ToolDefinition, ToolExample } from './types.js'
import { isPlainRecord } from './object-schema.js'

/** Result of running one example against one tool. */
export interface TestResult {
  toolName: string
  exampleName: string
  passed: boolean
  error?: string
  actual?: unknown
  expected?: unknown
  durationMs: number
}

/** Aggregate summary returned after running example smoke tests. */
export interface TestSummary {
  total: number
  passed: number
  failed: number
  skipped: number
  results: TestResult[]
}

/** Run a single example against a tool and return the result */
async function runSingleExample(
  app: ExampleTestableApp,
  tool: ToolDefinition,
  example: ToolExample,
): Promise<TestResult> {
  const exampleName = example.name ?? 'unnamed'
  const start = performance.now()

  try {
    const result = await app.dispatch(tool.name, example.args)
    const durationMs = performance.now() - start

    if (!result.ok) {
      return buildFailedTestResult(tool.name, exampleName, durationMs, {
        error: `Dispatch returned status ${result.error.statusCode}: ${JSON.stringify(result.error)}`,
        actual: result.error,
        expected: example.result,
      })
    }

    const mismatch = getExampleMismatch(example, result.value)
    if (mismatch) {
      return buildFailedTestResult(tool.name, exampleName, durationMs, {
        error: `Result mismatch: ${mismatch}`,
        actual: result.value,
        expected: example.result,
      })
    }

    return { toolName: tool.name, exampleName, passed: true, durationMs }
  } catch (err) {
    const durationMs = performance.now() - start
    return buildFailedTestResult(tool.name, exampleName, durationMs, {
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

/** Run tool examples as smoke tests */
export async function runExampleTests(app: ExampleTestableApp, filterTool?: string): Promise<TestSummary> {
  const { mcp } = app.build()
  const manifest = mcp.getManifest()

  const results: TestResult[] = []
  let skipped = 0

  const tools = filterTool
    ? manifest.tools.filter(t => t.name === filterTool)
    : manifest.tools

  if (filterTool && tools.length === 0) {
    throw new Error(`Tool "${filterTool}" not found in manifest`)
  }

  for (const tool of tools) {
    if (!tool.examples || tool.examples.length === 0) {
      skipped++
      continue
    }

    for (const example of tool.examples) {
      results.push(await runSingleExample(app, tool, example))
    }
  }

  return {
    total: results.length,
    passed: results.filter(r => r.passed).length,
    failed: results.filter(r => !r.passed).length,
    skipped,
    results,
  }
}

/** Format test summary for console output */
export function formatTestSummary(summary: TestSummary): string {
  const lines: string[] = ['']

  for (const result of summary.results) {
    const status = result.passed ? 'PASS' : 'FAIL'
    const time = `${result.durationMs.toFixed(0)}ms`
    lines.push(`  ${status}  ${result.toolName} / ${result.exampleName} (${time})`)
    appendFailureDetails(lines, result)
  }

  lines.push('')
  const parts: string[] = []
  if (summary.passed > 0) parts.push(`${summary.passed} passed`)
  if (summary.failed > 0) parts.push(`${summary.failed} failed`)
  if (summary.skipped > 0) parts.push(`${summary.skipped} skipped`)
  lines.push(`  ${parts.join(', ')} (${summary.total} total)`)
  lines.push('')

  return lines.join('\n')
}

function getExampleMismatch(example: ToolExample, actualResult: unknown): string | undefined {
  if (example.result === undefined) return undefined
  const match = deepPartialMatch(example.result, actualResult)
  return match.ok ? undefined : match.reason
}

function buildFailedTestResult(
  toolName: string,
  exampleName: string,
  durationMs: number,
  details: {
    error: string
    actual?: unknown
    expected?: unknown
  },
): TestResult {
  return {
    toolName,
    exampleName,
    passed: false,
    error: details.error,
    actual: details.actual,
    expected: details.expected,
    durationMs,
  }
}

function appendFailureDetails(lines: string[], result: TestResult): void {
  if (result.passed || !result.error) return
  lines.push(`         ${result.error}`)
  if (result.expected === undefined) return
  lines.push(`         expected: ${JSON.stringify(result.expected)}`)
  lines.push(`         actual:   ${JSON.stringify(result.actual)}`)
}

// =========================================================================
// Deep partial match
// =========================================================================

interface MatchResult {
  ok: boolean
  reason?: string
}

/** Match expected array partially against actual — every element must have a match */
function matchArrayPartial(expected: unknown[], actual: unknown, path: string): MatchResult {
  if (!Array.isArray(actual)) {
    return { ok: false, reason: `${path || 'root'}: expected array, got ${typeof actual}` }
  }

  const remaining = [...actual]
  for (let i = 0; i < expected.length; i++) {
    const matchIndex = remaining.findIndex((item) => deepPartialMatch(expected[i], item).ok)
    if (matchIndex === -1) {
      return { ok: false, reason: `${path}[${i}]: no matching element found in actual array` }
    }
    remaining.splice(matchIndex, 1)
  }
  return { ok: true }
}

/** Match expected object partially against actual — every key must exist and match */
function matchObjectPartial(expected: Record<string, unknown>, actual: unknown, path: string): MatchResult {
  if (!isPlainRecord(actual)) {
    return { ok: false, reason: `${path || 'root'}: expected object, got ${Array.isArray(actual) ? 'array' : typeof actual}` }
  }

  for (const key of Object.keys(expected)) {
    if (!(key in actual)) {
      return { ok: false, reason: `${path ? path + '.' : ''}${key}: missing in actual` }
    }
    const result = deepPartialMatch(expected[key], actual[key], `${path ? path + '.' : ''}${key}`)
    if (!result.ok) return result
  }

  return { ok: true }
}

/**
 * Deep partial match — expected is a subset of actual.
 * - Object: every key in expected must exist in actual with matching value
 * - Array: every element in expected must have a match somewhere in actual
 * - Primitives: strict equality
 */
export function deepPartialMatch(expected: unknown, actual: unknown, path = ''): MatchResult {
  const nullishMatch = matchNullish(expected, actual, path)
  if (nullishMatch) {
    return nullishMatch
  }

  const primitiveMatch = matchPrimitive(expected, actual, path)
  if (primitiveMatch) {
    return primitiveMatch
  }

  if (Array.isArray(expected)) {
    return matchArrayPartial(expected, actual, path)
  }

  if (!isPlainRecord(expected)) {
    return { ok: false, reason: `${path || 'root'}: expected object, got ${typeof expected}` }
  }
  return matchObjectPartial(expected, actual, path)
}

function matchNullish(expected: unknown, actual: unknown, path: string): MatchResult | undefined {
  if (expected !== null && expected !== undefined) return undefined
  if (actual === expected) return { ok: true }
  return { ok: false, reason: `${path || 'root'}: expected ${expected}, got ${JSON.stringify(actual)}` }
}

function matchPrimitive(expected: unknown, actual: unknown, path: string): MatchResult | undefined {
  if (typeof expected === 'object') return undefined
  if (expected === actual) return { ok: true }
  return { ok: false, reason: `${path || 'root'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}` }
}
