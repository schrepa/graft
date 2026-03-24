import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = join(packageRoot, 'src')
const publicFacadeFiles = new Set([
  join(sourceRoot, 'index.ts'),
  join(sourceRoot, 'app.ts'),
  join(sourceRoot, 'http.ts'),
  join(sourceRoot, 'mcp.ts'),
  join(sourceRoot, 'openapi.ts'),
  join(sourceRoot, 'pipeline.ts'),
  join(sourceRoot, 'server.ts'),
  join(sourceRoot, 'tool-builder.ts'),
])
const facadeImportPattern = /from ['"](\.\/|\.\.\/)(app|http|mcp|pipeline|server|tool-builder)\.js['"]/g

function collectSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) return collectSourceFiles(fullPath)
    return entry.name.endsWith('.ts') ? [fullPath] : []
  })
}

describe('internal source imports', () => {
  it('does not import package public facades from internal modules', () => {
    const offenders = collectSourceFiles(sourceRoot)
      .filter((filePath) => !publicFacadeFiles.has(filePath))
      .flatMap((filePath) => {
        const source = readFileSync(filePath, 'utf-8')
        return Array.from(source.matchAll(facadeImportPattern)).map((match) => {
          return `${filePath.replace(`${packageRoot}/`, '')}:${match[0]}`
        })
      })

    expect(offenders).toEqual([])
  })
})
