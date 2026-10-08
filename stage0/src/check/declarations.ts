// Declares the module's names, which its code may use before their declarations, and puts the
// extends in effect.
import {
  is_function_declaration,
  is_generic,
  type Import,
  type Program,
  type TypeDeclaration,
} from '../syntax/ast.ts'
import { make_generic_function } from './bodies.ts'
import type { Checked } from './checker.ts'
import { CompileError } from '../errors.ts'
import { declare_extend, type MakeGenericMethod } from './extend_declarations.ts'
import { declare_externs } from './externs.ts'
import type { Imports } from './imports.ts'
import type { Module } from '../loader.ts'
import type { Shared } from './shared.ts'

// The module's types, aliases, imports, functions and members, which the code may use before
// their declarations.
export const declare_names = (program: Program, shared: Shared): void => {
  const { objects, resolver, imports, functions } = shared
  objects.add(
    program.filter(
      (statement): statement is TypeDeclaration => statement.kind === 'type_declaration',
    ),
  )
  for (const statement of program) {
    if (statement.kind === 'type_alias') resolver.add_alias(statement)
  }
  imports.add(program)
  resolver.resolve_aliases()
  declare_externs(program, shared)
  reject_types_named_like_imports(program, imports)
  add_top_level_functions(program, shared)
  objects.add_members(resolver, functions)
}

// The extends in effect in the module: those of the modules it imports, then its own, once the
// types they extend are complete.
export const declare_extends = (
  module: Module,
  imported: (statement: Import) => Checked,
  shared: Shared,
): void => {
  const { extensions, resolver, objects, functions } = shared
  for (const statement of module.program) {
    if (statement.kind !== 'import') continue
    extensions.add_imported(imported(statement).extensions.own, statement)
  }
  const make_generic: MakeGenericMethod = (name, literal, receiver) =>
    make_generic_function(shared, name, literal, receiver)
  for (const statement of module.program) {
    if (statement.kind === 'extend') {
      declare_extend(statement, extensions, resolver, objects, functions, make_generic)
    }
  }
}

// A class, struct or type alias cannot have the name of an import; the error points at it.
const reject_types_named_like_imports = (program: Program, imports: Imports): void => {
  for (const statement of program) {
    if (statement.kind !== 'type_declaration' && statement.kind !== 'type_alias') continue
    const { name } = statement
    if (imports.has(name.name)) {
      throw new CompileError(`'${name.name}' is already defined`, name.line, name.column)
    }
  }
}

const add_top_level_functions = (program: Program, shared: Shared): void => {
  const { functions, objects, resolver, imports } = shared
  for (const statement of program.filter(is_function_declaration)) {
    if (statement.mutable) {
      const message = 'a function must be declared with const'
      throw new CompileError(message, statement.line, statement.column)
    }
    const { name } = statement
    const is_taken =
      objects.object_type(name.name) !== undefined ||
      resolver.has_alias(name.name) ||
      imports.has(name.name)
    if (is_taken) {
      throw new CompileError(`'${name.name}' is already defined`, name.line, name.column)
    }
    const literal = statement.value
    if (!is_generic(literal)) {
      functions.add(name.name, name, literal)
      continue
    }
    functions.add_generic(make_generic_function(shared, name, literal, undefined))
  }
}
