import {
  is_expression,
  type Assignment,
  type AssignmentOperator,
  type Declaration,
  type For,
  type FunctionLiteral,
  type If,
  type Index,
  type Jump,
  type Program,
  type Return,
  type Statement,
  type While,
} from './ast.ts'
import type { Types } from './checker.ts'
import { emit_get, emit_length, emit_set } from './array_codegen.ts'
import { CheckedInt } from './checked_int.ts'
import { ExpressionGenerator, type CodegenLocal } from './expression_codegen.ts'
import { IrBuilder, IrModule } from './ir_builder.ts'
import { emit_release, function_symbol, ir_return_type, ir_type } from './lerta_ir.ts'
import { Scopes, type Scope } from './scopes.ts'
import { int_type, is_reference_type, type Type } from './types.ts'

type FunctionDeclaration = Declaration & { value: FunctionLiteral }

const is_function_declaration = (statement: Statement): statement is FunctionDeclaration =>
  statement.kind === 'declaration' && statement.value.kind === 'function'

// Emits LLVM IR for a checked program: its top-level code becomes lerta_main, and each top-level
// function a function of its own.
export const generate = (program: Program, types: Types): string => {
  const module = new IrModule()
  const functions = program.filter(is_function_declaration)
  const function_names = new Set(functions.map((declaration) => declaration.name.name))
  const new_generator = () => new FunctionGenerator(module, types, function_names)
  new_generator().generate_main(program.filter((statement) => !is_function_declaration(statement)))
  for (const declaration of functions) {
    new_generator().generate_function(declaration.name.name, declaration.value)
  }
  return module.render()
}

// Where `break` and `continue` jump, and how many scopes enclose the loop.
type Loop = { break_label: string; continue_label: string; scope_depth: number }

class FunctionGenerator {
  private readonly types: Types
  private readonly ir: IrBuilder
  private readonly locals = new Scopes<CodegenLocal>()
  private readonly checked_int: CheckedInt
  private readonly expressions: ExpressionGenerator
  private readonly loops: Loop[] = []

  constructor(module: IrModule, types: Types, function_names: Set<string>) {
    this.types = types
    this.ir = new IrBuilder(module)
    this.checked_int = new CheckedInt(this.ir)
    this.expressions = new ExpressionGenerator(
      this.ir,
      types,
      this.checked_int,
      this.locals,
      function_names,
    )
  }

  generate_main(statements: Statement[]): void {
    this.generate_block(statements)
    this.ir.emit('ret void')
    this.finish('void @lerta_main()')
  }

  // Parameters are borrowed SSA values. The last statement, if an expression, gives the result.
  generate_function(name: string, literal: FunctionLiteral): void {
    const type = this.types.get(literal)!
    if (type.kind !== 'function') throw new Error('a function literal has a function type')
    const params = literal.params.map((param, i) => ({
      name: param.name.name,
      type: type.params[i],
    }))
    const scope = this.locals.push()
    for (const [i, param] of params.entries()) {
      scope.set(param.name, { kind: 'value', operand: `%p${i}`, type: param.type })
    }
    const last = literal.body.at(-1)
    for (const statement of literal.body.slice(0, -1)) this.generate_statement(statement)
    if (last !== undefined && is_expression(last) && type.result.kind !== 'void') {
      this.emit_return(type.result, this.expressions.generate(last))
    } else {
      if (last !== undefined) this.generate_statement(last)
      if (type.result.kind === 'void') this.emit_return(type.result, '')
      else this.ir.emit('unreachable')
    }
    this.locals.pop()
    const param_list = params.map((param, i) => `${ir_type(param.type)} %p${i}`).join(', ')
    this.finish(`${ir_return_type(type.result)} ${function_symbol(name)}(${param_list})`)
  }

  private finish(signature: string): void {
    this.checked_int.emit_throw_blocks()
    this.ir.finish(signature)
  }

  // Releases every scope of the function before returning the owned value.
  private emit_return(type: Type, value: string): void {
    for (const scope of this.locals.inner_scopes(0)) this.release_scope(scope)
    this.ir.emit(type.kind === 'void' ? 'ret void' : `ret ${ir_type(type)} ${value}`)
  }

  private generate_return(return_statement: Return): void {
    const { value } = return_statement
    const type = value === undefined ? undefined : this.types.get(value)!
    const operand = value === undefined ? '' : this.expressions.generate(value)
    this.emit_return(type ?? { kind: 'void' }, operand)
    this.ir.start_block(this.ir.fresh_label('unreachable'))
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
      case 'return':
        return this.generate_return(statement)
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
    const { target } = assignment
    if (target.kind === 'index') return this.generate_index_assignment(assignment, target)
    const local = this.locals.lookup(target.name)!
    if (local.kind !== 'slot') throw new Error('only slots can be assigned')
    const type = ir_type(local.type)
    const old = this.ir.assign(`load ${type}, ptr ${local.pointer}`)
    const value = this.expressions.generate(assignment.value)
    const result = this.combine(assignment.operator, old, value, local.type)
    this.ir.emit(`store ${type} ${result}, ptr ${local.pointer}`)
    if (is_reference_type(local.type)) emit_release(this.ir, old)
  }

  // The array retains the new item and releases the old one.
  private generate_index_assignment(assignment: Assignment, target: Index): void {
    const element = this.types.get(target)!
    const array = this.expressions.generate(target.object)
    const index = this.expressions.generate(target.index)
    const old = assignment.operator === '=' ? '' : emit_get(this.ir, array, index, element)
    const value = this.expressions.generate(assignment.value)
    const result = this.combine(assignment.operator, old, value, element)
    emit_set(this.ir, array, index, result, element)
    if (is_reference_type(element)) emit_release(this.ir, result)
    emit_release(this.ir, array)
  }

  // The value to store: the new one for `=`, or the old one combined with it for `+=` and so on.
  private combine(operator: AssignmentOperator, old: string, value: string, type: Type): string {
    if (operator === '=') return value
    return this.checked_int.apply(operator[0] as '+' | '-' | '*' | '/' | '%', old, value, type)
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

  // A range's bounds are evaluated once. An array is held for the whole loop in a scope of its
  // own, so a `return` from the body releases it too; its length is read each round.
  private generate_for(for_statement: For): void {
    const { iterable, variable, body } = for_statement
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
    if (type.kind !== 'Array') throw new Error('only ranges and arrays can be iterated')
    const array_scope = this.locals.push()
    const array = this.expressions.generate(iterable)
    array_scope.set(' iterated array', this.store_in_slot(array, type))
    this.generate_counting_loop(
      '0',
      () => emit_length(this.ir, array),
      body,
      (scope, current) => {
        const item = emit_get(this.ir, array, current, type.element)
        scope.set(variable.name, this.store_in_slot(item, type.element))
      },
    )
    this.release_scope(array_scope)
    this.locals.pop()
  }

  private store_in_slot(value: string, type: Type): CodegenLocal {
    const pointer = this.ir.alloca(ir_type(type))
    this.ir.emit(`store ${ir_type(type)} ${value}, ptr ${pointer}`)
    return { kind: 'slot', pointer, type }
  }

  // Counts from start while the counter is below the end, which is evaluated in the header. The
  // counter is a phi in the header, incremented in the latch block; it cannot overflow there,
  // since it is below the end.
  private generate_counting_loop(
    start: string,
    end: () => string,
    body: Statement[],
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
