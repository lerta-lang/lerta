// The names a module imports, from the standard modules or from other files.
import type { Identifier, Import, Program } from './ast.ts'
import { CompileError, CompileWarning } from './errors.ts'
import type { ObjectInfo } from './object_types.ts'
import type { StdExport } from './std_modules.ts'
import type { Type } from './types.ts'

// What a module exports under a name: a standard function or value, a function of another file,
// or a type (a class or struct, which brings its info, or an alias).
export type Export =
  | StdExport
  | { kind: 'lerta_function'; type: Type; symbol: string }
  | { kind: 'type'; type: Type; info: ObjectInfo | undefined }

export type ImportedName = { name: Identifier; export: Export; used: boolean }

export class Imports {
  private readonly names = new Map<string, ImportedName>()
  // The exports of the module that an import names, if there is such a module.
  private readonly exports_of: (statement: Import) => Map<string, Export> | undefined

  constructor(exports_of: (statement: Import) => Map<string, Export> | undefined) {
    this.exports_of = exports_of
  }

  // `is_taken` tells whether a top-level name is already used by a type.
  add(program: Program, is_taken: (name: string) => boolean): void {
    for (const statement of program) {
      if (statement.kind === 'import') this.add_import(statement, is_taken)
    }
  }

  private add_import(statement: Import, is_taken: (name: string) => boolean): void {
    const exports = this.exports_of(statement)
    if (exports === undefined) {
      const hint = statement.module.startsWith('std:')
        ? 'the standard modules are std:io and std:process'
        : 'a file is imported by a path that starts with ./ or ../'
      const message = `unknown module '${statement.module}'; ${hint}`
      throw new CompileError(message, statement.line, statement.column)
    }
    for (const name of statement.names) {
      const export_ = exports.get(name.name)
      if (export_ === undefined) {
        const message = `'${statement.module}' has no export '${name.name}'`
        throw new CompileError(message, name.line, name.column)
      }
      if (this.names.has(name.name) || is_taken(name.name)) {
        throw new CompileError(`'${name.name}' is already defined`, name.line, name.column)
      }
      this.names.set(name.name, { name, export: export_, used: false })
    }
  }

  has(name: string): boolean {
    return this.names.has(name)
  }

  all(): ImportedName[] {
    return [...this.names.values()]
  }

  // The imported name, marked as used.
  use(name: string): ImportedName | undefined {
    const imported = this.names.get(name)
    if (imported !== undefined) imported.used = true
    return imported
  }

  get(name: string): ImportedName | undefined {
    return this.names.get(name)
  }

  unused_warnings(): CompileWarning[] {
    return [...this.names.values()]
      .filter((imported) => !imported.used)
      .map(
        ({ name }) =>
          new CompileWarning(`'${name.name}' is imported but never used`, name.line, name.column),
      )
  }
}
