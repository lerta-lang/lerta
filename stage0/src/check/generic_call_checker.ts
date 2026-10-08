// Types calls of generic functions: finds their type arguments, written or inferred from the
// arguments, checks the bounds, and has the instance checked (see GenericFunction).
import type { Call, Expression, Position } from '../syntax/ast.ts'
import type { Shared } from './checker.ts'
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

  // The type arguments come, in order, from those written; from the arguments that have a type of
  // their own, each typed alone; from the type the call is expected to have; then from the
  // literals, whose type may depend on what is expected of them (`[]`, `nil`, `1` as a Byte), each
  // checked against its parameter's type once it has no type parameter left; and last from the
  // function literals, whose parameters may take their types from all the others.
  // An argument of type X? after one of type X makes the type argument X?.
  type_of_call(call: Call, generic: GenericFunction, expected: Type | undefined): Type {
    if (call.named_args.length > 0) {
      const { line, column } = call.named_args[0].name
      throw new CompileError('a generic function takes no named arguments so far', line, column)
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
    const check_argument = (index: number) => {
      const arg = call.args[index]
      const param = substitute(params[index], types_of(bindings))
      if (!has_type_parameters(param) && needs_context(arg)) {
        return this.expressions.expect_type(arg, param)
      }
      const type = this.expressions.type_of(arg)
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
    const instance = generic.instantiate(type_arguments, this.methods_of(type_arguments), call)
    const type = instance.type
    if (type?.kind !== 'function') throw new Error('an instance has a function type')
    for (const { arg, type: arg_type, index } of inferred) {
      this.expressions.require_type(arg, arg_type, type.params[index])
    }
    this.instances.set(call, instance)
    return type.result
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
    return [...seen.values()].flatMap((type) => this.extensions.methods_of(type))
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

// A literal whose type may depend on what is expected of it.
const needs_context = (arg: Expression): boolean =>
  ['function', 'nil', 'integer', 'string', 'array', 'map', 'record'].includes(arg.kind)

const types_of = (bindings: Map<string, Binding>): Map<string, Type> =>
  new Map([...bindings].map(([name, { type }]) => [name, type]))
