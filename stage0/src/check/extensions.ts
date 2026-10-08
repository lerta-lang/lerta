// The methods that `extend` statements give to types. Those of a module are in effect in it and in
// the modules that import it directly, so that a module sees only the extends it asks for.
import type { Extend, FunctionLiteral, Identifier, Import } from '../syntax/ast.ts'
import { builtin_method, builtin_property } from './builtins.ts'
import { CompileError } from '../errors.ts'
import { method_key, type Functions } from './functions.ts'
import { is_method, type ObjectTypes } from './object_types.ts'
import type { TypeResolver } from './type_names.ts'
import { format_type, same_type, type Type } from '../types.ts'

export type ExtensionMethod = {
  receiver: Type
  name: Identifier
  literal: FunctionLiteral
  // The declaring module: its index, how messages name it, and its functions, which hold the
  // method's type by `key`.
  module_index: number
  module_name: string
  functions: Functions
  key: string
}

// Generic types are left out until a method can be generic over their type arguments.
const extendable_kinds: Type['kind'][] = ['String', 'Int', 'Bool', 'UInt8', 'Binary', 'Object']

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
      const other = this.find(receiver, name.name)
      if (other !== undefined) {
        const message = `${format_type(receiver)} gets a method '${name.name}' from extends in both ${other.module_name} and ${method.module_name}`
        throw new CompileError(message, statement.line, statement.column)
      }
      this.in_effect.push(method)
    }
  }

  // Adds the methods to `functions`, which check their bodies with `@` as the receiver.
  declare(
    statement: Extend,
    resolver: TypeResolver,
    objects: ObjectTypes,
    functions: Functions,
  ): void {
    const receiver = resolver.resolve(statement.type)
    if (!extendable_kinds.includes(receiver.kind)) {
      const message = `${format_type(receiver)} cannot be extended; only String, Int, Bool, UInt8, Binary, classes and structs can be so far`
      throw new CompileError(message, statement.type.line, statement.type.column)
    }
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
      const key = method_key(format_type(receiver), name.name)
      const literal = member.value as FunctionLiteral
      const method: ExtensionMethod = {
        receiver,
        name,
        literal,
        module_index: this.module_index,
        module_name: this.module_name,
        functions,
        key,
      }
      const other = this.find(receiver, name.name)
      if (other !== undefined) {
        const where =
          other.module_index === this.module_index ? 'the same module' : other.module_name
        const message = `${format_type(receiver)} already has a method '${name.name}', from an extend in ${where}`
        throw new CompileError(message, name.line, name.column)
      }
      this.in_effect.push(method)
      this.own.push(method)
      functions.add(key, name, literal, receiver)
    }
  }

  find(receiver: Type, name: string): ExtensionMethod | undefined {
    return this.in_effect.find(
      (method) => method.name.name === name && same_type(method.receiver, receiver),
    )
  }

  // The type of the method `name` of the receiver, checking its body first if needed.
  method_type(receiver: Type, name: Identifier): Type | undefined {
    const method = this.find(receiver, name.name)
    return method?.functions.type_of(method.key, name)
  }
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
