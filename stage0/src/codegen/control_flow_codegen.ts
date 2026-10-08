// Generates control flow: `if`, `while`, `for` over ranges, arrays and Iters, comprehensions,
// `break` and `continue`.
import type {
  Comprehension,
  Condition,
  Expression,
  For,
  Identifier,
  If,
  Jump,
  Statement,
  While,
} from '../syntax/ast.ts'
import { emit_array_new, emit_get, emit_length, emit_push } from './array_codegen.ts'
import type { Types } from '../check/shared.ts'
import type { FunctionGenerator } from './function_codegen.ts'
import type { CodegenLocal, ExpressionGenerator } from './expression_codegen.ts'
import type { IrBuilder } from './ir_builder.ts'
import { emit_is_present, emit_unwrap } from './optional_codegen.ts'
import type { Scope, Scopes } from '../scopes.ts'
import {
  emit_comprehension_iter,
  emit_iter_loop,
  emit_iter_start,
  emit_range_iter,
  emit_source_iter,
} from './iter_codegen.ts'
import { int_type, iterable_item, type Type } from '../types.ts'

// Where `break` and `continue` jump, and how many scopes enclose the loop.
type Loop = { break_label: string; continue_label: string; scope_depth: number }

export class ControlFlowGenerator {
  private readonly blocks: FunctionGenerator
  private readonly ir: IrBuilder
  private readonly types: Types
  private readonly locals: Scopes<CodegenLocal>
  private readonly expressions: ExpressionGenerator
  private readonly loops: Loop[] = []

  constructor(
    blocks: FunctionGenerator,
    ir: IrBuilder,
    types: Types,
    locals: Scopes<CodegenLocal>,
    expressions: ExpressionGenerator,
  ) {
    this.blocks = blocks
    this.ir = ir
    this.types = types
    this.locals = locals
    this.expressions = expressions
  }

  generate_if(if_statement: If): void {
    const { test, define } = this.generate_condition(if_statement.condition)
    const then_label = this.ir.fresh_label('if.then')
    const else_label = this.ir.fresh_label('if.else')
    const end_label = this.ir.fresh_label('if.end')
    this.ir.emit(`br i1 ${test}, label %${then_label}, label %${else_label}`)
    this.ir.start_block(then_label)
    this.blocks.generate_block(if_statement.then_body, define)
    this.ir.emit(`br label %${end_label}`)
    this.ir.start_block(else_label)
    this.blocks.generate_block(if_statement.else_body)
    this.ir.emit(`br label %${end_label}`)
    this.ir.start_block(end_label)
  }

  // The test of a condition, and what it defines in the body: for `const name = value`, the value
  // without nil, which the body's scope owns.
  private generate_condition(condition: Condition): {
    test: string
    define: (scope: Scope<CodegenLocal>) => void
  } {
    if (condition.kind !== 'binding') {
      return { test: this.expressions.generate_condition(condition), define: () => {} }
    }
    const value = this.expressions.generate(condition.value)
    const type = this.types.get(condition.value)!
    if (type.kind !== 'Optional') throw new Error('a binding has an optional value')
    return {
      test: emit_is_present(this.ir, value, type),
      define: (scope) =>
        scope.set(
          condition.name.name,
          this.blocks.store_in_slot(emit_unwrap(this.ir, value, type), type.inner),
        ),
    }
  }

  generate_while(while_statement: While): void {
    const header_label = this.ir.fresh_label('while.header')
    const body_label = this.ir.fresh_label('while.body')
    const exit_label = this.ir.fresh_label('while.exit')
    this.ir.emit(`br label %${header_label}`)
    this.ir.start_block(header_label)
    const { test, define } = this.generate_condition(while_statement.condition)
    this.ir.emit(`br i1 ${test}, label %${body_label}, label %${exit_label}`)
    this.ir.start_block(body_label)
    this.generate_loop_body(while_statement.body, exit_label, header_label, define)
    this.ir.emit(`br label %${header_label}`)
    this.ir.start_block(exit_label)
  }

  // A range's bounds are evaluated once. An array or an Iter is held for the whole loop in a scope
  // of its own, so a `return` from the body releases it too; an array's length is read each round.
  generate_for(for_statement: For): void {
    const { iterable, variable, body } = for_statement
    this.generate_iteration(iterable, variable, body)
  }

  // A new array, of the comprehension's elements, which the loop pushes. Its loop can be the target
  // of no `break` or `continue`, which its element and guard cannot hold (see jump_positions.ts).
  generate_comprehension(comprehension: Comprehension): string {
    const { element, variable, iterable, guard, lazy } = comprehension
    if (lazy !== undefined) return this.generate_iter_comprehension(iterable, lazy)
    const type = this.types.get(comprehension)!
    if (type.kind !== 'Array') throw new Error('a comprehension gives an array')
    const result = emit_array_new(this.ir, type.element)
    this.generate_iteration(iterable, variable, () => {
      const push_label = this.ir.fresh_label('comprehension.push')
      const next_label = this.ir.fresh_label('comprehension.next')
      const test = guard === undefined ? 'true' : this.expressions.generate_condition(guard)
      this.ir.emit(`br i1 ${test}, label %${push_label}, label %${next_label}`)
      this.ir.start_block(push_label)
      const value = this.expressions.generate(element)
      emit_push(this.ir, result, value, type.element)
      this.expressions.release_if_reference(element, value)
      this.ir.emit(`br label %${next_label}`)
      this.ir.start_block(next_label)
    })
    return result
  }

