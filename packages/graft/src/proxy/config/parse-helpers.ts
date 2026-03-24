import YAML from 'yaml'
import type {
  JsonSchema,
  ParameterLocation,
  ParameterLocationEntry,
  ToolAuth,
  ToolExample,
} from '../../types.js'
import { parseHttpMethod } from '../../http-method.js'
import type { HttpMethod } from '../../http-method.js'
import { expectPlainRecord } from '../../object-schema.js'
import { validateParameterLocation } from '../../parameter-location.js'
import { resolveJsonSchemaRefs } from '../schema.js'
import type {
  ConfigTool,
  ProxyConfigDocument,
} from './shared.js'
import {
  failConfig,
  getErrorMessage,
  wrapConfigError,
} from './shared.js'

/** Parse raw YAML or JSON proxy-config contents into a loose document shape. */
export function parseConfigDocument(content: string, filePath: string): ProxyConfigDocument {
  const parsed = filePath.endsWith('.json')
    ? (() => {
        try {
          return JSON.parse(content)
        } catch (error) {
          failConfig(
            filePath,
            '',
            'Invalid JSON\n'
              + `  ${getErrorMessage(error)}\n\n`
              + '  Check for trailing commas, missing quotes, or unclosed braces.',
            error,
          )
        }
      })()
    : wrapConfigError(filePath, '', () => YAML.parse(content))

  const record = wrapConfigError(
    filePath,
    '',
    () => expectPlainRecord(parsed, `Invalid config file: ${filePath}`),
  )

  return {
    target: record.target,
    name: record.name,
    version: record.version,
    headers: record.headers,
    definitions: record.definitions,
    tools: record.tools,
  }
}

function getRequiredStringField(
  record: Record<string, unknown>,
  field: string,
  index: number,
  filePath: string,
  help?: string,
): string {
  const value = record[field]
  if (typeof value === 'string') return value

  const message = value === undefined
    ? `is required${help ? ` (${help})` : ''}`
    : `must be a string${help ? ` (${help})` : ''}`
  failConfig(filePath, `tools[${index}].${field}`, message)
}

/** Read an optional string field from proxy config input. */
export function expectOptionalString(
  value: unknown,
  filePath: string,
  field: string,
): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') {
    failConfig(filePath, field, 'must be a string')
  }
  return value
}

function expectStringArray(
  value: unknown,
  filePath: string,
  field: string,
): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    failConfig(filePath, field, 'must be an array of strings')
  }
  return [...value]
}

function resolveSchemaField(
  value: unknown,
  filePath: string,
  field: string,
  definitions?: Record<string, unknown>,
): JsonSchema | undefined {
  if (value === undefined) return undefined
  return wrapConfigError(filePath, field, () => {
    const resolved = definitions
      ? resolveJsonSchemaRefs(value, definitions)
      : value
    return expectPlainRecord(resolved, field)
  })
}

function parseToolExamples(
  value: unknown,
  index: number,
  filePath: string,
): ToolExample[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) {
    failConfig(filePath, `tools[${index}].examples`, 'must be an array')
  }

  return value.map((example, exampleIndex) => {
    const fieldPrefix = `tools[${index}].examples[${exampleIndex}]`
    const record = wrapConfigError(
      filePath,
      fieldPrefix,
      () => expectPlainRecord(example, `${fieldPrefix} in ${filePath}`),
    )
    const parsed: ToolExample = {
      args: wrapConfigError(
        filePath,
        `${fieldPrefix}.args`,
        () => expectPlainRecord(record.args, `${fieldPrefix}.args in ${filePath}`),
      ),
    }

    if (record.name !== undefined) {
      if (typeof record.name !== 'string') {
        failConfig(filePath, `${fieldPrefix}.name`, 'must be a string')
      }
      parsed.name = record.name
    }

    if (record.description !== undefined) {
      if (typeof record.description !== 'string') {
        failConfig(filePath, `${fieldPrefix}.description`, 'must be a string')
      }
      parsed.description = record.description
    }

    if ('result' in record) {
      parsed.result = record.result
    }

    return parsed
  })
}

function isParameterLocation(value: unknown): value is ParameterLocation {
  return value === 'path' || value === 'query' || value === 'header' || value === 'body'
}

function parseParameterLocations(
  value: unknown,
  index: number,
  filePath: string,
): Record<string, ParameterLocation | ParameterLocationEntry> | undefined {
  if (value === undefined) return undefined

  const record = wrapConfigError(
    filePath,
    `tools[${index}].parameterLocations`,
    () => expectPlainRecord(value, `tools[${index}].parameterLocations in ${filePath}`),
  )
  const parsed: Record<string, ParameterLocation | ParameterLocationEntry> = {}

  for (const [paramName, rawLocation] of Object.entries(record)) {
    if (isParameterLocation(rawLocation)) {
      parsed[paramName] = rawLocation
      continue
    }

    const entry = wrapConfigError(
      filePath,
      `tools[${index}].parameterLocations.${paramName}`,
      () => expectPlainRecord(rawLocation, `tools[${index}].parameterLocations.${paramName} in ${filePath}`),
    )
    parsed[paramName] = validateParameterLocation(
      entry,
      `tools[${index}].parameterLocations.${paramName}`,
      (message) => failConfig(filePath, '', message),
    )
  }

  return parsed
}

