// Types calls of generic functions and methods: finds their type arguments, written or inferred
// from the receiver and the arguments, checks the bounds, and has the instance checked (see
// GenericFunction).
import type { Call, Expression, Member, Position } from '../syntax/ast.ts'
import type { Shared } from './checker.ts'
import { check_item_type, check_map_types, check_value_type } from './collection_checker.ts'
import { CompileError } from '../errors.ts'
import type { ExpressionChecker } from './expression_checker.ts'
import type { ExtensionMethod, Extensions } from './extensions.ts'
import type { ObjectTypes } from './object_types.ts'
import {
  has_type_parameters,
  infer,
  parts_of,
  substitute,
  type GenericFunction,
  type Instance,
} from './generics.ts'
import type { TypeResolver } from './type_names.ts'
import { same_type, type_key, type Type } from '../types.ts'

// A type argument, and where it was given or inferred from.
type Binding = { type: Type; at: Position }

export class GenericCallChecker {
  private readonly expressions: ExpressionChecker
  private readonly resolver: TypeResolver
  private readonly extensions: Extensions
  private readonly objects: ObjectTypes
  private readonly instances: Map<Call, Instance>

  constructor(expressions: ExpressionChecker, shared: Shared) {
    this.expressions = expressions
    this.resolver = shared.resolver
    this.extensions = shared.extensions
    this.objects = shared.objects
    this.instances = shared.instances
  }

  // The result of a call of a generic function.
  type_of_call(call: Call, generic: GenericFunction, expected: Type | undefined): Type {
    return function_type(this.instance_of_call(call, generic, expected, undefined)).result
  }

  // The type of the generic method that the call's callee names, a function type without the
  // receiver.
  type_of_method_call(
    call: Call,
    member: Member,
    generic: GenericFunction,
    receiver: Type,
    expected: Type | undefined,
  ): FunctionType {
    const binding = { type: receiver, at: member.object }
    return function_type(this.instance_of_call(call, generic, expected, binding))
  }

  // The instance of a generic method that the receiver gives all the type arguments of, if it does;
  // `call`, if given, calls it.
  receiver_instance(
    generic: GenericFunction,
    receiver: Type,
    at: Position,
    call: Call | undefined,
  ): Instance | undefined {
    const bindings = new Map<string, Type>()
    infer(generic.receiver!.type, receiver, (name, type) => bindings.set(name, type))
    if (generic.type_params.some(({ name }) => !bindings.has(name.name))) return undefined
    const type_arguments = generic.type_params.map(({ name }) => bindings.get(name.name)!)
    const instance = generic.instantiate(type_arguments, this.methods_of(type_arguments), at)
    if (call !== undefined) this.instances.set(call, instance)
    return instance
  }

  // The type arguments come, in order, from those written; from the receiver of a method and the
  // arguments that have a type of their own, each typed alone; from the type the call is expected
  // to have; then from the literals, whose type may depend on what is expected of them (`[]`,
  // `nil`, `1` as a Byte), each checked against its parameter's type once it has no type parameter
  // left; and last from the function literals, whose parameters may take their types from all the
  // others. An argument of type X? after one of type X makes the type argument X?.
  private instance_of_call(
    call: Call,
    generic: GenericFunction,
    expected: Type | undefined,
    receiver: Binding | undefined,
  ): Instance {
    if (call.named_args.length > 0) {
      const { line, column } = call.named_args[0].name
      const kind = generic.receiver === undefined ? 'function' : 'method'
      throw new CompileError(`a generic ${kind} takes no named arguments so far`, line, column)
    }
    const { params } = generic
    if (call.args.length !== params.length) {
      const message = `expected ${params.length} argument(s), got ${call.args.length}`
      throw new CompileError(message, call.line, call.column)
    }
    const bindings = this.written_bindings(call, generic)
    const written = new Set(bindings.keys())
    const inferred: { arg: Expression; type: Type; index: number }[] = []
    const bind_from = (pattern: Type, type: Type, at: Position) =>
      infer(pattern, type, (name, bound_type) => {
        // nil and never tell nothing about the type.
        if (bound_type.kind === 'nil' || bound_type.kind === 'never') return
        const bound = bindings.get(name)
        const widens =
          bound !== undefined &&
          !written.has(name) &&
          bound_type.kind === 'Optional' &&
          same_type(bound_type.inner, bound.type)
        if (bound === undefined || widens) bindings.set(name, { type: bound_type, at })
      })
    if (receiver !== undefined) bind_from(generic.receiver!.type, receiver.type, receiver.at)
    const check_argument = (index: number) => {
      const arg = call.args[index]
      const param = substitute(params[index], types_of(bindings))
      if (!has_type_parameters(param) && needs_context(arg)) {
        return this.expressions.expect_type(arg, param)
      }
      // A function literal's parameters may take the types that are known already.
      const type = this.expressions.type_of(arg, arg.kind === 'function' ? param : undefined)
      if (type.kind === 'void') {
        throw new CompileError('expected a value, got void', arg.line, arg.column)
      }
      bind_from(params[index], type, arg)
      inferred.push({ arg, type, index })
    }
    const indexes = [...call.args.keys()]
    const is_function = (i: number) => call.args[i].kind === 'function'
    const is_literal = (i: number) => needs_context(call.args[i]) && !is_function(i)
    for (const index of indexes.filter((i) => !needs_context(call.args[i]))) check_argument(index)
    if (generic.result !== undefined && expected !== undefined) {
      bind_from(generic.result, expected, call)
    }
    for (const index of indexes.filter(is_literal)) check_argument(index)
    for (const index of indexes.filter(is_function)) check_argument(index)
    const type_arguments = this.type_arguments(call, generic, bindings)
    reject_invalid_signature(generic, type_arguments, call)
    const instance = generic.instantiate(type_arguments, this.methods_of(type_arguments), call)
    const type = function_type(instance)
    for (const { arg, type: arg_type, index } of inferred) {
      this.expressions.require_type(arg, arg_type, type.params[index])
    }
    this.instances.set(call, instance)
    return instance
  }