  // The source is evaluated first, then the closures, which capture the values they see then.
  private generate_iter_comprehension(
    iterable: Expression,
    lazy: NonNullable<Comprehension['lazy']>,
  ): string {
    const source =
      iterable.kind === 'range'
        ? emit_range_iter(
            this.ir,
            this.expressions.generate(iterable.start),
            this.expressions.generate(iterable.end),
          )
        : emit_source_iter(this.ir, this.expressions.generate(iterable), this.types.get(iterable)!)
    const item = iterable.kind === 'range' ? int_type : iterable_item(this.types.get(iterable)!)!
    const guard = lazy.guard && this.blocks.generate_closure(lazy.guard)
    const element = {
      closure: this.blocks.generate_closure(lazy.element),
      type: this.types.get(lazy.element)!,
    }
    return emit_comprehension_iter(this.ir, source, item, guard, element)
  }

  // The body is a block, or, for a comprehension, a function that generates it in the loop's scope.
  private generate_iteration(
    iterable: Expression,
    variable: Identifier,
    body: Statement[] | (() => void),
  ): void {
    if (iterable.kind === 'range') {
      const start = this.expressions.generate(iterable.start)
      const end = this.expressions.generate(iterable.end)
      this.generate_counting_loop(
        start,
        () => end,
        body,
        (scope, current) =>
          scope.set(variable.name, { kind: 'value', operand: current, type: int_type }),
      )
      return
    }
    const type = this.types.get(iterable)!
    if (type.kind === 'Iter') return this.generate_iter_loop(iterable, type, variable, body)
    if (type.kind !== 'Array') throw new Error('only ranges, arrays and Iters can be iterated')
    const array_scope = this.locals.push()
    const array = this.expressions.generate(iterable)
    array_scope.set(' iterated array', this.blocks.store_in_slot(array, type))
    this.generate_counting_loop(
      '0',
      () => emit_length(this.ir, array),
      body,
      (scope, current) => {
        const item = emit_get(this.ir, array, current, type.element)
        scope.set(variable.name, this.blocks.store_in_slot(item, type.element))
      },
    )
    this.blocks.release_scope(array_scope)
    this.locals.pop()
  }

  private generate_iter_loop(
    iterable: Expression,
    type: Type,
    variable: Identifier,
    body: Statement[] | (() => void),
  ): void {
    const item = iterable_item(type)!
    const iter_scope = this.locals.push()
    const iter = this.expressions.generate(iterable)
    iter_scope.set(' iterated Iter', this.blocks.store_in_slot(iter, type))
    emit_iter_start(this.ir, iter)
    emit_iter_loop(this.ir, iter, item, (value, exit_label, next_label) =>
      this.generate_loop_body(body, exit_label, next_label, (scope) =>
        scope.set(variable.name, this.blocks.store_in_slot(value, item)),
      ),
    )
    this.blocks.release_scope(iter_scope)
    this.locals.pop()
  }

  // Counts from start while the counter is below the end, which is evaluated in the header. The
  // counter is a phi in the header, incremented in the latch block; it cannot overflow there,
  // since it is below the end.
  private generate_counting_loop(
    start: string,
    end: () => string,
    body: Statement[] | (() => void),
    define: (scope: Scope<CodegenLocal>, current: string) => void,
  ): void {
    const preheader_label = this.ir.current_block
    const header_label = this.ir.fresh_label('for.header')
    const body_label = this.ir.fresh_label('for.body')
    const latch_label = this.ir.fresh_label('for.latch')
    const exit_label = this.ir.fresh_label('for.exit')
    const next = this.ir.fresh_register()
    this.ir.emit(`br label %${header_label}`)

    this.ir.start_block(header_label)
    const current = this.ir.assign(
      `phi i64 [ ${start}, %${preheader_label} ], [ ${next}, %${latch_label} ]`,
    )
    const in_range = this.ir.assign(`icmp slt i64 ${current}, ${end()}`)
    this.ir.emit(`br i1 ${in_range}, label %${body_label}, label %${exit_label}`)

    this.ir.start_block(body_label)
    this.generate_loop_body(body, exit_label, latch_label, (scope) => define(scope, current))
    this.ir.emit(`br label %${latch_label}`)

    this.ir.start_block(latch_label)
    this.ir.assign_to(next, `add nsw i64 ${current}, 1`)
    this.ir.emit(`br label %${header_label}`)

    this.ir.start_block(exit_label)
  }

  private generate_loop_body(
    body: Statement[] | (() => void),
    break_label: string,
    continue_label: string,
    define?: (scope: Scope<CodegenLocal>) => void,
  ): void {
    this.loops.push({ break_label, continue_label, scope_depth: this.locals.depth })
    this.blocks.generate_block(body, define)
    this.loops.pop()
  }

  // Leaving the loop's scopes early releases their references, as their ends would. Code after the
  // jump is unreachable but still needs a block to go in.
  generate_jump(jump: Jump): void {
    const loop = this.loops.at(-1)!
    for (const scope of this.locals.inner_scopes(loop.scope_depth)) this.blocks.release_scope(scope)
    const target = jump.kind === 'break' ? loop.break_label : loop.continue_label
    this.ir.emit(`br label %${target}`)
    this.ir.start_block(this.ir.fresh_label('unreachable'))
  }
}
