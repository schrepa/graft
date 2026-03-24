import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  buildClaudeServerConfig,
  ensureClaudeServers,
  readClaudeDesktopConfig,
} from '../src/cli/claude-desktop.js'

describe('Claude Desktop config helpers', () => {
  let tempDir: string
  let originalCwd: string

  beforeEach(() => {
    originalCwd = process.cwd()
    tempDir = mkdtempSync(join(tmpdir(), 'graft-claude-'))
  })

  afterEach(() => {
    process.chdir(originalCwd)
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('treats a missing config file as empty config', () => {
    const config = readClaudeDesktopConfig(join(tempDir, 'missing.json'))
    expect(config).toEqual({})
  })

  it('throws on malformed JSON instead of silently returning empty config', () => {
    const configPath = join(tempDir, 'claude_desktop_config.json')
    writeFileSync(configPath, '{ invalid json')

    expect(() => readClaudeDesktopConfig(configPath)).toThrow(
      /Failed to read Claude Desktop config/,
    )
  })

  it('rejects invalid mcpServers shapes', () => {
    const invalidConfig = JSON.parse('{"mcpServers":[]}')
    expect(() => ensureClaudeServers(invalidConfig)).toThrow(
      /"mcpServers" must be an object/,
    )
  })

  it('defaults HTTP install URL to proxy port when graft.proxy.yaml exists', () => {
    writeFileSync(join(tempDir, 'graft.proxy.yaml'), 'target: https://api.example.com\ntools: []\n')
    process.chdir(tempDir)

    expect(buildClaudeServerConfig({})).toEqual({
      url: 'http://localhost:3001/mcp',
    })
  })
})
