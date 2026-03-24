import { fork, type ChildProcess } from 'node:child_process'
import { watch, type FSWatcher } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Options controlling the watch mode development server.
 */
export interface DevServerOptions {
  entry?: string
  openapi?: string
  openapiTimeoutMs?: number
  config?: string
  target?: string
  port: number
  header: string[]
  lockedHeader: string[]
  watchDir?: string
  debounceMs?: number
}

interface ServeSupervisor {
  start(): void
  scheduleRestart(): void
  stop(): Promise<void>
}

function resolveWatchDir(opts: DevServerOptions): string {
  if (opts.watchDir) {
    return resolve(process.cwd(), opts.watchDir)
  }
  if (opts.entry) {
    return resolve(process.cwd(), dirname(opts.entry))
  }
  return resolve(process.cwd(), 'src')
}

function resolveCliPath(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), 'cli.mjs')
}

function startServeChild(serveArgs: string[]): ChildProcess {
  return fork(resolveCliPath(), ['serve', ...serveArgs], {
    stdio: ['pipe', 'inherit', 'inherit', 'ipc'],
    cwd: process.cwd(),
  })
}

function logChildExit(code: number | null, restarting: boolean): void {
  if (!restarting) {
    console.log(`\n  Server exited (code ${code}). Waiting for changes...\n`)
  }
}

async function stopChild(child: ChildProcess | null, timeoutMs = 3000): Promise<void> {
  if (!child) return

  child.kill('SIGTERM')
  await new Promise<void>((resolveStop) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      resolveStop()
    }, timeoutMs)
    child.on('exit', () => {
      clearTimeout(timeout)
      resolveStop()
    })
  })
}

function createServeSupervisor(serveArgs: string[], debounceMs: number): ServeSupervisor {
  let child: ChildProcess | null = null
  let restarting = false
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  function start(): void {
    child = startServeChild(serveArgs)
    child.on('exit', (code) => {
      logChildExit(code, restarting)
    })
  }

  async function restart(): Promise<void> {
    if (restarting) return
    restarting = true
    console.log('\n  File changed — restarting...\n')
    await stopChild(child)
    start()
    restarting = false
  }

  return {
    start,
    scheduleRestart() {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        debounceTimer = null
        void restart().catch((error) => {
          console.error('[graft] Failed to restart dev server:', error)
        })
      }, debounceMs)
    },
    async stop() {
      if (debounceTimer) {
        clearTimeout(debounceTimer)
        debounceTimer = null
      }
      await stopChild(child)
    },
  }
}

function shouldWatchFile(filename: string): boolean {
  return /\.(ts|tsx|js|mjs|json|yaml|yml)$/.test(filename)
    && !filename.includes('node_modules')
}

function createSourceWatcher(
  watchDir: string,
  onChange: () => void,
): FSWatcher {
  return watch(watchDir, { recursive: true }, (_event, filename) => {
    if (!filename || !shouldWatchFile(filename)) return
    onChange()
  })
}

async function waitForShutdown(
  watcher: FSWatcher,
  supervisor: ServeSupervisor,
): Promise<void> {
  await new Promise<void>((resolveStop) => {
    const shutdown = () => {
      watcher.close()
      void supervisor.stop().finally(() => {
        process.off('SIGINT', shutdown)
        process.off('SIGTERM', shutdown)
        resolveStop()
      })
    }

    process.once('SIGINT', shutdown)
    process.once('SIGTERM', shutdown)
  })
}

/**
 * Start the CLI development server with filesystem watch-and-restart behavior.
 *
 * @param opts Dev-server inputs such as entrypoint, proxy inputs, and watch settings.
 * @returns A promise that resolves when the process receives a shutdown signal.
 */
export async function startDevServer(opts: DevServerOptions): Promise<void> {
  const watchDir = resolveWatchDir(opts)
  const supervisor = createServeSupervisor(buildServeArgs(opts), opts.debounceMs ?? 200)
  const watcher = createSourceWatcher(watchDir, supervisor.scheduleRestart)

  supervisor.start()
  console.log(`\n  Dev server started — watching ${watchDir}\n`)

  await waitForShutdown(watcher, supervisor)
}

function buildServeArgs(opts: DevServerOptions): string[] {
  const args: string[] = []
  if (opts.entry) args.push('-e', opts.entry)
  if (opts.openapi) args.push('--openapi', opts.openapi)
  if (opts.openapiTimeoutMs !== undefined) {
    args.push('--openapi-timeout-ms', String(opts.openapiTimeoutMs))
  }
  if (opts.config) args.push('--config', opts.config)
  if (opts.target) args.push('--target', opts.target)
  args.push('-p', String(opts.port))
  for (const h of opts.header) args.push('--header', h)
  for (const h of opts.lockedHeader) args.push('--locked-header', h)
  return args
}
