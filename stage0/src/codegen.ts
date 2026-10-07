import type { Assignment, Declaration, For, If, Jump, Program, Statement, While } from './ast.ts'
import type { Types } from './checker.ts'
import { CheckedInt } from './checked_int.ts'
import { ExpressionGenerator, type CodegenLocal } from './expression_codegen.ts'
import { IrBuilder } from './ir_builder.ts'
import { emit_release, ir_type } from './lerta_ir.ts'
import { Scopes, type Scope } from './scopes.ts'
import { is_reference_type } from './types.ts'

// Emits LLVM IR for a checked program: its top-level code becomes lerta_main.
export const generate = (program: Program, types: Types): string =>
  new Generator(types).generate(program)

// Where `break` and `continue` jump, and how many scopes enclose the loop.
type Loop = { break_label: string; continue_label: string; scope_depth: number }

class Generator {
  private readonly types: Types
  private readonly ir = new IrBuilder()
  private readonly locals = new Scopes<CodegenLocal>()
  private readonly checked_int = new CheckedInt(this.ir)
  private readonly expressions: ExpressionGenerator
  private readonly loops: Loop[] = []

  constructor(types: Types) {
    this.types = types
    this.expressions = new ExpressionGenerator(this.ir, types, this.checked_int, this.locals)
  }

  generate(program: Program): string {
    this.generate_block(program)
    this.ir.emit('ret void')
    this.checked_int.emit_throw_blocks()
    return this.ir.render('void @lerta_main()')
  }

  // A block is a scope: the references held by its locals are released at its end.
  private generate_block(
    statements: Statement[],
    define = (_scope: Scope<CodegenLocal>) => {},
  ): void {
    const scope = this.locals.push()
    define(scope)
    for (const statement of statements) this.generate_statement(statement)
    this.release_scope(scope)
    this.locals.pop()
  }

  private release_scope(scope: Scope<CodegenLocal>): void {
    for (const local of scope.values()) {
      if (local.kind === 'slot' && is_reference_type(local.type)) {
        emit_release(this.ir, this.ir.assign(`load ptr, ptr ${local.pointer}`))
      }
    }
  }

  private generate_statement(statement: Statement): void {
    switch (statement.kind) {
      case 'for':
        return this.generate_for(statement)
      case 'while':
        return this.generate_while(statement)
      case 'if':
        return this.generate_if(statement)
      case 'declaration':
        return this.generate_declaration(statement)
      case 'assignment':
        return this.generate_assignment(statement)
      case 'break':
      case 'continue':
        return this.generate_jump(statement)
      default:
        return this.expressions.release_if_reference(
          statement,
          this.expressions.generate(statement),
        )
    }
  }

  private generate_declaration(declaration: Declaration): void {
    const type = this.types.get(declaration.value)!
    const value = this.expressions.generate(declaration.value)
    const pointer = this.ir.alloca(ir_type(type))
    this.ir.emit(`store ${ir_type(type)} ${value}, ptr ${pointer}`)
    this.locals.define(declaration.name.name, { kind: 'slot', pointer, type })
  }

  // The new value is stored before the old one is released, which is safe even if they are the
  // same object.
  private generate_assignment(assignment: Assignment): void {
    const local = this.locals.lookup(assignment.target.name)!
    if (local.kind !== 'slot') throw new Error('only slots can be assigned')
    const type = ir_type(local.type)
    const old = this.ir.assign(`load ${type}, ptr ${local.pointer}`)
    const value = this.expressions.generate(assignment.value)
    const { operator } = assignment
    const result =
      operator === '='
        ? value
        : operator === '/=' || operator === '%='
          ? this.checked_int.division(operator[0] as '/' | '%', old, value)
          : this.checked_int.arithmetic(operator[0] as '+' | '-' | '*', old, value)
    this.ir.emit(`store ${type} ${result}, ptr ${local.pointer}`)
    if (is_reference_type(local.type)) emit_release(this.ir, old)
  }

  private generate_if(if_statement: If): void {
    const condition = this.expressions.generate(if_statement.condition)
    const then_label = this.ir.fresh_label('if.then')
    const else_label = this.ir.fresh_label('if.else')
    const end_label = this.ir.fresh_label('if.end')
    this.ir.emit(`br i1 ${condition}, label %${then_label}, label %${else_label}`)
    this.ir.start_block(then_label)
    this.generate_block(if_statement.then_body)
    this.ir.emit(`br label %${end_label}`)
    this.ir.start_block(else_label)
    this.generate_block(if_statement.else_body)
    this.ir.emit(`br label %${end_label}`)
    this.ir.start_block(end_label)
  }

  private generate_while(while_statement: While): void {
    const header_label = this.ir.fresh_label('while.header')
    const body_label = this.ir.fresh_label('while.body')
    const exit_label = this.ir.fresh_label('while.exit')
    this.ir.emit(`br label %${header_label}`)
    this.ir.start_block(header_label)
    const condition = this.expressions.generate(while_statement.condition)
    this.ir.emit(`br i1 ${condition}, label %${body_label}, label %${exit_label}`)
    this.ir.start_block(body_label)
    this.generate_loop_body(while_statement.body, exit_label, header_label)
    this.ir.emit(`br label %${header_label}`)
    this.ir.start_block(exit_label)
  }

  // The bounds are evaluated once. The variable is a phi in the header; it is incremented in the
  // latch block, which cannot overflow since it is less than the end there.
  private generate_for(for_statement: For): void {
    const { iterable, variable } = for_statement
    if (iterable.kind !== 'range') throw new Error('only ranges can be iterated')
    const start = this.expressions.generate(iterable.start)
    const end = this.expressions.generate(iterable.end)
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
    const in_range = this.ir.assign(`icmp slt i64 ${current}, ${end}`)
    this.ir.emit(`br i1 ${in_range}, label %${body_label}, label %${exit_label}`)

    this.ir.start_block(body_label)
    this.generate_loop_body(for_statement.body, exit_label, latch_label, (scope) =>
      scope.set(variable.name, { kind: 'value', operand: current }),
    )
    this.ir.emit(`br label %${latch_label}`)

    this.ir.start_block(latch_label)
    this.ir.assign_to(next, `add nsw i64 ${current}, 1`)
    this.ir.emit(`br label %${header_label}`)

    this.ir.start_block(exit_label)
  }

  private generate_loop_body(
    body: Statement[],
    break_label: string,
    continue_label: string,
    define?: (scope: Scope<CodegenLocal>) => void,
  ): void {
    this.loops.push({ break_label, continue_label, scope_depth: this.locals.depth })
    this.generate_block(body, define)
    this.loops.pop()
  }

  // Leaving the loop's scopes early releases their references, as their ends would. Code after the
  // jump is unreachable but still needs a block to go in.
  private generate_jump(jump: Jump): void {
    const loop = this.loops.at(-1)!
    for (const scope of this.locals.inner_scopes(loop.scope_depth)) this.release_scope(scope)
    const target = jump.kind === 'break' ? loop.break_label : loop.continue_label
    this.ir.emit(`br label %${target}`)
    this.ir.start_block(this.ir.fresh_label('unreachable'))
  }
}
