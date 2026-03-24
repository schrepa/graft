import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('package contract', () => {
  it('publishes a CLI without a programmatic library entrypoint', () => {
    const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as Record<string, unknown>

    expect(packageJson.bin).toEqual({ 'create-graft-app': './dist/bin.mjs' })
    expect(packageJson).not.toHaveProperty('exports')
    expect(packageJson).not.toHaveProperty('main')
    expect(packageJson).not.toHaveProperty('module')
    expect(packageJson).not.toHaveProperty('types')
  })
})
