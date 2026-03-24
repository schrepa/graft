/** Auth requirement for a tool.
 *  - `true`                 — login required, any role
 *  - `['admin']`            — login required, admin only (string[] shorthand)
 *  - `{ roles: ['admin'] }` — same, explicit form
 *  - `false` / omitted      — public */
export interface ToolAuthConfig {
  roles?: readonly string[]
}

/** Auth requirement accepted by tools and resources. */
export type ToolAuth = boolean | readonly string[] | ToolAuthConfig

/** Result of the authenticate hook.
 *  Extensible via module augmentation or generic inference from `authenticate`. */
export interface AuthResult {
  /** User or service identifier */
  subject: string
  /** Roles/scopes the subject has */
  roles?: string[]
}

/** Tool definition metadata — available to middleware at runtime via ctx.meta.tool */
export interface ToolMeta {
  kind: 'tool' | 'resource'
  name: string
  tags: string[]
  auth?: ToolAuth
  sideEffects: boolean
}
