// Types the names that expressions use: locals, the module's functions, the names it imports and
// the builtins, in that order.
import type { Expression, Identifier } from '../syntax/ast.ts'
import { CompileError } from '../errors.ts'
import type { CheckerLocal } from './expression_checker.ts'
import type { Functions } from './functions.ts'
import type { GenericFunction } from './generics.ts'
import type { Export, Imports } from './imports.ts'
import type { ObjectTypes } from './object_types.ts'
import type { Scopes } from '../scopes.ts'
import type { Shared } from './shared.ts'
import type { TopLevelValues } from './top_level_values.ts'
import type { Type } from '../types.ts'

export class NameChecker {
  private readonly scopes: Scopes<CheckerLocal>
  private readonly functions: Functions
  private readonly objects: ObjectTypes
  private readonly imports: Imports
  private readonly top_level: TopLevelValues | undefined

  // `top_level` is given to the checker of a function or a method, which sees the top-level values.
  constructor(shared: Shared, scopes: Scopes<CheckerLocal>, top_level: TopLevelValues | undefined) {
    this.scopes = scopes
    this.functions = shared.functions
    this.objects = shared.objects
    this.imports = shared.imports
    this.top_level = top_level
  }

  // A builtin or a standard module's function can only be called so far, not used as a value.
  type_of_identifier(identifier: Identifier, is_callee = false): Type {
    const local = this.scopes.lookup(identifier.name)
    if (local !== undefined) {
      ;(local.origin ?? local).used = true
      return local.type
    }
    const function_type = this.functions.type_of(identifier.name, identifier)
    if (function_type !== undefined) return function_type
    if (this.functions.generic(identifier.name) !== undefined) throw only_called(identifier)
    if (this.objects.object_type(identifier.name) !== undefined) {
      const message = `'${identifier.name}' is a type; construct it as ${identifier.name}(...)`
      throw new CompileError(message, identifier.line, identifier.column)
    }
    const imported = this.imports.use(identifier.name)
    if (imported !== undefined) return type_of_export(imported.export, identifier, is_callee)
    const pending = this.top_level?.pending_error(identifier)
    if (pending !== undefined) throw pending
    const builtin = this.imports.builtin(identifier.name)
    if (builtin === undefined) {
      const message = `undefined name '${identifier.name}'`
      throw new CompileError(message, identifier.line, identifier.column)
    }
    return type_of_export(builtin, identifier, is_callee)
  }

  // The generic function that the callee names: one of the module, an imported one or a builtin,
  // unless a local or another name of the module takes the name.
  generic_callee(callee: Expression): GenericFunction | undefined {
    if (callee.kind !== 'identifier') return undefined
    const { name } = callee
    if (this.scopes.lookup(name) !== undefined || this.top_level?.has(name)) return undefined
    if (this.functions.has(name)) return this.functions.generic(name)
    const export_ = this.imports.get(name)?.export ?? this.imports.builtin(name)
    if (export_?.kind !== 'generic_function') return undefined
    this.imports.use(name)
    return export_.generic
  }
}

// A generic function is called through generic_callee, so here it is used as a value.
const type_of_export = (export_: Export, identifier: Identifier, is_callee: boolean): Type => {
  switch (export_.kind) {
    case 'type':
      throw new CompileError(`'${identifier.name}' is a type`, identifier.line, identifier.column)
    case 'generic_function':
      throw only_called(identifier)
    case 'function':
      if (!is_callee) throw only_called(identifier)
      return export_.type
    default:
      return export_.type
  }
}

const only_called = (identifier: Identifier): CompileError => {
  const message = `'${identifier.name}' can only be called so far, not used as a value`
  return new CompileError(message, identifier.line, identifier.column)
}
