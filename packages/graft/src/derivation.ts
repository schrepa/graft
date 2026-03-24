import { hasSideEffects, parseHttpMethod } from './http-method.js'

/** Irregular -ves → singular mappings */
const VES_IRREGULARS: Record<string, string> = {
  shelves: 'shelf', knives: 'knife', leaves: 'leaf',
  wolves: 'wolf', halves: 'half', calves: 'calf',
  loaves: 'loaf', lives: 'life', wives: 'wife',
  thieves: 'thief', scarves: 'scarf',
}

const SINGULAR_RULES: Array<{
  matches: (word: string) => boolean
  apply: (word: string) => string
}> = [
  {
    matches: (word) => word.endsWith('ies') && word.length > 4,
    apply: (word) => word.slice(0, -3) + 'y',
  },
  {
    matches: (word) =>
      word.endsWith('ses') ||
      word.endsWith('xes') ||
      word.endsWith('zes') ||
      word.endsWith('ches') ||
      word.endsWith('shes'),
    apply: (word) => word.slice(0, -2),
  },
  {
    matches: (word) => word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('us') && word.length > 2,
    apply: (word) => word.slice(0, -1),
  },
]

/** Derive a tool name from HTTP method + path */
export function deriveToolName(method: string, path: string): string {
  const prefix = parseHttpMethod(method, 'Tool method').toLowerCase()
  const { nameSegments, lastSegmentIsParam } = extractNameSegments(path)
  const parts = normalizeNameParts(nameSegments)

  singularizeLeadingParts(parts)
  singularizeTrailingPart(parts, prefix, lastSegmentIsParam)

  return [prefix, ...parts].join('_').toLowerCase()
}

/** Convert tool name to URL path: underscores → dashes, prepend slash */
export function nameToPath(name: string): string {
  return `/${name.replace(/_/g, '-')}`
}

/** Derive whether a method has side effects */
export function deriveSideEffects(method: string): boolean {
  return hasSideEffects(parseHttpMethod(method, 'Tool method'))
}

/** Simple English singularization */
function singularize(word: string): string {
  const lower = word.toLowerCase()
  if (VES_IRREGULARS[lower]) return VES_IRREGULARS[lower]

  const rule = SINGULAR_RULES.find((candidate) => candidate.matches(word))
  if (rule) return rule.apply(word)
  return word
}

function stripCommonPrefixes(path: string): string {
  return path
    .replace(/^\/api\//i, '/')
    .replace(/^\/v\d+\//i, '/')
}

function isPathParameterSegment(segment: string | undefined): boolean {
  return Boolean(
    segment &&
    (segment.startsWith(':') ||
      (segment.startsWith('{') && segment.endsWith('}'))),
  )
}

function extractNameSegments(path: string): {
  nameSegments: string[]
  lastSegmentIsParam: boolean
} {
  const segments = stripCommonPrefixes(path).split('/').filter(Boolean)
  return {
    nameSegments: segments.filter((segment) => !isPathParameterSegment(segment)),
    lastSegmentIsParam: isPathParameterSegment(segments.at(-1)),
  }
}

function normalizeNameParts(nameSegments: string[]): string[] {
  return nameSegments.map((segment) => segment.replace(/[^a-zA-Z0-9]/g, '_'))
}

function singularizeLeadingParts(parts: string[]): void {
  for (let index = 0; index < parts.length - 1; index++) {
    parts[index] = singularize(parts[index])
  }
}

function singularizeTrailingPart(
  parts: string[],
  prefix: string,
  lastSegmentIsParam: boolean,
): void {
  if (parts.length === 0) return
  if (!lastSegmentIsParam && prefix !== 'post') return
  parts[parts.length - 1] = singularize(parts[parts.length - 1])
}
