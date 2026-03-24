import type { IncomingMessage } from 'node:http'
import type { AuthResult } from '../types.js'
import { buildRequestHead } from '../server/web-bridge.js'
import type { App } from './builder.js'

/**
 * Authenticate a Node.js `IncomingMessage` by first converting it into a web `Request`.
 *
 * @param app Graft app whose `authenticate` hook should be invoked.
 * @param request Node.js request object from an upgrade handler or custom server.
 * @returns The auth result produced by `app.authenticate()`.
 * @throws {GraftError} When the app has no authenticate hook or authentication fails.
 */
export async function authenticateNodeRequest<TAuth extends AuthResult>(
  app: App<TAuth>,
  request: IncomingMessage,
): Promise<TAuth> {
  return app.authenticate(buildRequestHead(request))
}
