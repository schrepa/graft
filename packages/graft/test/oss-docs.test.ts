import { readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as ts from 'typescript'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = join(packageRoot, 'src')
const compilerOptions: ts.CompilerOptions = {
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  target: ts.ScriptTarget.ES2022,
  skipLibCheck: true,
  types: ['node', 'vitest'],
}

function resolvePublishedSourceModules(): string[] {
  const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
    exports?: Record<string, string | { import?: string }>
  }

  const modules = new Set<string>()
  for (const entry of Object.values(packageJson.exports ?? {})) {
    const importPath = typeof entry === 'string' ? entry : entry.import
    if (!importPath) continue

    modules.add(
      importPath
        .replace('./dist/', 'src/')
        .replace(/\.mjs$/, '.ts'),
    )
  }

  return [...modules].sort()
}

function resolveSourceModules(): string[] {
  return ts.sys.readDirectory(sourceRoot, ['.ts'], undefined, ['**/*.ts'])
    .filter((filePath) => !filePath.endsWith('.d.ts'))
    .map((filePath) => relative(packageRoot, filePath))
    .sort()
}

const documentedModules = resolvePublishedSourceModules()
const sourceModules = resolveSourceModules()
const requiredContractTags = new Map<string, string[]>([
  ['src/index.ts:createApp', ['param', 'returns']],
  ['src/openapi.ts:generateOpenApiSpec', ['param', 'returns']],
  ['src/server.ts:createNodeRequestHandler', ['param', 'returns', 'throws', 'example']],
  ['src/server.ts:startServer', ['param', 'returns', 'throws', 'example']],
  ['src/testing.ts:createMcpTestClient', ['param', 'returns', 'throws', 'example']],
])

function isLocalDeclaration(declaration: ts.Declaration): boolean {
  return declaration.getSourceFile().fileName.startsWith(sourceRoot)
}

function resolveSymbol(checker: ts.TypeChecker, symbol: ts.Symbol): ts.Symbol {
  return symbol.flags & ts.SymbolFlags.Alias
    ? checker.getAliasedSymbol(symbol)
    : symbol
}

function getPrimaryLocalDeclaration(declarations: readonly ts.Declaration[]): ts.Declaration | undefined {
  return declarations.find(isLocalDeclaration)
}

function isPureReexportFacade(sourceFile: ts.SourceFile): boolean {
  return sourceFile.statements.every((statement) =>
    ts.isExportDeclaration(statement) || ts.isImportDeclaration(statement),
  )
}

function baseRequiredTags(declaration: ts.Declaration): string[] {
  return ts.isFunctionDeclaration(declaration) ? ['param', 'returns'] : []
}

function getPresentTags(declaration: ts.Declaration): Set<string> {
  return new Set(ts.getJSDocTags(declaration).map((tag) => tag.tagName.text))
}

function getRequiredTags(relativePath: string, exportName: string, declaration: ts.Declaration): Set<string> {
  return new Set([
    ...baseRequiredTags(declaration),
    ...(requiredContractTags.get(`${relativePath}:${exportName}`) ?? []),
  ])
}

function inspectExportSymbol(
  checker: ts.TypeChecker,
  relativePath: string,
  exportedSymbol: ts.Symbol,
): string[] {
  const resolved = resolveSymbol(checker, exportedSymbol)
  const declarations = resolved.getDeclarations() ?? []
  if (!declarations.some(isLocalDeclaration)) return []

  const declaration = getPrimaryLocalDeclaration(declarations)
  if (!declaration) return []

  const docs = ts.displayPartsToString(resolved.getDocumentationComment(checker)).trim()
  if (!docs) return [`${relativePath}:${exportedSymbol.getName()}`]

  const requiredTags = getRequiredTags(relativePath, exportedSymbol.getName(), declaration)
  if (requiredTags.size === 0) return []

  const presentTags = getPresentTags(declaration)
  return [...requiredTags]
    .filter((tag) => !presentTags.has(tag))
    .map((tag) => `${relativePath}:${exportedSymbol.getName()}:missing @${tag}`)
}

function inspectModule(
  program: ts.Program,
  checker: ts.TypeChecker,
  relativePath: string,
): string[] {
  const sourceFile = program.getSourceFile(join(packageRoot, relativePath))
  if (!sourceFile) return []

  const moduleSymbol = checker.getSymbolAtLocation(sourceFile)
  if (!moduleSymbol) return []

  return checker.getExportsOfModule(moduleSymbol).flatMap((exportedSymbol) =>
    inspectExportSymbol(checker, relativePath, exportedSymbol),
  )
}

function collectMissingDocs(): string[] {
  const program = ts.createProgram(
    documentedModules.map((relativePath) => join(packageRoot, relativePath)),
    compilerOptions,
  )
  const checker = program.getTypeChecker()
  return documentedModules
    .flatMap((relativePath) => inspectModule(program, checker, relativePath))
    .sort()
}

function collectMissingSourceDocs(): string[] {
  const program = ts.createProgram(
    sourceModules.map((relativePath) => join(packageRoot, relativePath)),
    compilerOptions,
  )
  const checker = program.getTypeChecker()

  return sourceModules
    .flatMap((relativePath) => {
      const sourceFile = program.getSourceFile(join(packageRoot, relativePath))
      if (!sourceFile || isPureReexportFacade(sourceFile)) return []

      const moduleSymbol = checker.getSymbolAtLocation(sourceFile)
      if (!moduleSymbol) return []

      return checker.getExportsOfModule(moduleSymbol).flatMap((exportedSymbol) => {
        const resolved = resolveSymbol(checker, exportedSymbol)
        const declarations = resolved.getDeclarations() ?? []
        if (!declarations.some(isLocalDeclaration)) return []

        const docs = ts.displayPartsToString(resolved.getDocumentationComment(checker)).trim()
        return docs ? [] : [`${relativePath}:${exportedSymbol.getName()}`]
      })
    })
    .sort()
}

describe('published export docs', () => {
  it('documents every local export exposed from published OSS entrypoints', { timeout: 15_000 }, () => {
    expect(collectMissingDocs()).toEqual([])
  })
})

describe('source export docs', () => {
  it('documents every local export in src modules, excluding pure re-export facades', { timeout: 15_000 }, () => {
    expect(collectMissingSourceDocs()).toEqual([])
  })
})
