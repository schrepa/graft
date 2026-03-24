import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readOpenApiInput } from '../src/openapi-input.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('readOpenApiInput', () => {
  it('includes the resolved path when a local OpenAPI file cannot be read', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'graft-openapi-input-'))
    tempDirs.push(cwd)
    const missingPath = join(cwd, 'missing-openapi.yaml')

    await expect(readOpenApiInput('missing-openapi.yaml', { cwd })).rejects.toThrow(
      `Failed to read OpenAPI spec at ${missingPath}`,
    )
  })

  it('aborts local file reads when the caller signal is already aborted', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'graft-openapi-input-'))
    tempDirs.push(cwd)
    writeFileSync(join(cwd, 'openapi.yaml'), 'openapi: 3.1.0')

    const controller = new AbortController()
    controller.abort()

    await expect(
      readOpenApiInput('openapi.yaml', { cwd, signal: controller.signal }),
    ).rejects.toThrow(/abort/i)
  })
})
