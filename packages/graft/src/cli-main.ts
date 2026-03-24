import { Command, CommanderError } from 'commander'
import { registerAddToolCommand } from './cli/commands/add-tool.js'
import { registerCheckCommand } from './cli/commands/check.js'
import { registerDevCommand } from './cli/commands/dev.js'
import { registerInstallCommand } from './cli/commands/install.js'
import { registerServeCommand } from './cli/commands/serve.js'
import { registerStudioCommand } from './cli/commands/studio.js'
import { registerTestCommand } from './cli/commands/test.js'
import { GRAFT_VERSION } from './version.js'

function createProgram(): Command {
  const program = new Command()

  program
    .name('graft')
    .description('Graft — define once, serve as HTTP and MCP')
    .version(GRAFT_VERSION)

  registerServeCommand(program)
  registerCheckCommand(program)
  registerStudioCommand(program)
  registerInstallCommand(program)
  registerDevCommand(program)
  registerAddToolCommand(program)
  registerTestCommand(program)

  return program
}

/**
 * Print a CLI error and return a non-zero exit code.
 *
 * @param error Unknown error raised while running the CLI.
 * @returns `1`.
 */
export function reportCliError(error: unknown): number {
  console.error(error instanceof Error ? error.message : String(error))
  return 1
}

/**
 * Run the `graft` CLI with the provided argv list.
 *
 * @param argv Raw user arguments after the executable name.
 * @returns The resulting process exit code.
 */
export async function runCli(argv: string[]): Promise<number> {
  const program = createProgram()
  program.exitOverride()

  try {
    await program.parseAsync(argv, { from: 'user' })
    return typeof process.exitCode === 'number' ? process.exitCode : 0
  } catch (error) {
    if (error instanceof CommanderError) {
      return typeof error.exitCode === 'number' ? error.exitCode : 1
    }

    return reportCliError(error)
  }
}

/**
 * Wrap `runCli()` so unexpected bootstrap failures still map to a deterministic exit code.
 *
 * @param argv Raw user arguments after the executable name.
 * @param run Optional runner override used by tests.
 * @returns The final process exit code.
 */
export async function main(
  argv: string[],
  run: (argv: string[]) => Promise<number> = runCli,
): Promise<number> {
  try {
    return await run(argv)
  } catch (error) {
    return reportCliError(error)
  }
}
