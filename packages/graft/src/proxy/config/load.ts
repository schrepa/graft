import { readFile } from 'node:fs/promises'
import type { LoadProxyConfigOptions, ProxyConfig } from './shared.js'
import { failConfig, getErrorMessage } from './shared.js'
import { parseLoadedProxyConfig } from './parse.js'

/**
 * Load and parse a proxy config file (YAML or JSON).
 *
 * @param filePath Path to the proxy config document.
 * @param options Optional environment map for `${VAR}` header expansion.
 * @returns The parsed proxy configuration.
 * @throws {import('./shared.js').ProxyConfigError} When the file cannot be read or the document is invalid.
 */
export async function loadProxyConfig(
  filePath: string,
  options: LoadProxyConfigOptions,
): Promise<ProxyConfig> {
  let content: string
  try {
    content = await readFile(filePath, 'utf-8')
  } catch (error) {
    failConfig(filePath, '', `Failed to read proxy config: ${getErrorMessage(error)}`, error)
  }

  return parseLoadedProxyConfig(content, filePath, options.env)
}
