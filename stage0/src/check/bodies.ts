// Checks the bodies of the module's functions, methods, instances of generic functions and
// initializers of fields, each on demand (see Functions, GenericFunction and ObjectTypes).
import type { FunctionLiteral, Identifier } from '../syntax/ast.ts'
import { parameter_types, type FunctionEntry } from './functions.ts'
import { GenericFunction, type Instance, type Receiver } from './generics.ts'
import { with_module_path } from '../loader.ts'
import type { ObjectInfo } from './object_types.ts'
import { finish_function_type, reject_nil_result } from './result_checker.ts'
import type { FunctionContext, SelfContext, Shared } from './shared.ts'
import { StatementChecker } from './statement_checker.ts'

// A generic function or method of the module, whose instances are checked as its functions are.
export const make_generic_function = (
  shared: Shared,
  name: Identifier,
  literal: FunctionLiteral,
  receiver: Receiver | undefined,
): GenericFunction => {
  const { module_index, resolver, extensions } = shared
  const check_body = (instance: Instance) => check_instance(shared, instance)
  return new GenericFunction(
    name,
    literal,
    module_index,
    resolver,
    extensions,
    check_body,
    receiver,
  )
}

// An instance's body sees the names of its module, with the type parameters standing for its type
// arguments, and the extends of the type arguments where it is called.
const check_instance = (shared: Shared, instance: Instance): void => {
  const { resolver, extensions } = instance
  check_function({ ...shared, resolver, extensions }, instance)
}

// A body may be checked on demand from another module, such as the method `to_string` that an
// instance of `print` calls; its diagnostics give its own module.
export const check_function = (shared: Shared, entry: FunctionEntry): void =>
  with_module_path(shared.module_path, () => check_function_body(shared, entry))

const check_function_body = (shared: Shared, entry: FunctionEntry): void => {
  const { literal } = entry
  const params = parameter_types(literal, shared.resolver)
  const context: FunctionContext = {
    annotated: entry.type?.kind === 'function' ? entry.type.result : undefined,
    inferred: undefined,
    results: [],
  }
  const self =
    entry.this_type === undefined ? undefined : { type: entry.this_type, initializing: undefined }
  new StatementChecker(shared, context, self).check_function_body(literal, params)
  // The conversions of the results are recorded even if the type was known from its annotation.
  const type = reject_nil_result(finish_function_type(context, params, shared.conversions), literal)
  entry.type ??= type
  shared.types.set(literal, entry.type)
}

export const check_object = (shared: Shared, info: ObjectInfo): void => {
  const self: SelfContext = { type: info.type, initializing: undefined }
  with_module_path(shared.module_path, () =>
    new StatementChecker(shared, undefined, self).check_initializers(),
  )
}
