import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { bin: 'src/bin.ts' },
  format: ['esm'],
  dts: false,
  clean: true,
  outExtension() {
    return { js: '.mjs' }
  },
  banner: {
    js: '#!/usr/bin/env node',
  },
})
