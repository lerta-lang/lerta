// The names a module imports from other modules, and the C functions it declares as externs.
import type { Identifier, Import, Program } from '../syntax/ast.ts'
import { CompileError, CompileWarning } from '../errors.ts'
import type { CheckerLocal } from './expression_checker.ts'
import type { GenericFunction } from './generics.ts'
import { builtins_module } from '../loader.ts'
import type { ObjectInfo } from './object_types.ts'
import type { Type } from '../types.ts'

// What a module exports under a name: a C function, by its symbol (see Extern), a function or a
// `const` of another module (by its index and its name there), a generic function, or a type (a
// class or struct, which brings its info, or an alias).
export type Export =
  | { kind: 'function'; type: Type; symbol: string }
  | { kind: 'lerta_function'; type: Type; module_index: number; name: string }
  | { kind: 'generic_function'; generic: GenericFunction }
  | { kind: 'lerta_value'; type: Type; module_index: number; name: string }
  | { kind: 'type'; type: Type; info: ObjectInfo | undefined }

// `name` is the name the module knows it by: its alias, if it has one.
export type ImportedName = { name: Identifier; export: Export; used: boolean }

export class Imports {
  private readonly names = new Map<string, ImportedName>()
  // What std:builtins exports, such as `print`, which the module has without naming it in an
  // import; its own names shadow them.
  private builtins = new Map<string, Export>()
  // The exports of the module that an import names.
  private readonly exports_of: (statement: Import) => Map<string, Export>

  constructor(exports_of: (statement: Import) => Map<string, Export>) {
    this.exports_of = exports_of
  }

  // The module's own names that clash with imports are rejected as they are declared.
  add(program: Program): void {
    for (const statement of program) {
      if (statement.kind !== 'import') continue
      if (statement.module === builtins_module) this.builtins = this.exports_of(statement)
      this.add_import(statement)
    }
  }

  private add_import(statement: Import): void {
    const exports = this.exports_of(statement)
    for (const { name, alias } of statement.names) {
      const export_ = exports.get(name.name)
      if (export_ === undefined) {
        const message = `'${statement.module}' has no export '${name.name}'`
        throw new CompileError(message, name.line, name.column)
      }
      const local = alias ?? name
      if (this.names.has(local.name)) {
        throw new CompileError(`'${local.name}' is already defined`, local.line, local.column)
      }
      this.names.set(local.name, { name: local, export: export_, used: false })
    }
  }

  // A C function the module declares, which it calls as it calls those it imports from standard
  // modules; it is never warned about as unused.
  add_extern(name: Identifier, type: Type, symbol: string): void {
    if (this.names.has(name.name)) {
      throw new CompileError(`'${name.name}' is already defined`, name.line, name.column)
    }
    this.names.set(name.name, { name, export: { kind: 'function', type, symbol }, used: true })
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

  // An imported `const` of another file as a local that cannot be assigned, so that it is read
  // and narrowed as one; using it marks the import as used.
  value_local(name: string): CheckerLocal | undefined {
    const imported = this.names.get(name)
    if (imported?.export.kind !== 'lerta_value') return undefined
    imported.used = true
    const { type } = imported.export
    return { identifier: imported.name, type, mutable: false, declared: false, used: true }
  }

  get(name: string): ImportedName | undefined {
    return this.names.get(name)
  }

  builtin(name: string): Export | undefined {
    return this.builtins.get(name)
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
