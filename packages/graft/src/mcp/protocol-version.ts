/** Latest MCP protocol version emitted by Graft discovery and adapter responses. */
export const CURRENT_MCP_PROTOCOL_VERSION = '2025-11-25'

/** Ordered list of protocol versions accepted by the MCP transport. */
export const SUPPORTED_MCP_PROTOCOL_VERSIONS = [
  CURRENT_MCP_PROTOCOL_VERSION,
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
] as const

/** Union of MCP protocol versions currently supported by this package. */
export type SupportedMcpProtocolVersion = typeof SUPPORTED_MCP_PROTOCOL_VERSIONS[number]

/**
 * Check whether a client-supplied version is supported by this package.
 *
 * @param value Protocol version from an MCP client or request header.
 * @returns `true` when the version is supported by Graft.
 */
export function isSupportedMcpProtocolVersion(value: string): value is SupportedMcpProtocolVersion {
  return SUPPORTED_MCP_PROTOCOL_VERSIONS.some((supported) => supported === value)
}

/**
 * Normalize an optional client-supplied protocol version to a supported value.
 *
 * @param value Protocol version from an MCP client or request header.
 * @returns The supplied version when supported, otherwise the oldest supported baseline.
 */
export function normalizeMcpProtocolVersion(
  value: string | null | undefined,
): SupportedMcpProtocolVersion {
  return value && isSupportedMcpProtocolVersion(value) ? value : '2025-03-26'
}

/**
 * Check whether SSE responses for the given protocol version should emit an event id preamble.
 *
 * @param version Supported MCP protocol version negotiated for the response.
 * @returns `true` when the response should include an SSE event id preamble.
 */
export function supportsSseEventIdPreamble(version: SupportedMcpProtocolVersion): boolean {
  return version === CURRENT_MCP_PROTOCOL_VERSION
}
