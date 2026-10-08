import { dirname, join } from 'node:path'

// The module a diagnostic is in: an imported module by its path, relative to the directory of the
// entry module, or the name of a standard module, `std:io`; or the entry module, whose path is
// given when the diagnostic is formatted.
export const ENTRY_MODULE = Symbol('the entry module')
export type ModulePath = string | typeof ENTRY_MODULE

// The module path of a module whose display path is `display_path` (see Module).
export const module_path_of = (display_path: string | undefined): ModulePath =>
  display_path ?? ENTRY_MODULE

// A diagnostic whose module is not set is in the entry module.
const location = (entry_path: string, diagnostic: CompileWarning | CompileError): string => {
  const module_path = diagnostic.module_path ?? ENTRY_MODULE
  const path =
    module_path === ENTRY_MODULE
      ? entry_path
      : module_path.startsWith('std:')
        ? module_path
        : join(dirname(entry_path), module_path)
  return `${path}:${diagnostic.line}:${diagnostic.column}`
}

// Reported without stopping the compilation.
export class CompileWarning {
  readonly message: string
  readonly line: number
  readonly column: number
  module_path: ModulePath | undefined

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
  module_path: ModulePath | undefined
  // Warnings found before the error, to be reported along with it.
  warnings: CompileWarning[] = []
  // What was being checked where the error was found, such as `in print<Int>`: the innermost of
  // what adds it.
  context: string | undefined

  constructor(message: string, line: number, column: number) {
    super(message)
    this.line = line
    this.column = column
  }

  add_context(context: string): void {
    this.context ??= context
  }

  format(entry_path: string): string {
    const context = this.context === undefined ? '' : ` (${this.context})`
    return `${location(entry_path, this)}: ${this.message}${context}`
  }
}
