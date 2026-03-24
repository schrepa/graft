import type { ToolExample } from '../../types.js'
import type { OpenApiComponents } from './types.js'
import {
  isRecordSchema,
  readParameters,
  readString,
  resolveRef,
  toContentMap,
  toRecord,
} from './shared.js'

/** Extract up to three request examples from one OpenAPI operation. */
export function extractExamples(
  operation: Record<string, unknown>,
  components: OpenApiComponents,
  labels: {
    requestBodyContent?: string
    parameters?: string
  } = {},
): ToolExample[] {
  return extractXExamples(operation)
    ?? extractBodyExamples(operation, components, labels.requestBodyContent)
    ?? extractParamExamples(operation, components, labels.parameters)
}

function extractXExamples(operation: Record<string, unknown>): ToolExample[] | null {
  if (!Array.isArray(operation['x-examples'])) return null

  const examples: ToolExample[] = []
  for (const example of operation['x-examples']) {
    const record = toRecord(example)
    if (!record || !isRecordSchema(record.args)) continue

    examples.push({
      name: readString(record.name),
      args: record.args,
      description: readString(record.description),
    })
  }

  return examples.length > 0 ? examples.slice(0, 3) : null
}

function extractBodyExamples(
  operation: Record<string, unknown>,
  components: OpenApiComponents,
  requestBodyContentLabel = 'OpenAPI requestBody.content',
): ToolExample[] | null {
  const requestBody = toRecord(resolveRef(operation.requestBody, components))
  const content = toContentMap(requestBody?.content, requestBodyContentLabel)
  const jsonContent = content?.['application/json']
  if (!jsonContent) return null

  const examples: ToolExample[] = []
  appendInlineBodyExample(examples, jsonContent.example)
  appendNamedBodyExamples(examples, jsonContent.examples, components)
  return examples.length > 0 ? examples.slice(0, 3) : null
}

function appendInlineBodyExample(examples: ToolExample[], value: unknown): void {
  if (!isRecordSchema(value)) return
  examples.push({ args: value })
}

function appendNamedBodyExamples(
  examples: ToolExample[],
  value: unknown,
  components: OpenApiComponents,
): void {
  if (!isRecordSchema(value)) return

  for (const [name, exampleObject] of Object.entries(value)) {
    const resolved = toRecord(resolveRef(exampleObject, components))
    if (!isRecordSchema(resolved?.value)) continue

    examples.push({
      name,
      args: resolved.value,
      ...(readString(resolved.summary) ? { description: readString(resolved.summary) } : {}),
    })
  }
}

function extractParamExamples(
  operation: Record<string, unknown>,
  components: OpenApiComponents,
  parameterLabel = 'OpenAPI operation parameters',
): ToolExample[] {
  const params = readParameters(operation.parameters, components, parameterLabel)
  const args: Record<string, unknown> = {}
  let hasExample = false

  for (const parameter of params) {
    if (parameter.name && parameter.example !== undefined) {
      args[parameter.name] = parameter.example
      hasExample = true
    }
  }

  return hasExample ? [{ args }] : []
}
