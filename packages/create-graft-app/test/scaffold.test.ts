import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ts from 'typescript'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineTool, z } from '../../graft/src/index.js'
import graftPackageManifest from '../../graft/package.json'
import { runCli } from '../src/cli.js'
import { createProject } from '../src/scaffold.js'
import type { App, DefinedTool } from '../../graft/src/index.js'

interface EchoModule {
  echoTool: DefinedTool
}

interface StoreValueModule {
  storeValueTool: DefinedTool
}

function evaluateGeneratedModule<T>(
  source: string,
  bindings: Record<string, unknown>,
  returnStatement: string,
): T {
  const moduleSource = source
    .replace(/^import .*$/gm, '')
    .replace(/^export const /gm, 'const ')
    .replace(/^export default app$/m, '')
  const compiled = ts.transpileModule(`${moduleSource}\n${returnStatement}`, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  }).outputText
  return new Function(...Object.keys(bindings), compiled)(...Object.values(bindings)) as T
}

function loadGeneratedGreenfieldApp(projectDir: string): App {
  const echoSource = readFileSync(join(projectDir, 'src', 'tools', 'echo.ts'), 'utf-8')
  const { echoTool } = evaluateGeneratedModule<EchoModule>(
    echoSource,
    { defineTool, z },
    'return { echoTool }',
  )

  const storeValueSource = readFileSync(join(projectDir, 'src', 'tools', 'store-value.ts'), 'utf-8')
  const { storeValueTool } = evaluateGeneratedModule<StoreValueModule>(
    storeValueSource,
    { defineTool, z },
    'return { storeValueTool }',
  )

  const appSource = readFileSync(join(projectDir, 'src', 'app.ts'), 'utf-8')
  return evaluateGeneratedModule<App>(
    appSource,
    { createApp, echoTool, storeValueTool },
    'return app',
  )
}

describe('create-graft-app', () => {
  const originalCwd = process.cwd()
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'create-graft-app-'))
    process.chdir(tmpDir)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    vi.restoreAllMocks()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('creates the expected greenfield scaffold', async () => {
    const projectDir = join(tmpDir, 'my-app')

    await createProject({ projectDir, projectName: 'my-app' })

    expect(existsSync(join(projectDir, 'src', 'app.ts'))).toBe(true)
    expect(existsSync(join(projectDir, 'src', 'tools', 'echo.ts'))).toBe(true)
    expect(existsSync(join(projectDir, 'src', 'tools', 'store-value.ts'))).toBe(true)
    expect(JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf-8')).name).toBe('my-app')
  })

  it('builds the generated greenfield app without example validation errors', async () => {
    const projectDir = join(tmpDir, 'buildable-app')

    await createProject({ projectDir, projectName: 'buildable-app' })

    const packageJson = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf-8'))
    expect(packageJson.dependencies['@schrepa/graft']).toBe(`^${graftPackageManifest.version}`)

    const appSource = readFileSync(join(projectDir, 'src', 'app.ts'), 'utf-8')
    expect(appSource).toContain("import { createApp } from '@schrepa/graft'")

    const app = loadGeneratedGreenfieldApp(projectDir)
    expect(() => app.build()).not.toThrow()
  })

  it('refuses to overwrite an existing directory', async () => {
    const projectDir = join(tmpDir, 'existing-app')
    await createProject({ projectDir, projectName: 'existing-app' })

    await expect(createProject({ projectDir, projectName: 'existing-app' })).rejects.toThrow('already exists')
  })

  it('prints usage and returns exit code 1 when project name is missing', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(runCli([])).resolves.toBe(1)
    expect(errorSpy).toHaveBeenCalledWith('Usage: create-graft-app <project-name>')
  })

  it('returns exit code 0 and scaffolds the requested project', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await expect(runCli(['demo-app'])).resolves.toBe(0)
    expect(existsSync(join(tmpDir, 'demo-app', 'src', 'app.ts'))).toBe(true)
    expect(logSpy).toHaveBeenCalled()
  })
})
