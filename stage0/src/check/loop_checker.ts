// Checks loops: `for` over a range, an array, a Binary or an Iter, `while`, comprehensions, and
// where `break` and `continue` may be.
import type {
  Comprehension,
  Condition,
  Expression,
  For,
  FunctionLiteral,
  Identifier,
  Jump,
  Range,
  Statement,
  While,
} from '../syntax/ast.ts'
import { check_item_type, check_value_type } from './collection_checker.ts'
import { CompileError } from '../errors.ts'
import type { CheckerLocal, ExpressionChecker } from './expression_checker.ts'
import {
  array_type,
  bool_type,
  format_type,
  int_type,
  iter_type,
  iterable_item,
  void_type,
  type Type,
} from '../types.ts'

// Loop bodies are blocks of statements, which the statement checker checks.
export type LoopBodyChecker = {
  // A block is a scope; `define` declares the names that belong to it besides its statements, and
  // `finish` checks more before the scope ends.
  check_block(statements: Statement[], define?: () => void, finish?: () => void): void
  // Checks the condition, and returns what it defines in the body: `const name = value`'s name.
  check_condition(condition: Condition): () => void
  define_local(local: CheckerLocal): void
  // Narrows, in the current scope, the local that the condition tests, where it holds.
  narrow_where_holds(condition: Expression): void
  // A function literal of an item (see ClosureChecker.type_of_item_function).
  type_of_item_function(
    literal: FunctionLiteral,
    item: Type,
    result: Type | undefined,
    holds?: Expression,
  ): Type
}

export class LoopChecker {
  private readonly expressions: ExpressionChecker
  private readonly bodies: LoopBodyChecker
  private loop_depth = 0

  constructor(expressions: ExpressionChecker, bodies: LoopBodyChecker) {
    this.expressions = expressions
    this.bodies = bodies
  }

  check_jump(jump: Jump): void {
    if (this.loop_depth === 0) {
      throw new CompileError(`'${jump.kind}' outside a loop`, jump.line, jump.column)
    }
  }

  // A loop variable is a const declared by the loop rather than by a statement, hence not `declared`.
  private define_loop_variable(variable: Identifier, type: Type): void {
    this.bodies.define_local({
      identifier: variable,
      type,
      mutable: false,
      declared: false,
      used: false,
    })
  }

  // A range gives Ints; an array, a Binary or an Iter gives its items.
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
    const { element, variable, iterable, guard, lazy } = comprehension
    const item_type = this.type_of_iterated(iterable)
    if (lazy !== undefined)
      return this.type_of_iter_comprehension(comprehension, item_type, expected)
    const expected_element = expected?.kind === 'Array' ? expected.element : undefined
    let element_type: Type = void_type
    this.bodies.check_block(
      [],
      () => {
        this.define_loop_variable(variable, item_type)
        if (guard === undefined) return
        this.expressions.expect_condition(guard)
        this.bodies.narrow_where_holds(guard)
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

  // The guard and the element are functions of the item (see Comprehension); the guard narrows the
  // item in the element, which runs only where it holds.
  private type_of_iter_comprehension(
    comprehension: Comprehension,
    item_type: Type,
    expected: Type | undefined,
  ): Type {
    const { guard, element } = comprehension.lazy!
    if (guard !== undefined) this.bodies.type_of_item_function(guard, item_type, bool_type)
    const expected_item = expected?.kind === 'Iter' ? expected.item : undefined
    const element_type = this.bodies.type_of_item_function(
      element,
      item_type,
      expected_item,
      comprehension.guard,
    )
    if (element_type.kind !== 'function') throw new Error('an element function has a function type')
    return iter_type(check_value_type(element_type.result, comprehension.element, 'an Iter'))
  }

  private check_loop_body(body: Statement[], define?: () => void): void {
    this.loop_depth++
    try {
      this.bodies.check_block(body, define)
    } finally {
      this.loop_depth--
    }
  }

  // The type of the items a `for` goes through: Ints for a range, or the items of anything else.
  private type_of_iterated(iterable: Expression): Type {
    return iterable.kind === 'range' ? this.check_range(iterable) : this.check_iterated(iterable)
  }

  private check_range(range: Range): Type {
    this.expressions.expect_type(range.start, int_type)
    this.expressions.expect_type(range.end, int_type)
    return int_type
  }

  private check_iterated(iterable: Expression): Type {
    const type = this.expressions.type_of(iterable)
    const item = iterable_item(type)
    if (item !== undefined) return item
    const message = `expected a range, an array, a Binary or an Iter after 'in', got ${format_type(type)}`
    throw new CompileError(message, iterable.line, iterable.column)
  }
}
