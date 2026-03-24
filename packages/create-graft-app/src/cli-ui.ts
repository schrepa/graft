/**
 * Read the first positional project name from CLI arguments.
 *
 * @param argv Raw command-line arguments after the executable name.
 * @returns The requested project name, or `undefined` when no positional argument was provided.
 * @example
 * parseProjectName(['my-app'])
 */
export function parseProjectName(argv: string[]): string | undefined {
  return argv.find((arg) => !arg.startsWith('--'))
}

/**
 * Print CLI usage to stderr.
 *
 * @returns Nothing.
 * @example
 * printUsage()
 */
export function printUsage(): void {
  console.error('Usage: create-graft-app <project-name>')
}

/**
 * Print the absolute target directory before scaffolding starts.
 *
 * @param projectDir Absolute path that will receive the new project.
 * @returns Nothing.
 * @example
 * printCreatingProject('/tmp/my-app')
 */
export function printCreatingProject(projectDir: string): void {
  console.log(`Creating Graft project in ${projectDir}...`)
}

/**
 * Print follow-up commands after a project is scaffolded successfully.
 *
 * @param projectName Generated package directory name.
 * @returns Nothing.
 * @example
 * printNextSteps('my-app')
 */
export function printNextSteps(projectName: string): void {
  console.log('')
  console.log('  Project created! Next steps:')
  console.log('')
  console.log(`    cd ${projectName}`)
  console.log('    npm install')
  console.log('    npm run dev')
  console.log('')
  console.log('  Run "npm run studio" to browse and test tools.')
  console.log('')
}
