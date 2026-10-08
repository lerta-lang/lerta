// Checks function literals in expressions and finds the names their bodies capture.
import type { Expression, FunctionLiteral } from '../syntax/ast.ts'
import type { Capture, FunctionContext, Shared } from './checker.ts'
import { CompileError } from '../errors.ts'
import type { CheckerLocal } from './expression_checker.ts'
import { parameter_types } from './functions.ts'
import { finish_function_type, reject_nil_result } from './result_checker.ts'
import type { Scopes } from '../scopes.ts'
import { format_type, type Type } from '../types.ts'

// The enclosing functions of a function literal's body: how to find their names, and the
// captures found.
export type ClosureContext = {
  enclosing: (name: string) => CheckerLocal | undefined
  captures: Capture[]
}

// Function bodies are statements, which the statement checker checks; `holds` narrows the
// parameters (see ClosureChecker.type_of_item_function).
type CreateBodyChecker = (
  context: FunctionContext,
  closure: ClosureContext,
) => { check_function_body(literal: FunctionLiteral, params: Type[], holds?: Expression): void }

export class ClosureChecker {
  private readonly shared: Shared
  private readonly scopes: Scopes<CheckerLocal>
  private readonly closure: ClosureContext | undefined
  private readonly create_body_checker: CreateBodyChecker

  // `closure` is given when the scopes are those of a function literal's body, which captures the
  // names it uses from around it.
  constructor(
    shared: Shared,
    scopes: Scopes<CheckerLocal>,
    closure: ClosureContext | undefined,
    create_body_checker: CreateBodyChecker,
  ) {
    this.shared = shared
    this.scopes = scopes
    this.closure = closure
    this.create_body_checker = create_body_checker
  }

  type_of_function_literal(literal: FunctionLiteral, expected: Type | undefined): Type {
    const expected_function = expected?.kind === 'function' ? expected : undefined
    const params = expected_function?.params
    return reject_nil_result(
      this.check_literal(literal, params, expected_function?.result),
      literal,
    )
  }

  // A function literal of an item, as `map` takes, or as the guard and the element of an Iter
  // comprehension are: its parameter's type may be left out, and its result is inferred unless
  // given. `holds`, a condition known to hold where it runs, narrows the item as an `if` would.
  // Its type is recorded here, since it is not checked as an expression.
  type_of_item_function(
    literal: FunctionLiteral,
    item: Type,
    result: Type | undefined,
    holds?: Expression,
  ): Type {
    const type = this.check_literal(literal, [item], result, holds)
    this.shared.types.set(literal, type)
    return type
  }

  // The body is checked here, where the names around it are known; those it uses from the
  // enclosing functions are its captures. The expected parameter types stand in for those left
  // out, and the expected result for one left out.
  private check_literal(
    literal: FunctionLiteral,
    expected_params: Type[] | undefined,
    expected_result: Type | undefined,
    holds?: Expression,
  ): Type {
    const has_untyped = literal.params.some((param) => param.type === undefined)
    const count = literal.params.length
    if (has_untyped && expected_params !== undefined && expected_params.length !== count) {
      const expected =
        expected_result === undefined
          ? `a function of ${expected_params.length} parameter(s)`
          : format_type({ kind: 'function', params: expected_params, result: expected_result })
      const message = `expected ${expected}, got a function of ${count} parameter(s)`
      throw new CompileError(message, literal.line, literal.column)
    }
    const { resolver } = this.shared
    const params = parameter_types(literal, resolver, expected_params)
    const annotated =
      literal.return_type === undefined
        ? expected_result
        : resolver.resolve(literal.return_type, true)
    const context: FunctionContext = { annotated, inferred: undefined, results: [] }
    const captures: Capture[] = []
    const enclosing = (name: string) => this.scopes.lookup_local(name) ?? this.captured(name)
    const body = this.create_body_checker(context, { enclosing, captures })
    body.check_function_body(literal, params, holds)
    this.shared.captures.set(literal, captures)
    return finish_function_type(context, params, this.shared.conversions)
  }

  // A local of an enclosing function, seen from a function literal, which captures its value; a
  // top-level value is not captured but read where it is.
  captured(name: string): CheckerLocal | undefined {
    if (this.closure === undefined) return undefined
    const local = this.closure.enclosing(name)
    if (local === undefined || local === this.shared.top_level.lookup(name)) return undefined
    const { captures } = this.closure
    const origin = local.origin ?? local
    if (origin.mutable) this.shared.shared_vars.add(origin.identifier)
    if (!captures.some((capture) => capture.name === name)) {
      captures.push({ name, type: local.type, is_var: origin.mutable })
    }
    return { ...local, declared: false, origin, captured: true }
  }
}
