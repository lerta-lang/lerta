// Finds the type arguments of a call of a generic function or method: those written, and those
// inferred from the receiver, the arguments and the type the call is expected to have.
import type { Call, Expression, Position } from '../syntax/ast.ts'
import { CompileError } from '../errors.ts'
import type { ExpressionChecker } from './expression_checker.ts'
import type { GenericFunction } from './generics.ts'
import type { TypeResolver } from './type_names.ts'
import { has_type_parameters, infer, substitute } from './type_patterns.ts'
import { same_type, type Type } from '../types.ts'

// A type argument, and where it was given or inferred from.
export type Binding = { type: Type; at: Position }

// An argument typed alone, which its parameter must take once the type arguments are known.
export type InferredArgument = { arg: Expression; type: Type; index: number }

export type Inference = { bindings: Map<string, Binding>; inferred: InferredArgument[] }

// The type arguments of a generic method that the receiver gives, if it gives all of them.
export const receiver_type_arguments = (
  generic: GenericFunction,
  receiver: Type,
): Type[] | undefined => {
  const bindings = new Map<string, Type>()
  infer(generic.receiver!.type, receiver, (name, type) => bindings.set(name, type))
  if (generic.type_params.some(({ name }) => !bindings.has(name.name))) return undefined
  return generic.type_params.map(({ name }) => bindings.get(name.name)!)
}

export class TypeArgumentInference {
  private readonly expressions: ExpressionChecker
  private readonly resolver: TypeResolver

  constructor(expressions: ExpressionChecker, resolver: TypeResolver) {
    this.expressions = expressions
    this.resolver = resolver
  }

  // The type arguments come, in order, from those written; from the receiver of a method and the
  // arguments that have a type of their own, each typed alone; from the type the call is expected
  // to have; then from the literals, whose type may depend on what is expected of them (`[]`,
  // `nil`, `1` as a Byte), each checked against its parameter's type once it has no type parameter
  // left; and last from the function literals, whose parameters may take their types from all the
  // others. An argument of type X? after one of type X makes the type argument X?. The call has as
  // many arguments as the generic has parameters.
  infer(
    call: Call,
    generic: GenericFunction,
    expected: Type | undefined,
    receiver: Binding | undefined,
  ): Inference {
    const { params } = generic
    const bindings = this.written_bindings(call, generic)
    const written = new Set(bindings.keys())
    const inferred: InferredArgument[] = []
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
    return { bindings, inferred }
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
}

// A literal whose type may depend on what is expected of it.
const needs_context = (arg: Expression): boolean =>
  ['function', 'nil', 'integer', 'string', 'array', 'map', 'record'].includes(arg.kind)

const types_of = (bindings: Map<string, Binding>): Map<string, Type> =>
  new Map([...bindings].map(([name, { type }]) => [name, type]))
