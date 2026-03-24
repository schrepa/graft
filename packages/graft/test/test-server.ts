import { createServer, type Server } from 'node:http'

export function getBoundPort(server: Server): number {
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Expected a TCP server address')
  }

  return address.port
}

export function loopbackUrl(port: number, path = ''): string {
  return `http://127.0.0.1:${port}${path}`
}

export function listenOnLoopback(server: Server, port = 0): Promise<number> {
  return new Promise((resolve, reject) => {
    const handleListening = () => {
      server.off('error', handleError)
      try {
        resolve(getBoundPort(server))
      } catch (error) {
        reject(error)
      }
    }

    const handleError = (error: Error) => {
      server.off('listening', handleListening)
      reject(error)
    }

    server.once('listening', handleListening)
    server.once('error', handleError)
    server.listen(port, '127.0.0.1')
  })
}

let canListenPromise: Promise<boolean> | undefined

export function canListenOnLoopback(): Promise<boolean> {
  if (!canListenPromise) {
    canListenPromise = (async () => {
      const server = createServer()
      try {
        await listenOnLoopback(server)
        return true
      } catch (error) {
        if (isListenPermissionError(error)) {
          return false
        }
        throw error
      } finally {
        if (server.listening) {
          await new Promise<void>((resolve, reject) => {
            server.close((error) => error ? reject(error) : resolve())
          })
        }
      }
    })()
  }

  return canListenPromise
}

export function isListenPermissionError(error: unknown): boolean {
  return error instanceof Error && (
    error.message.includes('EPERM')
    || error.message.includes('EACCES')
  )
}
