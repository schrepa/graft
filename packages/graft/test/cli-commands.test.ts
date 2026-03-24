import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createApp } from '../src/app.js'
import { z } from 'zod'
import { runExampleTests, formatTestSummary, deepPartialMatch } from '../src/test-runner.js'
import { resolveToolOutputDir } from '../src/cli/commands/add-tool.js'

// =========================================================================
// add-tool tests (test the generated content logic)
// =========================================================================

describe('add-tool', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'graft-addtool-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('generates correct file content with camelCase name', () => {
    const name = 'search_users'
    const camelName = name.replace(/_([a-z])/g, (_, c) => c.toUpperCase()) + 'Tool'
    const fileName = name.replace(/_/g, '-') + '.ts'

    expect(camelName).toBe('searchUsersTool')
    expect(fileName).toBe('search-users.ts')
  })

  it('puts file in src/tools/ when it exists', () => {
    const toolsDir = join(tmpDir, 'src', 'tools')
    mkdirSync(toolsDir, { recursive: true })

    const outputDir = resolveToolOutputDir(tmpDir)
    expect(outputDir).toBe(toolsDir)
  })

  it('falls back to src/ when tools/ does not exist', () => {
    const srcDir = join(tmpDir, 'src')
    mkdirSync(srcDir, { recursive: true })

    const outputDir = resolveToolOutputDir(tmpDir)
    expect(outputDir).toBe(srcDir)
  })
})

// =========================================================================
// Test runner tests
// =========================================================================

describe('test-runner', () => {
  it('passes when examples match actual results', async () => {
    const app = createApp({ name: 'test' })
    app.tool('echo', {
      description: 'Echo back',
      params: z.object({ msg: z.string() }),
      examples: [{ name: 'hello', args: { msg: 'hi' }, result: { msg: 'hi' } }],
      handler: ({ msg }) => ({ msg }),
    })

    const summary = await runExampleTests(app)
    expect(summary.passed).toBe(1)
    expect(summary.failed).toBe(0)
  })

  it('fails when result does not match expected', async () => {
    const app = createApp({ name: 'test' })
    app.tool('echo', {
      description: 'Echo back',
      params: z.object({ msg: z.string() }),
      examples: [{ name: 'mismatch', args: { msg: 'hi' }, result: { msg: 'bye' } }],
      handler: ({ msg }) => ({ msg }),
    })

    const summary = await runExampleTests(app)
    expect(summary.passed).toBe(0)
    expect(summary.failed).toBe(1)
    expect(summary.results[0].error).toContain('mismatch')
  })

  it('partial matching: subset of object matches', async () => {
    const app = createApp({ name: 'test' })
    app.tool('info', {
      description: 'Get info',
      params: z.object({}),
      examples: [{ name: 'partial', args: {}, result: { name: 'test' } }],
      handler: () => ({ name: 'test', extra: 'field', count: 42 }),
    })

    const summary = await runExampleTests(app)
    expect(summary.passed).toBe(1)
    expect(summary.failed).toBe(0)
  })

  it('partial matching: array element matching', async () => {
    const app = createApp({ name: 'test' })
    app.tool('list', {
      description: 'List items',
      params: z.object({}),
      examples: [{ name: 'find-one', args: {}, result: [{ id: 2 }] }],
      handler: () => [{ id: 1, name: 'a' }, { id: 2, name: 'b' }, { id: 3, name: 'c' }],
    })

    const summary = await runExampleTests(app)
    expect(summary.passed).toBe(1)
  })

  it('tools without examples are skipped', async () => {
    const app = createApp({ name: 'test' })
    app.tool('no_examples', {
      description: 'No examples',
      handler: () => ({}),
    })

    const summary = await runExampleTests(app)
    expect(summary.total).toBe(0)
    expect(summary.skipped).toBe(1)
  })

  it('--tool flag filters to specific tool', async () => {
    const app = createApp({ name: 'test' })
    app.tool('tool_a', {
      description: 'A',
      params: z.object({}),
      examples: [{ name: 'a', args: {} }],
      handler: () => ({}),
    })
    app.tool('tool_b', {
      description: 'B',
      params: z.object({}),
      examples: [{ name: 'b', args: {} }],
      handler: () => ({}),
    })

    const summary = await runExampleTests(app, 'tool_a')
    expect(summary.total).toBe(1)
    expect(summary.results[0].toolName).toBe('tool_a')
  })

  it('reports timing', async () => {
    const app = createApp({ name: 'test' })
    app.tool('slow', {
      description: 'Slow tool',
      params: z.object({}),
      examples: [{ name: 'test', args: {} }],
      handler: () => ({}),
    })

    const summary = await runExampleTests(app)
    expect(summary.results[0].durationMs).toBeGreaterThanOrEqual(0)
  })

  it('formatTestSummary produces readable output', async () => {
    const app = createApp({ name: 'test' })
    app.tool('echo', {
      description: 'Echo',
      params: z.object({ msg: z.string() }),
      examples: [
        { name: 'pass', args: { msg: 'hi' }, result: { msg: 'hi' } },
        { name: 'fail', args: { msg: 'hi' }, result: { msg: 'wrong' } },
      ],
      handler: ({ msg }) => ({ msg }),
    })

    const summary = await runExampleTests(app)
    const output = formatTestSummary(summary)
    expect(output).toContain('PASS')
    expect(output).toContain('FAIL')
    expect(output).toContain('1 passed')
    expect(output).toContain('1 failed')
  })
})

// =========================================================================
// Deep partial match unit tests
// =========================================================================

describe('deepPartialMatch', () => {
  it('matches identical primitives', () => {
    expect(deepPartialMatch(42, 42).ok).toBe(true)
    expect(deepPartialMatch('hello', 'hello').ok).toBe(true)
    expect(deepPartialMatch(true, true).ok).toBe(true)
    expect(deepPartialMatch(null, null).ok).toBe(true)
  })

  it('rejects different primitives', () => {
    expect(deepPartialMatch(42, 43).ok).toBe(false)
    expect(deepPartialMatch('a', 'b').ok).toBe(false)
  })

  it('matches subset of object', () => {
    expect(deepPartialMatch({ a: 1 }, { a: 1, b: 2 }).ok).toBe(true)
  })

  it('rejects missing key in object', () => {
    expect(deepPartialMatch({ a: 1, c: 3 }, { a: 1, b: 2 }).ok).toBe(false)
  })

  it('matches array elements (partial)', () => {
    expect(deepPartialMatch([{ id: 2 }], [{ id: 1 }, { id: 2 }, { id: 3 }]).ok).toBe(true)
  })

  it('rejects array element not found', () => {
    expect(deepPartialMatch([{ id: 99 }], [{ id: 1 }, { id: 2 }]).ok).toBe(false)
  })

  it('does not reuse one actual array element for multiple expected matches', () => {
    expect(deepPartialMatch([{ id: 1 }, { id: 1 }], [{ id: 1 }]).ok).toBe(false)
  })

  it('matches nested partial objects', () => {
    const expected = { user: { name: 'Alice' } }
    const actual = { user: { name: 'Alice', age: 30 }, extra: true }
    expect(deepPartialMatch(expected, actual).ok).toBe(true)
  })
})
