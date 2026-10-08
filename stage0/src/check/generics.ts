// Generic functions, `const first = <T>(xs: Array<T>) -> xs[0]`, declared at the top level, and
// generic methods of extends: those of a generic type, `extend Array<T>`, and those with type
// parameters of their own. Each distinct set of type arguments makes an instance: a copy of the
// literal, whose body is checked with the type parameters standing for the type arguments, and
// generated as a function of its own. A generic function that is never called is not checked.
import type { FunctionLiteral, Identifier, Position, TypeParameter } from '../syntax/ast.ts'
import { CompileError } from '../errors.ts'
import type { ExtensionMethod, Extensions } from './extensions.ts'
import { parameter_types, type FunctionEntry } from './functions.ts'
import type { TypeResolver } from './type_names.ts'
import {
  array_type,
  format_type,
  iter_type,
  map_type,
  optional_type,
  record_type,
  same_type,
  type_key,
  union_type,
  type Type,
} from '../types.ts'

// The receiver of a generic method: the extended type, in which the extend's type parameters stand
// for themselves, as `Array<T>`.
export type Receiver = { type: Type; type_params: TypeParameter[] }

export type Instance = FunctionEntry & {
  generic: GenericFunction
  type_arguments: Type[]
  // The extends of the type arguments in effect where it is first called: the body sees them, as
  // the caller does, before the declaring module's own.
  methods: ExtensionMethod[]
  extensions: Extensions
  resolver: TypeResolver
  // Tells apart the instances of the same type arguments with different extends.
  variant: number
}

// The only bound so far: a type argument must have `to_string(): String`.
export const stringable = 'Stringable'

// Type arguments nested deeper come from instances that would never end, as from `f<T>` calling
// `f<Array<T>>`.
const max_type_depth = 32

export class GenericFunction {
  readonly name: Identifier
  // A method's receiver, whose type parameters come first.
  readonly receiver: Receiver | undefined
  readonly type_params: TypeParameter[]
  // The parameters' types, and the result's if it is written, in which the type parameters stand
  // for themselves.
  readonly params: Type[]
  readonly result: Type | undefined
  readonly module_index: number
  readonly instances: Instance[] = []
  private readonly literal: FunctionLiteral
  private readonly resolver: TypeResolver
  // The declaring module's.
  private readonly extensions: Extensions
  private readonly check_body: (instance: Instance) => void

  constructor(
    name: Identifier,
    literal: FunctionLiteral,
    module_index: number,
    resolver: TypeResolver,
    extensions: Extensions,
    check_body: (instance: Instance) => void,
    receiver?: Receiver,
  ) {
    this.name = name
    this.literal = literal
    this.receiver = receiver
    this.type_params = [...(receiver?.type_params ?? []), ...literal.type_params]
    this.module_index = module_index
    this.resolver = resolver
    this.extensions = extensions
    this.check_body = check_body
    this.reject_bad_type_parameters()
    const names = this.type_params.map(({ name }) => name.name)
    const placeholders = new Map(names.map((name): [string, Type] => [name, type_parameter(name)]))
    const generic_resolver = resolver.with_type_parameters(placeholders)
    this.params = parameter_types(literal, generic_resolver)
    this.result =
      literal.return_type === undefined
        ? undefined
        : generic_resolver.resolve(literal.return_type, true)
  }

  private reject_bad_type_parameters(): void {
    const seen = new Set<string>()
    for (const { name, bound } of this.type_params) {
      if (seen.has(name.name) || this.resolver.has_type(name.name)) {
        throw new CompileError(`'${name.name}' is already defined`, name.line, name.column)
      }
      seen.add(name.name)
      if (bound !== undefined && bound.name !== stringable) {
        const message = `only ${stringable} can bound a type parameter so far`
        throw new CompileError(message, bound.line, bound.column)
      }
    }
  }

  // The instance of the type arguments, whose extends in effect are `methods`, checked if new.
  instantiate(type_arguments: Type[], methods: ExtensionMethod[], at: Position): Instance {
    const key = type_arguments.map(type_key).join(', ')
    const same_arguments = this.instances.filter(
      (instance) => instance.type_arguments.map(type_key).join(', ') === key,
    )
    const found = same_arguments.find((instance) => same_methods(instance.methods, methods))
    if (found === undefined && type_arguments.some((type) => type_depth(type) > max_type_depth)) {
      const message = `'${this.name.name}' needs instances without end, each with type arguments nested deeper`
      const error = new CompileError(message, at.line, at.column)
      error.add_context(`from ${this.describe(this.instances[0])}`)
      throw error
    }
    const instance = found ?? this.add_instance(type_arguments, methods, same_arguments.length)
    // As for a function that is not generic, a body whose return type is written is checked once
    // the calling module is, so that it may use what the module declares after the call.
    if (found === undefined && instance.type === undefined) this.check(instance)
    if (instance.type === undefined) {
      const message = `'${this.name.name}' is recursive, so its return type must be written`
      throw new CompileError(message, at.line, at.column)
    }
    return instance
  }

  private add_instance(type_arguments: Type[], methods: ExtensionMethod[], variant: number) {
    const bindings = new Map(
      this.type_params.map(({ name }, i): [string, Type] => [name.name, type_arguments[i]]),
    )
    const resolver = this.resolver.with_type_parameters(bindings)
    // Each instance's expressions have types of their own.
    const literal = structuredClone(this.literal)
    const type: Type | undefined =
      literal.return_type === undefined
        ? undefined
        : {
            kind: 'function',
            params: parameter_types(literal, resolver),
            result: resolver.resolve(literal.return_type, true),
          }
    const instance: Instance = {
      name: this.name,
      literal,
      type,
      state: 'unchecked',
      this_type: this.receiver === undefined ? undefined : substitute(this.receiver.type, bindings),
      generic: this,
      type_arguments,
      methods,
      extensions: this.extensions.with_methods(methods),
      resolver,
      variant,
    }
    this.instances.push(instance)
    return instance
  }

