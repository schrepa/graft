/** Binary payload accepted by rich result helpers. */
export type BinaryPayload = string | Uint8Array | ArrayBuffer

/** Return true when a value is a byte container instead of a base64 string. */
export function isBinaryBytes(value: unknown): value is Uint8Array | ArrayBuffer {
  return value instanceof Uint8Array || value instanceof ArrayBuffer
}

/** Normalize binary payloads to base64 strings for MCP image/audio content. */
export function toBase64(value: BinaryPayload): string {
  if (typeof value === 'string') return value
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value)
  return Buffer.from(bytes).toString('base64')
}

/** Normalize binary payloads to byte arrays for HTTP responses. */
export function toBytes(value: BinaryPayload): Uint8Array {
  if (typeof value === 'string') return new Uint8Array(Buffer.from(value, 'base64'))
  return value instanceof Uint8Array ? value : new Uint8Array(value)
}
