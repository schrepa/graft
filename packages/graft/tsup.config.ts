import { defineConfig } from 'tsup'

const external = [
  '@modelcontextprotocol/sdk',
  /^@modelcontextprotocol\/sdk\//,
  'commander',
  'yaml',
  'tsx',
  /^tsx\//,
]

const outExtension = ({ format }: { format: 'cjs' | 'esm' }) => ({
  js: format === 'esm' ? '.mjs' : '.cjs',
})

export default [
  defineConfig({
    entry: {
      index: 'src/index.ts',
      openapi: 'src/openapi.ts',
      server: 'src/server.ts',
      testing: 'src/testing.ts',
    },
    format: ['cjs', 'esm'],
    dts: true,
    clean: true,
    external,
    outExtension,
  }),
  defineConfig({
    entry: {
      cli: 'src/cli.ts',
    },
    format: ['esm'],
    dts: false,
    clean: false,
    external,
    outExtension,
  }),
]
