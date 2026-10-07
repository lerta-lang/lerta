// The names a module imports. So far only the standard modules can be imported.
import type { Identifier, Import, Program } from './ast.ts'
import { CompileError, CompileWarning } from './errors.ts'
import { std_modules, type StdExport } from './std_modules.ts'

export type ImportedName = { name: Identifier; export: StdExport; used: boolean }

export class Imports {
  private readonly names = new Map<string, ImportedName>()

  // `is_taken` tells whether a top-level name is already used by a function or a type.
  add(program: Program, is_taken: (name: string) => boolean): void {
    for (const statement of program) {
      if (statement.kind === 'import') this.add_import(statement, is_taken)
    }
  }

  private add_import(statement: Import, is_taken: (name: string) => boolean): void {
    const module = std_modules.get(statement.module)
    if (module === undefined) {
      const message = `unknown module '${statement.module}'; only the standard modules can be imported so far`
      throw new CompileError(message, statement.line, statement.column)
    }
    for (const name of statement.names) {
      const export_ = module.get(name.name)
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
