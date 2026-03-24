import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

/**
 * Options controlling how an OpenAPI input is resolved and loaded.
 */
export interface OpenApiInputOptions {
  cwd?: string
  signal?: AbortSignal
  timeoutMs?: number
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Check whether an OpenAPI input should be fetched remotely rather than read from disk.
 *
 * @param input Local filesystem path or HTTP(S) URL.
 * @returns `true` when the input is an HTTP(S) URL.
 */
export function isRemoteOpenApiInput(input: string): boolean {
  return input.startsWith('http://') || input.startsWith('https://')
}

/**
 * Read an OpenAPI document from either a local path or remote URL.
 *
 * @param input Local filesystem path or HTTP(S) URL.
 * @param options Optional cwd override and abort signal.
 * @returns The raw OpenAPI document text.
 * @throws {Error} When the input cannot be read or fetched.
 */
export async function readOpenApiInput(
  input: string,
  options: OpenApiInputOptions = {},
): Promise<string> {
  if (!isRemoteOpenApiInput(input)) {
    return readOpenApiFile(resolve(options.cwd ?? process.cwd(), input), resolveOpenApiSignal(options))
  }

  try {
    const response = await fetch(input, {
      signal: resolveOpenApiSignal(options, 30_000),
    })
    if (!response.ok) {
      throw new Error(`Failed to fetch OpenAPI spec: ${response.status} ${response.statusText}`)
    }
    return await response.text()
  } catch (error) {
    throw new Error(`Failed to fetch OpenAPI spec from ${input}: ${getErrorMessage(error)}`, {
      cause: error instanceof Error ? error : undefined,
    })
  }
}

async function readOpenApiFile(filePath: string, signal?: AbortSignal): Promise<string> {
  try {
    return await readFile(filePath, { encoding: 'utf-8', signal })
  } catch (error) {
    throw new Error(`Failed to read OpenAPI spec at ${filePath}: ${getErrorMessage(error)}`, {
      cause: error instanceof Error ? error : undefined,
    })
  }
}

function resolveOpenApiSignal(
  options: OpenApiInputOptions,
  defaultTimeoutMs?: number,
): AbortSignal | undefined {
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs
  const timeoutSignal = timeoutMs === undefined ? undefined : AbortSignal.timeout(timeoutMs)

  if (options.signal && timeoutSignal) {
    return AbortSignal.any([options.signal, timeoutSignal])
  }

  return options.signal ?? timeoutSignal
}