  // Checks the instances left unchecked; returns whether there were any.
  check_pending(): boolean {
    const pending = this.instances.filter((instance) => instance.state === 'unchecked')
    for (const instance of pending) this.check(instance)
    return pending.length > 0
  }

  // An error in the body says which instance it was found in.
  private check(instance: Instance): void {
    instance.state = 'checking'
    try {
      this.check_body(instance)
    } catch (error) {
      if (error instanceof CompileError) error.add_context(`in ${this.describe(instance)}`)
      throw error
    }
    instance.state = 'checked'
  }

  // `print<Int>`, as messages write an instance; a method's, `Array<Int>.map<String>`, by its
  // receiver and the type arguments of its own.
  private describe({ type_arguments, this_type }: Instance): string {
    const own_arguments = type_arguments.slice(this.receiver?.type_params.length ?? 0)
    const name =
      this_type === undefined ? this.name.name : `${format_type(this_type)}.${this.name.name}`
    if (own_arguments.length === 0) return name
    return `${name}<${own_arguments.map((type) => format_type(type)).join(', ')}>`
  }
}

const same_methods = (a: ExtensionMethod[], b: ExtensionMethod[]): boolean =>
  a.length === b.length && a.every((method) => b.includes(method))

export const type_parameter = (name: string): Type => ({ kind: 'TypeParameter', name })

// The type with each type it is made of replaced by `replace` of it.
const map_parts = (type: Type, replace: (part: Type) => Type): Type => {
  switch (type.kind) {
    case 'Array':
      return array_type(replace(type.element))
    case 'Iter':
      return iter_type(replace(type.item))
    case 'Map':
      return map_type(replace(type.key), replace(type.value))
    case 'Optional':
      return optional_type(replace(type.inner))
    case 'Record':
      return record_type(type.fields.map(({ name, type }) => ({ name, type: replace(type) })))
    case 'Union':
      return union_type(type.members.map(replace))
    case 'function':
      return { kind: 'function', params: type.params.map(replace), result: replace(type.result) }
    default:
      return type
  }
}

// The type with the type parameters that `bindings` has replaced by their types.
export const substitute = (type: Type, bindings: Map<string, Type>): Type =>
  type.kind === 'TypeParameter'
    ? (bindings.get(type.name) ?? type)
    : map_parts(type, (part) => substitute(part, bindings))

// The types that the type is made of, such as the items of an array.
export const parts_of = (type: Type): Type[] => {
  const parts: Type[] = []
  map_parts(type, (part) => {
    parts.push(part)
    return part
  })
  return parts
}

const type_depth = (type: Type): number => 1 + Math.max(0, ...parts_of(type).map(type_depth))

// Whether the type is the pattern with its type parameters replaced, as Array<Int> is Array<T>.
export const matches = (pattern: Type, type: Type): boolean => {
  const bindings = new Map<string, Type>()
  infer(pattern, type, (name, bound) => {
    if (!bindings.has(name)) bindings.set(name, bound)
  })
  return same_type(substitute(pattern, bindings), type)
}

// Whether some type matches both patterns, as Array<Int> matches Array<T> and Array<Int>. A type
// parameter stands for any type on either side, even where it is repeated, as in Map<T, T>.
export const overlaps = (a: Type, b: Type): boolean => {
  if (a.kind === 'TypeParameter' || b.kind === 'TypeParameter') return true
  const [a_parts, b_parts] = [parts_of(a), parts_of(b)]
  return (
    shape_key(a) === shape_key(b) &&
    a_parts.length === b_parts.length &&
    a_parts.every((part, i) => overlaps(part, b_parts[i]))
  )
}

// The type without the types it is made of: Array<_> for any array.
const shape_key = (type: Type): string => type_key(map_parts(type, () => type_parameter('_')))

export const has_type_parameters = (type: Type): boolean =>
  type.kind === 'TypeParameter' || parts_of(type).some(has_type_parameters)

// Binds the type parameters in `pattern` to the types they have in `type`, where its shape
// matches: `Array<T>` and an `Array<Int>` bind T to Int. A type parameter bound already is kept;
// the caller then checks that the type fits.
export const infer = (
  pattern: Type,
  type: Type,
  bind: (name: string, type: Type) => void,
): void => {
  const match = (a: Type | undefined, b: Type | undefined) => {
    if (a !== undefined && b !== undefined) infer(a, b, bind)
  }
  switch (pattern.kind) {
    case 'TypeParameter':
      return bind(pattern.name, type)
    case 'Optional':
      return match(pattern.inner, type.kind === 'Optional' ? type.inner : type)
    case 'Array':
      return match(pattern.element, type.kind === 'Array' ? type.element : undefined)
    case 'Iter':
      return match(pattern.item, type.kind === 'Iter' ? type.item : undefined)
    case 'Map':
      if (type.kind !== 'Map') return
      match(pattern.key, type.key)
      return match(pattern.value, type.value)
    case 'Record':
      if (type.kind !== 'Record') return
      for (const field of pattern.fields) {
        match(field.type, type.fields.find(({ name }) => name === field.name)?.type)
      }
      return
    case 'function':
      if (type.kind !== 'function' || type.params.length !== pattern.params.length) return
      pattern.params.forEach((param, i) => match(param, type.params[i]))
      return match(pattern.result, type.result)
    default:
      return
  }
}
