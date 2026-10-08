// The methods that `extend` statements give to types. Those of a module are in effect in it and in
// the modules that import it directly, so that a module sees only the extends it asks for.
import {
  is_generic,
  type Extend,
  type FunctionLiteral,
  type Identifier,
  type Import,
  type TypeParameter,
} from '../syntax/ast.ts'
import { builtin_method, builtin_property } from './builtins.ts'
import { CompileError } from '../errors.ts'
import { method_key, type Functions } from './functions.ts'
import {
  matches,
  overlaps,
  parts_of,
  type_parameter,
  type GenericFunction,
  type Receiver,
} from './generics.ts'
import { is_method, type ObjectTypes } from './object_types.ts'
import type { TypeResolver } from './type_names.ts'
import { format_type, type Type } from '../types.ts'

// The receiver of a generic extend, `Array<T>`, has type parameters, which stand for any type.
export type ExtensionMethod = {
  receiver: Type
  name: Identifier
  literal: FunctionLiteral
  // The declaring module: its index, and how messages name it.
  module_index: number
  module_name: string
} & (PlainMethod | GenericMethod)

// The declaring module's functions hold the method's type by `key`.
type PlainMethod = { generic: undefined; functions: Functions; key: string }

// A method of a generic extend, or one with type parameters of its own, has instances.
type GenericMethod = { generic: GenericFunction }

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

export class Extensions {
  private readonly in_effect: ExtensionMethod[] = []
  // The module's own, which the modules that import it get.
  readonly own: ExtensionMethod[] = []
  private readonly module_index: number
  private readonly module_name: string

  constructor(module_index: number, module_name: string) {
    this.module_index = module_index
    this.module_name = module_name
  }

  // The methods of the module that `statement` imports; a module imported twice brings them once.
  // A conflict between two imported modules is the importer's, so it is reported at its import.
  add_imported(methods: ExtensionMethod[], statement: Import): void {
    for (const method of methods) {
      if (this.in_effect.includes(method)) continue
      const { receiver, name } = method
      const other = this.overlapping(receiver, name.name)
      if (other !== undefined) {
        const message = `${format_type(receiver)} gets a method '${name.name}' from extends in both ${other.module_name} and ${method.module_name}`
        throw new CompileError(message, statement.line, statement.column)
      }
      this.in_effect.push(method)
    }
  }

  // Adds the methods to `functions`, which check their bodies with `@` as the receiver, or makes
  // them generic methods, whose instances are checked so.
  declare(
    statement: Extend,
    resolver: TypeResolver,
    objects: ObjectTypes,
    functions: Functions,
    make_generic: MakeGenericMethod,
  ): void {
    const { type_params } = statement
    reject_bounds(type_params)
    const placeholders = new Map(
      type_params.map(({ name }): [string, Type] => [name.name, type_parameter(name.name)]),
    )
    const receiver = resolver.with_type_parameters(placeholders).resolve(statement.type)
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
      const method = this.method(extended, name, literal, functions, make_generic)
      const other = this.overlapping(receiver, name.name)
      if (other !== undefined) {
        const where =
          other.module_index === this.module_index ? 'the same module' : other.module_name
        const message = `${format_type(receiver)} already has a method '${name.name}', from an extend in ${where}`
        throw new CompileError(message, name.line, name.column)
      }
      this.in_effect.push(method)
      this.own.push(method)
      if (method.generic === undefined) functions.add(method.key, name, literal, receiver)
    }
  }

  // A method of an extend of the receiver: generic if the extend or the method has type parameters.
  private method(
    receiver: Receiver,
    name: Identifier,
    literal: FunctionLiteral,
    functions: Functions,
    make_generic: MakeGenericMethod,
  ): ExtensionMethod {
    const { type } = receiver
    const { module_index, module_name } = this
    const declared = { receiver: type, name, literal, module_index, module_name }
    if (receiver.type_params.length > 0 || is_generic(literal)) {
      return { ...declared, generic: make_generic(name, literal, receiver) }
    }
    const key = method_key(format_type(type), name.name)
    return { ...declared, generic: undefined, functions, key }
  }

  // The extends in effect here, with `methods` before them, as an instance of a generic function
  // sees them (see GenericFunction).
  with_methods(methods: ExtensionMethod[]): Extensions {
    const extensions = new Extensions(this.module_index, this.module_name)
    const others = this.in_effect.filter((method) => !methods.includes(method))
    extensions.in_effect.push(...methods, ...others)
    return extensions
  }

  // The methods that extends in effect give the type.
  methods_of(receiver: Type): ExtensionMethod[] {
    return this.in_effect.filter((method) => matches(method.receiver, receiver))
  }

  find(receiver: Type, name: string): ExtensionMethod | undefined {
    return this.in_effect.find(
      (method) => method.name.name === name && matches(method.receiver, receiver),
    )
  }

  // A method of the name that an extend in effect gives some type that `receiver`, a pattern, also
  // matches, which another extend cannot give it too.
  private overlapping(receiver: Type, name: string): ExtensionMethod | undefined {
    return this.in_effect.find(
      (method) => method.name.name === name && overlaps(method.receiver, receiver),
    )
  }

  // The type of the method `name` of the receiver, checking its body first if needed, unless it is
  // generic, which only a call can give the type arguments of.
  method_type(receiver: Type, name: Identifier): Type | undefined {
    const method = this.find(receiver, name.name)
    if (method?.generic !== undefined) return undefined
    return method?.functions.type_of(method.key, name)
  }

  // The generic methods that the module's own extends give, whose instances it generates.
  own_generics(): GenericFunction[] {
    return this.own.flatMap((method) => (method.generic === undefined ? [] : [method.generic]))
  }
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
