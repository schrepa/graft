import type { ProxyConfig } from './shared.js'
import { failConfig } from './shared.js'
import {
  expandEnvVars,
  expectOptionalString,
  parseConfigDocument,
  parseConfigTool,
  parseDefinitions,
  parseHeaders,
} from './parse-helpers.js'

/** Validate and normalize a loaded proxy-config file. */
export function parseLoadedProxyConfig(
  content: string,
  filePath: string,
  env: Readonly<Record<string, string | undefined>>,
): ProxyConfig {
  const parsed = parseConfigDocument(content, filePath)
  const { target, tools } = parsed

  if (typeof target !== 'string' || target.length === 0) {
    failConfig(filePath, 'target', 'must specify a target URL')
  }

  if (!Array.isArray(tools)) {
    failConfig(filePath, 'tools', 'must be an array')
  }

  const definitions = parseDefinitions(parsed.definitions, filePath)

  return {
    target,
    name: expectOptionalString(parsed.name, filePath, 'name'),
    version: expectOptionalString(parsed.version, filePath, 'version'),
    headers: expandEnvVars(parseHeaders(parsed.headers, filePath), env, filePath),
    definitions,
    tools: tools.map((toolConfig, index) => parseConfigTool(toolConfig, index, filePath, definitions)),
  }
}
