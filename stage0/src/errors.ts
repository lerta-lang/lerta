import { dirname, join } from 'node:path'

// A diagnostic in an imported module carries the module's path, relative to the directory of the
// entry module; otherwise it is in the entry module, whose path is given when it is formatted.
const location = (entry_path: string, diagnostic: CompileWarning | CompileError): string => {
  const path =
    diagnostic.module_path === undefined
      ? entry_path
      : join(dirname(entry_path), diagnostic.module_path)
  return `${path}:${diagnostic.line}:${diagnostic.column}`
}

// Reported without stopping the compilation.
export class CompileWarning {
  readonly message: string
  readonly line: number
  readonly column: number
  module_path: string | undefined

  constructor(message: string, line: number, column: number) {
    this.message = message
    this.line = line
    this.column = column
  }

  format(entry_path: string): string {
    return `${location(entry_path, this)}: warning: ${this.message}`
  }
}

export class CompileError extends Error {
  readonly line: number
  readonly column: number
  module_path: string | undefined
  // Warnings found before the error, to be reported along with it.
  warnings: CompileWarning[] = []

  constructor(message: string, line: number, column: number) {
    super(message)
    this.line = line
    this.column = column
  }

  format(entry_path: string): string {
    return `${location(entry_path, this)}: ${this.message}`
  }
}
