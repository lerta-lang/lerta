// The methods that `extend` statements give to types. Those of a module are in effect in it and in
// the modules that import it directly, so that a module sees only the extends it asks for.
import type { FunctionLiteral, Identifier, Import, Position } from '../syntax/ast.ts'
import { CompileError } from '../errors.ts'
import type { Functions } from './functions.ts'
import type { GenericFunction } from './generics.ts'
import type { ObjectTypes } from './object_types.ts'
import { matches, overlaps, parts_of } from './type_patterns.ts'
import { format_type, type_key, type Type } from '../types.ts'

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

// The type of a method that is not generic, checking its body first if needed.
export const plain_method_type = (
  method: ExtensionMethod & PlainMethod,
  at: Position,
): Type | undefined => method.functions.type_of(method.key, at)

export class Extensions {
  private readonly in_effect: ExtensionMethod[] = []
  // The module's own, which the modules that import it get.
  readonly own: ExtensionMethod[] = []
  readonly module_index: number
  readonly module_name: string

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

  // A method of an extend of the module (see declare_extend).
  add_own(method: ExtensionMethod): void {
    const { receiver, name } = method
    const other = this.overlapping(receiver, name.name)
    if (other !== undefined) {
      const where = other.module_index === this.module_index ? 'the same module' : other.module_name
      const message = `${format_type(receiver)} already has a method '${name.name}', from an extend in ${where}`
      throw new CompileError(message, name.line, name.column)
    }
    this.in_effect.push(method)
    this.own.push(method)
  }

  // The extends in effect here, with `methods` before them, as an instance of a generic function
  // sees them (see GenericFunction).
  with_methods(methods: ExtensionMethod[]): Extensions {
    const extensions = new Extensions(this.module_index, this.module_name)
    const others = this.in_effect.filter((method) => !methods.includes(method))
    extensions.in_effect.push(...methods, ...others)
    return extensions
  }

  // The methods that the extends in effect give the types and the types they are made of, fields
  // included: those that the body of an instance with these type arguments may reach.
  methods_reachable_from(types: Type[], objects: ObjectTypes): ExtensionMethod[] {
    const seen = new Map<string, Type>()
    const visit = (type: Type) => {
      if (seen.has(type_key(type))) return
      seen.set(type_key(type), type)
      for (const part of parts_of(type)) visit(part)
      if (type.kind !== 'Object') return
      for (const field of objects.info(type).fields) {
        if (field.type !== undefined) visit(field.type)
      }
    }
    types.forEach(visit)
    // A generic extend's methods, as those of Array<T>, may be in effect for several of the types.
    const methods = [...seen.values()].flatMap((type) =>
      this.in_effect.filter((method) => matches(method.receiver, type)),
    )
    return [...new Set(methods)]
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

  // The generic methods that the module's own extends give, whose instances it generates.
  own_generics(): GenericFunction[] {
    return this.own.flatMap((method) => (method.generic === undefined ? [] : [method.generic]))
  }
}
