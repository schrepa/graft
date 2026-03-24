#!/usr/bin/env node
import { main, reportCliError } from './cli-main.js'

void main(process.argv.slice(2)).then((code) => {
  process.exitCode = code
}).catch((error) => {
  process.exitCode = reportCliError(error)
})
