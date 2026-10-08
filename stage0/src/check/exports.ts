// What a module exports, for the modules that import it, besides its extends.
import { is_function_declaration } from '../syntax/ast.ts'
import type { Export, Imports } from './imports.ts'
import type { Functions } from './functions.ts'
import type { Module } from '../loader.ts'
import type { ObjectTypes } from './object_types.ts'
import type { Types } from './shared.ts'
import type { TypeResolver } from './type_names.ts'

export const exports_of_module = (
  module: Module,
  functions: Functions,
  objects: ObjectTypes,
  resolver: TypeResolver,
  types: Types,
  imports: Imports,
): Map<string, Export> => {
  const exports = new Map<string, Export>()
  for (const statement of module.program) {
    if (!('exported' in statement && statement.exported)) continue
    const { name } = statement
    const generic = functions.generic(name.name)
    if (generic !== undefined) {
      exports.set(name.name, { kind: 'generic_function', generic })
    } else if (is_function_declaration(statement)) {
      const type = functions.type_of(name.name, name)!
      exports.set(name.name, {
        kind: 'lerta_function',
        type,
        module_index: module.index,
        name: name.name,
      })
    } else if (statement.kind === 'declaration') {
      const type = types.get(name)!
      exports.set(name.name, {
        kind: 'lerta_value',
        type,
        module_index: module.index,
        name: name.name,
      })
    } else if (statement.kind === 'extern') {
      exports.set(name.name, imports.get(name.name)!.export)
    } else if (statement.kind === 'type_declaration') {
      const type = objects.object_type(name.name)!
      exports.set(name.name, { kind: 'type', type, info: objects.info(type) })
    } else {
      exports.set(name.name, { kind: 'type', type: resolver.alias_type(name), info: undefined })
    }
  }
  return exports
}
