// Checks loops: `for` over a range or an array, `while`, comprehensions, and where `break` and
// `continue` may be.
import type {
  Comprehension,
  Condition,
  Expression,
  For,
  Identifier,
  Jump,
  Range,
  Statement,
  While,
} from '../syntax/ast.ts'
import { check_item_type } from './collection_checker.ts'
import { CompileError } from '../errors.ts'
import type { CheckerLocal, ExpressionChecker } from './expression_checker.ts'
import { narrowing_of, type ConditionNarrowing } from './narrowing.ts'
import type { Scopes } from '../scopes.ts'
import type { TypeResolver } from './type_names.ts'
import { array_type, format_type, int_type, void_type, type Type } from '../types.ts'

// Loop bodies are blocks of statements, which the statement checker checks.
export type LoopBodyChecker = {
  // A block is a scope; `define` declares the names that belong to it besides its statements, and
  // `finish` checks more before the scope ends.
  check_block(statements: Statement[], define?: () => void, finish?: () => void): void
  // Checks the condition, and returns what it defines in the body: `const name = value`'s name.
  check_condition(condition: Condition): () => void
  define_local(local: CheckerLocal): void
  // Narrows a local in the current scope, where the condition shows it has a narrower type.
  narrow(narrowing: ConditionNarrowing): void
}

export class LoopChecker {
  private readonly expressions: ExpressionChecker
  private readonly scopes: Scopes<CheckerLocal>
  private readonly resolver: TypeResolver
  private readonly bodies: LoopBodyChecker
  private loop_depth = 0

  constructor(
    expressions: ExpressionChecker,
    scopes: Scopes<CheckerLocal>,
    resolver: TypeResolver,
    bodies: LoopBodyChecker,
  ) {
    this.expressions = expressions
    this.scopes = scopes
    this.resolver = resolver
    this.bodies = bodies
  }

  check_jump(jump: Jump): void {
    if (this.loop_depth === 0) {
      throw new CompileError(`'${jump.kind}' outside a loop`, jump.line, jump.column)
    }
  }

  // A loop variable is a const, which the loop declares rather than a statement.
  private define_loop_variable(variable: Identifier, type: Type): void {
    this.bodies.define_local({
      identifier: variable,
      type,
      mutable: false,
      declared: false,
      used: false,
    })
  }

  // A range gives Ints; an array gives its items.
  check_for(for_statement: For): void {
    const { iterable, variable } = for_statement
    const item_type = this.type_of_iterated(iterable)
    this.check_loop_body(for_statement.body, () => this.define_loop_variable(variable, item_type))
  }

  check_while(while_statement: While): void {
    const define = this.bodies.check_condition(while_statement.condition)
    this.check_loop_body(while_statement.body, define)
  }

  // The guard narrows the loop variable in the element as an `if` would.
  type_of_comprehension(comprehension: Comprehension, expected: Type | undefined): Type {
    const { element, variable, iterable, guard } = comprehension
    const item_type = this.type_of_iterated(iterable)
    const expected_element = expected?.kind === 'Array' ? expected.element : undefined
    let element_type: Type = void_type
    this.bodies.check_block(
      [],
      () => {
        this.define_loop_variable(variable, item_type)
        if (guard === undefined) return
        this.expressions.expect_condition(guard)
        const narrowing = narrowing_of(guard, this.scopes, this.resolver)
        if (narrowing?.when === true) this.bodies.narrow(narrowing)
      },
      () => {
        element_type =
          expected_element === undefined
            ? this.expressions.type_of(element)
            : (this.expressions.expect_type(element, expected_element), expected_element)
      },
    )
    return array_type(check_item_type(element_type, element, 'an array'))
  }

  private check_loop_body(body: Statement[], define?: () => void): void {
    this.loop_depth++
    try {
      this.bodies.check_block(body, define)
    } finally {
      this.loop_depth--
    }
  }

  // The type of the items a `for` goes through: Ints for a range, or an array's items.
  private type_of_iterated(iterable: Expression): Type {
    return iterable.kind === 'range'
      ? this.check_range(iterable)
      : this.check_iterated_array(iterable)
  }

  private check_range(range: Range): Type {
    this.expressions.expect_type(range.start, int_type)
    this.expressions.expect_type(range.end, int_type)
    return int_type
  }

  private check_iterated_array(iterable: Expression): Type {
    const type = this.expressions.type_of(iterable)
    if (type.kind !== 'Array') {
      const message = `expected a range or an array after 'in', got ${format_type(type)}`
      throw new CompileError(message, iterable.line, iterable.column)
    }
    return type.element
  }
}