function parseToolAuth(
  value: unknown,
  index: number,
  filePath: string,
): ToolAuth | undefined {
  if (value === undefined || value === true || value === false) return value

  if (Array.isArray(value)) {
    if (!value.every((item): item is string => typeof item === 'string')) {
      failConfig(filePath, `tools[${index}].auth`, 'roles array must contain only strings')
    }
    return value
  }

  const record = wrapConfigError(
    filePath,
    `tools[${index}].auth`,
    () => expectPlainRecord(value, `tools[${index}].auth in ${filePath}`),
  )
  if (record.roles === undefined) return {}
  if (!Array.isArray(record.roles) || !record.roles.every((item): item is string => typeof item === 'string')) {
    failConfig(filePath, `tools[${index}].auth.roles`, 'must be an array of strings')
  }

  return { roles: record.roles }
}

/** Parse the top-level static headers block from proxy config input. */
export function parseHeaders(
  headers: unknown,
  filePath: string,
): Record<string, string> | undefined {
  if (headers === undefined) return undefined
  const record = wrapConfigError(
    filePath,
    'headers',
    () => expectPlainRecord(headers, `headers in ${filePath}`),
  )
  const parsed: Record<string, string> = {}
  for (const [key, value] of Object.entries(record)) {
    if (typeof value !== 'string') {
      failConfig(filePath, `headers.${key}`, 'must be a string')
    }
    parsed[key] = value
  }
  return parsed
}

/** Parse the top-level reusable schema definitions block from proxy config input. */
export function parseDefinitions(
  definitions: unknown,
  filePath: string,
): Record<string, unknown> | undefined {
  if (definitions === undefined) return undefined
  return wrapConfigError(
    filePath,
    'definitions',
    () => expectPlainRecord(definitions, `definitions in ${filePath}`),
  )
}

/** Parse and normalize a single tool entry from proxy config input. */
export function parseConfigTool(
  toolConfig: unknown,
  index: number,
  filePath: string,
  definitions?: Record<string, unknown>,
): ConfigTool {
  const toolRecord = wrapConfigError(
    filePath,
    `tools[${index}]`,
    () => expectPlainRecord(toolConfig, `tools[${index}] in ${filePath}`),
  )
  const methodValue = getRequiredStringField(
    toolRecord,
    'method',
    index,
    filePath,
    'expected string like "GET", "POST"',
  )

  let method: HttpMethod
  try {
    method = parseHttpMethod(methodValue, `tools[${index}] in ${filePath}: invalid "method"`)
  } catch (error) {
    failConfig(
      filePath,
      `tools[${index}].method`,
      `invalid method: ${getErrorMessage(error)}`,
      error,
    )
  }

  const path = getRequiredStringField(
    toolRecord,
    'path',
    index,
    filePath,
    'expected string like "/users/:id"',
  )
  const description = getRequiredStringField(toolRecord, 'description', index, filePath)

  return {
    method,
    path,
    description,
    name: expectOptionalString(toolRecord.name, filePath, `tools[${index}].name`),
    parameters: resolveSchemaField(toolRecord.parameters, filePath, `tools[${index}].parameters`, definitions),
    outputSchema: resolveSchemaField(toolRecord.outputSchema, filePath, `tools[${index}].outputSchema`, definitions),
    tags: expectStringArray(toolRecord.tags, filePath, `tools[${index}].tags`),
    auth: parseToolAuth(toolRecord.auth, index, filePath),
    examples: parseToolExamples(toolRecord.examples, index, filePath),
    parameterLocations: parseParameterLocations(toolRecord.parameterLocations, index, filePath),
  }
}

/** Expand `${VAR}` placeholders in config headers using the provided environment map. */
export function expandEnvVars(
  headers: Record<string, string> | undefined,
  env: Readonly<Record<string, string | undefined>>,
  filePath: string,
): Record<string, string> | undefined {
  if (!headers) return undefined

  const missing = new Set<string>()
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    result[key] = value.replace(/\$\{([^}]+)\}/g, (_, varName) => {
      const resolvedValue = env[varName]
      if (resolvedValue === undefined) missing.add(varName)
      return resolvedValue ?? ''
    })
  }

  if (missing.size > 0) {
    failConfig(
      filePath,
      'headers',
      `Missing environment variable(s): ${[...missing].join(', ')}. Required by proxy config header substitutions.`,
    )
  }

  return result
}
