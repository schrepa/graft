import { resolve } from 'node:path'
import { parseProjectName, printCreatingProject, printNextSteps, printUsage } from './cli-ui.js'
import { createProject } from './scaffold.js'

/**
 * Run the `create-graft-app` CLI.
 *
 * @param argv Raw CLI arguments after the executable name.
 * @returns A process exit code.
 * @throws {Error} When project creation fails.
 * @example
 * await runCli(['my-app'])
 */
export async function runCli(argv: string[]): Promise<number> {
  const projectName = parseProjectName(argv)
  if (!projectName) {
    printUsage()
    return 1
  }

  const projectDir = resolve(process.cwd(), projectName)
  printCreatingProject(projectDir)
  await createProject({ projectDir, projectName })
  printNextSteps(projectName)
  return 0
}

/**
 * Print a CLI error and return a non-zero exit code.
 *
 * @param error Unknown error raised while running the CLI.
 * @returns `1`.
 * @example
 * process.exitCode = reportCliError(new Error('boom'))
 */
export function reportCliError(error: unknown): number {
  console.error(error instanceof Error ? error.message : String(error))
  return 1
}
