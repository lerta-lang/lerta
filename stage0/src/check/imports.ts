// The names a module imports from other modules, the C functions it declares as externs, and what
// it exports for the modules that import it.
import {
  is_function_declaration,
  type Identifier,
  type Import,
  type Program,
} from '../syntax/ast.ts'
import { CompileError, CompileWarning } from '../errors.ts'
import type { CheckerLocal } from './expression_checker.ts'
import type { Functions } from './functions.ts'
import type { GenericFunction } from './generics.ts'
import { builtins_module, type Module } from '../loader.ts'
import type { ObjectInfo } from './object_types.ts'
import type { Shared } from './shared.ts'
import type { Type } from '../types.ts'

// What a module exports under a name: a C function, by its symbol (see Extern), a function or a
// `const` of another module (by its index and its name there), a generic function, or a type (a
// class or struct, which brings its info, or an alias). A function's type is asked of the
// exporter's functions, as it may need its body checked. A value's type is undefined until the
// exporter's top-level code is checked.
export type Export =
  | { kind: 'function'; type: Type; symbol: string }
  | { kind: 'lerta_function'; functions: Functions; module_index: number; name: string }
  | { kind: 'generic_function'; generic: GenericFunction }
  | { kind: 'lerta_value'; type: Type | undefined; module_index: number; name: string }
  | { kind: 'type'; type: Type; info: ObjectInfo | undefined }

// What a module exports, besides its extends. The names are known from the syntax, so that the
// modules of an import cycle can import each other's before any is checked; an export itself is
// worked out when it is asked for.
export class ModuleExports {
  private readonly names: Set<string>
  private readonly export_of: (name: string) => Export

  constructor(names: Set<string>, export_of: (name: string) => Export) {
    this.names = names
    this.export_of = export_of
  }

  get(name: string): Export | undefined {
    return this.names.has(name) ? this.export_of(name) : undefined
  }

  has(name: string): boolean {
    return this.names.has(name)
  }
}

// `name` is the name the module knows it by: its alias, if it has one; `module` is the imported
// module as the import names it.
export type ImportedName = {
  name: Identifier
  readonly export: Export
  used: boolean
  module: string
}

export class Imports {
  private readonly names = new Map<string, ImportedName>()
  // What std:builtins exports, such as `print`, which the module has without naming it in an
  // import; its own names shadow them.
  private builtins: ModuleExports | undefined
  // The exports of the module that an import names.
  private readonly exports_of: (statement: Import) => ModuleExports

  constructor(exports_of: (statement: Import) => ModuleExports) {
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
      if (!exports.has(name.name)) {
        const message = `'${statement.module}' has no export '${name.name}'`
        throw new CompileError(message, name.line, name.column)
      }
      const local = alias ?? name
      if (this.names.has(local.name)) {
        throw new CompileError(`'${local.name}' is already defined`, local.line, local.column)
      }
      const imported: ImportedName = {
        name: local,
        get export() {
          return exports.get(name.name)!
        },
        used: false,
        module: statement.module,
      }
      this.names.set(local.name, imported)
    }
  }

  // A C function the module declares, which it calls as it calls those it imports from standard
  // modules; it is never warned about as unused.
  add_extern(name: Identifier, type: Type, symbol: string): void {
    if (this.names.has(name.name)) {
      throw new CompileError(`'${name.name}' is already defined`, name.line, name.column)
    }
    const export_: Export = { kind: 'function', type, symbol }
    this.names.set(name.name, { name, export: export_, used: true, module: builtins_module })
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
  // and narrowed as one; using it marks the import as used. One whose type is not known yet is
  // left to type_of_export, which reports it where it is used.
  value_local(name: string): CheckerLocal | undefined {
    const imported = this.names.get(name)
    if (imported === undefined) return undefined
    const export_ = imported.export
    if (export_.kind !== 'lerta_value' || export_.type === undefined) return undefined
    imported.used = true
    const { type } = export_
    return { identifier: imported.name, type, mutable: false, declared: false, used: true }
  }

  get(name: string): ImportedName | undefined {
    return this.names.get(name)
  }

  builtin(name: string): Export | undefined {
    return this.builtins?.get(name)
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

type ExportableStatement = Extract<Program[number], { exported: boolean }>

// What the module exports, besides its extends.
export const exports_of_module = (module: Module, shared: Shared): ModuleExports => {
  const { functions, objects, resolver, types, imports } = shared
  const exported = new Map<string, ExportableStatement>()
  for (const statement of module.program) {
    if ('exported' in statement && statement.exported) exported.set(statement.name.name, statement)
  }
  const export_of = (name: string): Export => {
    const statement = exported.get(name)!
    const generic = functions.generic(name)
    if (generic !== undefined) return { kind: 'generic_function', generic }
    if (is_function_declaration(statement)) {
      return { kind: 'lerta_function', functions, module_index: module.index, name }
    }
    if (statement.kind === 'declaration') {
      const type = types.get(statement.name)
      return { kind: 'lerta_value', type, module_index: module.index, name }
    }
    if (statement.kind === 'extern') return imports.get(name)!.export
    if (statement.kind === 'type_declaration') {
      const type = objects.object_type(name)!
      return { kind: 'type', type, info: objects.info(type) }
    }
    return { kind: 'type', type: resolver.alias_type(statement.name), info: undefined }
  }
  return new ModuleExports(new Set(exported.keys()), export_of)
}
