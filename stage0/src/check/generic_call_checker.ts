// Types calls of generic functions and methods: checks their type arguments (see
// TypeArgumentInference) against the bounds and the signature, and has the instance checked (see
// GenericFunction).
import type { Call, Member, Position } from '../syntax/ast.ts'
import type { Shared } from './shared.ts'
import { check_item_type, check_map_types, check_value_type } from './collection_checker.ts'
import { CompileError } from '../errors.ts'
import type { ExpressionChecker } from './expression_checker.ts'
import type { Extensions } from './extensions.ts'
import type { GenericFunction, Instance } from './generics.ts'
import type { ObjectTypes } from './object_types.ts'
import {
  receiver_type_arguments,
  TypeArgumentInference,
  type Binding,
} from './type_argument_inference.ts'
import { parts_of, substitute } from './type_patterns.ts'
import type { Type } from '../types.ts'

type StringableError = (type: Type, at: Position) => CompileError | undefined

type FunctionType = Extract<Type, { kind: 'function' }>

export class GenericCallChecker {
  private readonly expressions: ExpressionChecker
  private readonly inference: TypeArgumentInference
  private readonly extensions: Extensions
  private readonly objects: ObjectTypes
  private readonly instances: Map<Call, Instance>
  // The error for a type that is not Stringable, or none (see MemberChecker).
  private readonly stringable_error: StringableError

  constructor(expressions: ExpressionChecker, shared: Shared, stringable_error: StringableError) {
    this.expressions = expressions
    this.stringable_error = stringable_error
    this.inference = new TypeArgumentInference(expressions, shared.resolver)
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
    const type_arguments = receiver_type_arguments(generic, receiver)
    if (type_arguments === undefined) return undefined
    const instance = this.instantiate(generic, type_arguments, at)
    if (call !== undefined) this.instances.set(call, instance)
    return instance
  }

  // Each argument typed alone must fit its parameter once the type arguments are known.
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
    const { bindings, inferred } = this.inference.infer(call, generic, expected, receiver)
    const type_arguments = this.type_arguments(call, generic, bindings)
    reject_invalid_signature(generic, type_arguments, call)
    const instance = this.instantiate(generic, type_arguments, call)
    const type = function_type(instance)
    for (const { arg, type: arg_type, index } of inferred) {
      this.expressions.require_type(arg, arg_type, type.params[index])
    }
    this.instances.set(call, instance)
    return instance
  }

  // The instance's body sees the extends in effect here of the types it may reach.
  private instantiate(generic: GenericFunction, type_arguments: Type[], at: Position): Instance {
    const methods = this.extensions.methods_reachable_from(type_arguments, this.objects)
    return generic.instantiate(type_arguments, methods, at)
  }

  // The type arguments in order, which must all be known and satisfy their bounds.
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
        bound === undefined ? undefined : this.stringable_error(binding.type, binding.at)
      if (error !== undefined) throw error
      return binding.type
    })
  }
}

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
  const bindings = generic.bindings(type_arguments)
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
