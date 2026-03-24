/** Options that shape how OpenAPI operations are converted into tools. */
export interface OpenApiOptions {
  /** Only include operations with these tags. */
  includeTags?: string[]
  /** Exclude operations with these tags. */
  excludeTags?: string[]
  /** Override tool names per operationId. */
  nameOverrides?: Record<string, string>
  /** Logger for warnings about unsupported features. */
  logger?: OpenApiLogger
}

/** Minimal logger contract used during OpenAPI parsing. */
export interface OpenApiLogger {
  warn: (message: string, ...args: unknown[]) => void
}

/** HTTP methods recognized when scanning OpenAPI path items. */
export const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const

/** Minimal OpenAPI parameter shape consumed by the parser. */
export interface OpenApiParameter {
  $ref?: string
  name?: string
  in?: string
  description?: string
  required?: boolean
  schema?: OpenApiSchema
  example?: unknown
}

/** Minimal OpenAPI schema shape consumed by the parser. */
export interface OpenApiSchema {
  $ref?: string
  type?: string
  properties?: Record<string, OpenApiSchema>
  required?: string[]
  description?: string
  items?: OpenApiSchema
  allOf?: OpenApiSchema[]
  [key: string]: unknown
}

/** OpenAPI components subset used for resolving `$ref` pointers. */
export interface OpenApiComponents {
  schemas?: Record<string, OpenApiSchema>
  parameters?: Record<string, OpenApiParameter>
  [key: string]: unknown
}
