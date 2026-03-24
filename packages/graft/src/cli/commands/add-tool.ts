import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Command } from 'commander'

const GRAFT_PACKAGE_NAME = '@schrepa/graft'

/**
 * Resolve the directory where `graft add-tool` should write a new tool file.
 *
 * @param cwd Project root that the command is running from.
 * @returns `src/tools`, `src`, or the project root as a final fallback.
 */
export function resolveToolOutputDir(cwd: string): string {
  const toolsDir = join(cwd, 'src', 'tools')
  const srcDir = join(cwd, 'src')
  if (existsSync(toolsDir)) return toolsDir
  if (existsSync(srcDir)) return srcDir
  return cwd
}

/**
 * Register the `add-tool` subcommand on a Commander program.
 *
 * @param program Commander instance to extend.
 * @example
 * registerAddToolCommand(new Command())
 */
export function registerAddToolCommand(program: Command): void {
  program
    .command('add-tool <name>')
    .description('Generate a new tool file')
    .action(async (name: string) => {
      const { fileName, exportName, contents } = renderToolTemplate(name)

      const cwd = process.cwd()
      const toolsDir = join(cwd, 'src', 'tools')
      const srcDir = join(cwd, 'src')
      const outputDir = resolveToolOutputDir(cwd)
      const filePath = join(outputDir, fileName)

      if (existsSync(filePath)) {
        throw new Error(`File already exists: ${filePath}`)
      }

      mkdirSync(outputDir, { recursive: true })
      writeFileSync(filePath, contents)

      const relativePath = filePath.startsWith(srcDir)
        ? './' + filePath.slice(srcDir.length + 1).replace(/\.ts$/, '.js')
        : './' + fileName.replace(/\.ts$/, '.js')
      const importPath = existsSync(toolsDir) ? `./tools/${fileName.replace(/\.ts$/, '.js')}` : relativePath

      console.log(`\n  Created ${filePath}\n`)
      console.log('  Register it in your app:\n')
      console.log(`    import { ${exportName} } from '${importPath}'`)
      console.log(`    app.tool(${exportName})\n`)
    })
}

function renderToolTemplate(name: string): { fileName: string; exportName: string; contents: string } {
  const fileName = name.replace(/_/g, '-') + '.ts'
  const exportName = name.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase()) + 'Tool'

  return {
    fileName,
    exportName,
    contents: `import { defineTool, z } from '${GRAFT_PACKAGE_NAME}'

/**
 * Replace the scaffolded schema and handler before exposing this tool.
 */
export const ${exportName} = defineTool('${name}', {
  description: '${name.replace(/_/g, ' ')}',
  params: z.object({}),
  handler: async () => {
    throw new Error('Replace the scaffolded handler before using this tool.')
  },
})
`,
  }
}