  // The methods that the extends in effect here give the type arguments and the types they are
  // made of, fields included, which the instance's body may reach.
  private methods_of(type_arguments: Type[]): ExtensionMethod[] {
    const seen = new Map<string, Type>()
    const visit = (type: Type) => {
      if (seen.has(type_key(type))) return
      seen.set(type_key(type), type)
      for (const part of parts_of(type)) visit(part)
      if (type.kind !== 'Object') return
      for (const field of this.objects.info(type).fields) {
        if (field.type !== undefined) visit(field.type)
      }
    }
    type_arguments.forEach(visit)
    // A generic extend's methods, as those of Array<T>, may be in effect for several of the types.
    const methods = [...seen.values()].flatMap((type) => this.extensions.methods_of(type))
    return [...new Set(methods)]
  }

  // `f<Int>(x)` gives all the type arguments.
  private written_bindings(call: Call, generic: GenericFunction): Map<string, Binding> {
    const { type_params, name } = generic
    if (call.type_args.length === 0) return new Map()
    if (call.type_args.length !== type_params.length) {
      const message = `'${name.name}' takes ${type_params.length} type argument(s), got ${call.type_args.length}`
      throw new CompileError(message, call.line, call.column)
    }
    return new Map(
      type_params.map(({ name }, i) => {
        const type_name = call.type_args[i]
        return [name.name, { type: this.resolver.resolve(type_name), at: type_name }]
      }),
    )
  }

  // The type arguments in order, which must satisfy their bounds.
  private type_arguments(
    call: Call,
    generic: GenericFunction,
    bindings: Map<string, Binding>,
  ): Type[] {
    return generic.type_params.map(({ name, bound }) => {
      const binding = bindings.get(name.name)
      if (binding === undefined) {
        const callee = generic.name.name
        const message = `cannot infer the type argument ${name.name} of '${callee}'; write it, as in ${callee}<...>(...)`
        throw new CompileError(message, call.line, call.column)
      }
      const error =
        bound === undefined
          ? undefined
          : this.expressions.stringable_error(binding.type, binding.at)
      if (error !== undefined) throw error
      return binding.type
    })
  }
}

type FunctionType = Extract<Type, { kind: 'function' }>

const function_type = (instance: Instance): FunctionType => {
  if (instance.type?.kind !== 'function') throw new Error('an instance has a function type')
  return instance.type
}

// The type arguments must make types that can be of the parameters and the result, as an Array<T>
// is not with T = Int?: an array cannot hold one.
const reject_invalid_signature = (
  generic: GenericFunction,
  type_arguments: Type[],
  at: Position,
): void => {
  const bindings = new Map(generic.type_params.map(({ name }, i) => [name.name, type_arguments[i]]))
  for (const type of [...generic.params, generic.result]) {
    if (type !== undefined) reject_invalid_parts(substitute(type, bindings), at)
  }
}

const reject_invalid_parts = (type: Type, at: Position): void => {
  if (type.kind === 'Array') check_item_type(type.element, at, 'an array')
  if (type.kind === 'Iter') check_value_type(type.item, at, 'an Iter')
  if (type.kind === 'Map') check_map_types(type.key, type.value, at, at)
  for (const part of parts_of(type)) reject_invalid_parts(part, at)
}

// A literal whose type may depend on what is expected of it.
const needs_context = (arg: Expression): boolean =>
  ['function', 'nil', 'integer', 'string', 'array', 'map', 'record'].includes(arg.kind)

const types_of = (bindings: Map<string, Binding>): Map<string, Type> =>
  new Map([...bindings].map(([name, { type }]) => [name, type]))
