import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(packageRoot, '..', '..')

function readRepoFile(...segments: string[]): string {
  return readFileSync(join(repoRoot, ...segments), 'utf8')
}

describe('root README contract', () => {
  it('uses current tool registration examples', () => {
    const readme = readRepoFile('README.md')

    expect(readme).not.toContain('app.tool({')
    expect(readme).toContain("import { createApp, z } from '@schrepa/graft'")
    expect(readme).toContain('npx @schrepa/create-graft-app my-app')
    expect(readme).toContain('npx @schrepa/graft serve --openapi ./openapi.yaml --target http://localhost:8000')
    expect(readme).toContain("app.tool('list_items', {")
    expect(readme).toContain('app.tool(listItemsTool)')
    expect(readme).toContain('graft test')
    expect(readme).toContain('graft dev')
  })
})

describe('graft skill contract', () => {
  const skillFolderName = 'graft'
  const skillRoot = join(repoRoot, 'skills', skillFolderName)

  it('ships the expected skill layout', () => {
    expect(existsSync(join(skillRoot, 'SKILL.md'))).toBe(true)
    expect(existsSync(join(skillRoot, 'agents', 'openai.yaml'))).toBe(true)
    expect(existsSync(join(skillRoot, 'references', 'app-authoring.md'))).toBe(true)
    expect(existsSync(join(skillRoot, 'references', 'proxy-openapi.md'))).toBe(true)
    expect(existsSync(join(skillRoot, 'references', 'validation-release.md'))).toBe(true)
  })

  it('has consistent naming across folder, SKILL.md, and openai.yaml', () => {
    const skill = readRepoFile('skills', skillFolderName, 'SKILL.md')
    const openaiYaml = readRepoFile('skills', skillFolderName, 'agents', 'openai.yaml')

    // SKILL.md name: field must match the folder name
    const nameMatch = skill.match(/^name:\s*(.+)$/m)
    expect(nameMatch, 'SKILL.md must have a name: field').toBeTruthy()
    expect(nameMatch![1].trim()).toBe(skillFolderName)

    // openai.yaml $invocation must reference the same name
    expect(openaiYaml).toContain(`$${skillFolderName}`)
  })

  it('avoids stale API and transport claims', () => {
    const skill = readRepoFile('skills', skillFolderName, 'SKILL.md')

    expect(skill).not.toContain('auth: { required: true')
    expect(skill).not.toContain('POST/GET/DELETE /mcp')
    expect(skill).not.toContain('server.json')
    expect(skill).not.toContain('mcpName')
    expect(skill).toContain('[references/app-authoring.md]')
    expect(skill).toContain('[references/proxy-openapi.md]')
    expect(skill).toContain('[references/validation-release.md]')
  })

  it('provides OpenAI skill metadata aligned with the current skill', () => {
    const openaiYaml = readRepoFile('skills', skillFolderName, 'agents', 'openai.yaml')

    expect(openaiYaml).toContain('display_name: "Graft"')
    expect(openaiYaml).toContain('short_description: "Build and refine Graft apps and proxies"')
  })

  it('does not have a stale skill folder', () => {
    const skillsDir = join(repoRoot, 'skills')
    if (!existsSync(skillsDir)) return

    const folders = readdirSync(skillsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)

    // Only the canonical skill folder should exist
    expect(folders).toContain(skillFolderName)
    expect(folders).not.toContain('graft-building-skill')
    expect(folders).not.toContain('graft-app-builder')
  })
})
