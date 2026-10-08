// `extend` statements: which types they may extend, and with what methods.
import {
  is_generic,
  type Extend,
  type FunctionLiteral,
  type Identifier,
  type TypeParameter,
} from '../syntax/ast.ts'
import { builtin_method, builtin_property } from './builtins.ts'
import { CompileError } from '../errors.ts'
import type { ExtensionMethod, Extensions } from './extensions.ts'
import { method_key, type Functions } from './functions.ts'
import type { GenericFunction, Receiver } from './generics.ts'
import { is_method, type ObjectTypes } from './object_types.ts'
import type { TypeResolver } from './type_names.ts'
import { parts_of, placeholders } from './type_patterns.ts'
import { format_type, type Type } from '../types.ts'

// Makes a generic method of an extend (see GenericFunction).
export type MakeGenericMethod = (
  name: Identifier,
  literal: FunctionLiteral,
  receiver: Receiver,
) => GenericFunction

// Optional values, functions, unions and anonymous structs are left out.
const extendable_kinds: Type['kind'][] = [
  'String',
  'Int',
  'Bool',
  'UInt8',
  'Binary',
  'Array',
  'Map',
  'Iter',
  'Object',
]

// Puts the extend's methods in effect in the module, and adds them to `functions`, which check
// their bodies with `@` as the receiver, or makes them generic methods, whose instances are
// checked so.
export const declare_extend = (
  statement: Extend,
  extensions: Extensions,
  resolver: TypeResolver,
  objects: ObjectTypes,
  functions: Functions,
  make_generic: MakeGenericMethod,
): void => {
  const { type_params } = statement
  reject_bounds(type_params)
  const receiver = resolver.with_type_parameters(placeholders(type_params)).resolve(statement.type)
  if (!extendable_kinds.includes(receiver.kind)) {
    const message = `${format_type(receiver)} cannot be extended; only String, Int, Bool, UInt8, Binary, arrays, maps, Iters, classes and structs can be so far`
    throw new CompileError(message, statement.type.line, statement.type.column)
  }
  reject_unused_type_parameters(type_params, receiver)
  const extended: Receiver = { type: receiver, type_params }
  for (const member of statement.members) {
    const { name } = member
    if (!is_method(member)) {
      const message = 'an extend has only methods, as in `name = (x: Int) -> ...`'
      throw new CompileError(message, member.line, member.column)
    }
    if (name.name === 'init' || name.name === 'deinit') {
      const message = `an extend cannot declare ${name.name}, which only a class or struct runs`
      throw new CompileError(message, name.line, name.column)
    }
    if (has_member(receiver, name.name, objects)) {
      const message = `${format_type(receiver)} already has a member '${name.name}'`
      throw new CompileError(message, name.line, name.column)
    }
    const literal = member.value as FunctionLiteral
    const method = extension_method(extended, name, literal, extensions, functions, make_generic)
    extensions.add_own(method)
    if (method.generic === undefined) functions.add(method.key, name, literal, receiver)
  }
}

// A method of an extend of the receiver: generic if the extend or the method has type parameters.
const extension_method = (
  receiver: Receiver,
  name: Identifier,
  literal: FunctionLiteral,
  { module_index, module_name }: Extensions,
  functions: Functions,
  make_generic: MakeGenericMethod,
): ExtensionMethod => {
  const { type } = receiver
  const declared = { receiver: type, name, literal, module_index, module_name }
  if (receiver.type_params.length > 0 || is_generic(literal)) {
    return { ...declared, generic: make_generic(name, literal, receiver) }
  }
  const key = method_key(format_type(type), name.name)
  return { ...declared, generic: undefined, functions, key }
}

// The receiver gives an extend's type arguments, whose bounds would go unchecked.
const reject_bounds = (type_params: TypeParameter[]): void => {
  const bounded = type_params.find(({ bound }) => bound !== undefined)
  if (bounded === undefined) return
  const { line, column } = bounded.bound!
  throw new CompileError("an extend's type parameter takes no bound", line, column)
}

// Each type parameter of an extend must be in the extended type, which gives its type argument.
const reject_unused_type_parameters = (type_params: TypeParameter[], receiver: Type): void => {
  const used = new Set<string>()
  const visit = (type: Type) => {
    if (type.kind === 'TypeParameter') used.add(type.name)
    parts_of(type).forEach(visit)
  }
  visit(receiver)
  const unused = type_params.find(({ name }) => !used.has(name.name))
  if (unused === undefined) return
  const { name, line, column } = unused.name
  throw new CompileError(`'${name}' is not in the extended type`, line, column)
}

const has_member = (receiver: Type, name: string, objects: ObjectTypes): boolean => {
  if (receiver.kind !== 'Object') {
    return (
      builtin_method(receiver, name) !== undefined || builtin_property(receiver, name) !== undefined
    )
  }
  const info = objects.info(receiver)
  return info.methods.has(name) || info.fields.some((field) => field.name.name === name)
}
