#!/usr/bin/env node

import { reportCliError, runCli } from './cli.js'

void runCli(process.argv.slice(2)).then((code) => {
  process.exitCode = code
}).catch((error) => {
  process.exitCode = reportCliError(error)
})
