import type {
  Assignment,
  Binary,
  Call,
  Case,
  ComparisonOperator,
  Declaration,
  Expression,
  For,
  Identifier,
  If,
  Jump,
  Member,
  Program,
  Statement,
  Unary,
  While,
} from './ast.ts'
import { builtins } from './builtins.ts'
import type { Types } from './checker.ts'
import { CheckedInt } from './checked_int.ts'
import { IrBuilder } from './ir_builder.ts'
import { ir_param_type, ir_type, string_constant } from './lerta_ir.ts'
import { is_reference_type, type Type } from './types.ts'

// Emits LLVM IR for a checked program: its top-level code becomes lerta_main.
export const generate = (program: Program, types: Types): string =>
  new Generator(types).generate(program)

const comparison_predicates: Record<ComparisonOperator, string> = {
  '==': 'eq',
  '!=': 'ne',
  '<': 'slt',
  '<=': 'sle',
  '>': 'sgt',
  '>=': 'sge',
}

// A loop variable is an SSA value; a `const` or `var` lives in a stack slot.
type Local = { kind: 'value'; operand: string } | { kind: 'slot'; pointer: string; type: Type }
type Scope = Map<string, Local>
// Where `break` and `continue` jump, and how many scopes enclose the loop.
type Loop = { break_label: string; continue_label: string; scope_depth: number }

class Generator {
  private readonly types: Types
  private readonly ir = new IrBuilder()
  private readonly checked_int = new CheckedInt(this.ir)
  private readonly scopes: Scope[] = []
  private readonly loops: Loop[] = []

  constructor(types: Types) {
    this.types = types
  }

  generate(program: Program): string {
    this.generate_block(program)
    this.ir.emit('ret void')
    this.checked_int.emit_throw_blocks()
    return this.ir.render('void @lerta_main()')
  }

  // A block is a scope: the references held by its locals are released at its end.
  private generate_block(statements: Statement[], define = (_scope: Scope) => {}): void {
    const scope: Scope = new Map()
    this.scopes.push(scope)
    define(scope)
    for (const statement of statements) this.generate_statement(statement)
    this.release_scope(scope)
    this.scopes.pop()
  }

  private release_scope(scope: Scope): void {
    for (const local of scope.values()) {
      if (local.kind === 'slot' && is_reference_type(local.type)) {
        this.release(this.ir.assign(`load ptr, ptr ${local.pointer}`))
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
        return this.release_if_reference(statement, this.generate_expression(statement))
    }
  }

  private generate_declaration(declaration: Declaration): void {
    const type = this.types.get(declaration.value)!
    const value = this.generate_expression(declaration.value)
    const pointer = this.ir.alloca(ir_type(type))
    this.ir.emit(`store ${ir_type(type)} ${value}, ptr ${pointer}`)
    this.scopes.at(-1)!.set(declaration.name.name, { kind: 'slot', pointer, type })
  }

  // The new value is stored before the old one is released, which is safe even if they are the
  // same object.
  private generate_assignment(assignment: Assignment): void {
    const local = this.lookup(assignment.target.name)
    if (local.kind !== 'slot') throw new Error('only slots can be assigned')
    const type = ir_type(local.type)
    const old = this.ir.assign(`load ${type}, ptr ${local.pointer}`)
    const value = this.generate_expression(assignment.value)
    const { operator } = assignment
    const result =
      operator === '='
        ? value
        : operator === '/=' || operator === '%='
          ? this.checked_int.division(operator[0] as '/' | '%', old, value)
          : this.checked_int.arithmetic(operator[0] as '+' | '-' | '*', old, value)
    this.ir.emit(`store ${type} ${result}, ptr ${local.pointer}`)
    if (is_reference_type(local.type)) this.release(old)
  }

  private generate_if(if_statement: If): void {
    const condition = this.generate_expression(if_statement.condition)
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
    const condition = this.generate_expression(while_statement.condition)
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
    const start = this.generate_expression(iterable.start)
    const end = this.generate_expression(iterable.end)
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
    define?: (scope: Scope) => void,
  ): void {
    this.loops.push({ break_label, continue_label, scope_depth: this.scopes.length })
    this.generate_block(body, define)
    this.loops.pop()
  }

  // Leaving the loop's scopes early releases their references, as their ends would. Code after the
  // jump is unreachable but still needs a block to go in.
  private generate_jump(jump: Jump): void {
    const loop = this.loops.at(-1)!
    for (const scope of this.scopes.slice(loop.scope_depth).toReversed()) this.release_scope(scope)
    const target = jump.kind === 'break' ? loop.break_label : loop.continue_label
    this.ir.emit(`br label %${target}`)
    this.ir.start_block(this.ir.fresh_label('unreachable'))
  }

  private lookup(name: string): Local {
    for (const scope of this.scopes.toReversed()) {
      const local = scope.get(name)
      if (local !== undefined) return local
    }
    throw new Error(`no local named ${name}`)
  }

  // Reading a reference from a slot retains it, since every expression yields an owned reference.
  private generate_identifier(identifier: Identifier): string {
    const local = this.lookup(identifier.name)
    if (local.kind === 'value') return local.operand
    const value = this.ir.assign(`load ${ir_type(local.type)}, ptr ${local.pointer}`)
    if (is_reference_type(local.type)) {
      this.ir.declare('lerta_retain', 'declare void @lerta_retain(ptr)')
      this.ir.emit(`call void @lerta_retain(ptr ${value})`)
    }
    return value
  }

  // Returns the IR operand holding the value; void calls return ''.
  private generate_expression(expression: Expression): string {
    switch (expression.kind) {
      case 'string':
        return string_constant(this.ir, expression.value)
      case 'integer':
        return expression.value.toString()
      case 'boolean':
        return expression.value ? 'true' : 'false'
      case 'call':
        return this.generate_call(expression)
      case 'unary':
        return this.generate_unary(expression)
      case 'binary':
        return this.generate_binary(expression)
      case 'case':
        return this.generate_case(expression)
      case 'identifier':
        return this.generate_identifier(expression)
      case 'range':
        throw new Error('ranges are only generated by for')
      case 'member':
        throw new Error('members are only generated as method calls')
    }
  }

  // Arguments are borrowed: the caller releases its temporaries after the call.
  private generate_call(call: Call): string {
    const { callee } = call
    if (callee.kind === 'member') return this.generate_method_call(callee)
    if (callee.kind !== 'identifier') throw new Error('only builtins can be called')
    const arg_types = call.args.map((arg) => this.types.get(arg)!)
    const symbol = builtins.get(callee.name)!.runtime_symbol(arg_types)
    const params = arg_types.map(ir_param_type).join(', ')
    this.ir.declare(symbol, `declare void @${symbol}(${params})`)
    const operands = call.args.map((arg) => this.generate_expression(arg))
    const args = operands.map((operand, i) => `${ir_type(arg_types[i])} ${operand}`)
    this.ir.emit(`call void @${symbol}(${args.join(', ')})`)
    call.args.forEach((arg, i) => this.release_if_reference(arg, operands[i]))
    return ''
  }

  // `to_string()` is the only method so far. A String returns itself, passing on its ownership.
  private generate_method_call(member: Member): string {
    const object = this.generate_expression(member.object)
    switch (this.types.get(member.object)!.kind) {
      case 'String':
        return object
      case 'Int':
        this.ir.declare('lerta_int_to_string', 'declare ptr @lerta_int_to_string(i64)')
        return this.ir.assign(`call ptr @lerta_int_to_string(i64 ${object})`)
      case 'Bool': {
        const true_text = string_constant(this.ir, 'true')
        const false_text = string_constant(this.ir, 'false')
        return this.ir.assign(`select i1 ${object}, ptr ${true_text}, ptr ${false_text}`)
      }
      default:
        throw new Error('no to_string for this type')
    }
  }

  // Every expression of a reference type yields an owned reference, which its consumer releases.
  private release_if_reference(expression: Expression, operand: string): void {
    const type = this.types.get(expression)
    if (type !== undefined && is_reference_type(type)) this.release(operand)
  }

  private release(operand: string): void {
    this.ir.declare('lerta_release', 'declare void @lerta_release(ptr)')
    this.ir.emit(`call void @lerta_release(ptr ${operand})`)
  }

  private generate_unary(unary: Unary): string {
    const operand = this.generate_expression(unary.operand)
    if (unary.operator === 'not') return this.ir.assign(`xor i1 ${operand}, true`)
    return this.checked_int.arithmetic('-', '0', operand)
  }

  private generate_binary(binary: Binary): string {
    if (binary.operator === 'and' || binary.operator === 'or') return this.generate_logical(binary)
    const left = this.generate_expression(binary.left)
    const right = this.generate_expression(binary.right)
    const { operator } = binary
    if (operator === '/' || operator === '%') {
      return this.checked_int.division(operator, left, right)
    }
    if (operator === '+' || operator === '-' || operator === '*') {
      return this.checked_int.arithmetic(operator, left, right)
    }
    const operand_type = ir_type(this.types.get(binary.left)!)
    return this.ir.assign(
      `icmp ${comparison_predicates[operator]} ${operand_type} ${left}, ${right}`,
    )
  }

  // Short-circuit: the right operand is evaluated only when the left one does not decide.
  private generate_logical(binary: Binary): string {
    const left = this.generate_expression(binary.left)
    const left_block = this.ir.current_block
    const right_label = this.ir.fresh_label('logical.right')
    const end_label = this.ir.fresh_label('logical.end')
    const is_and = binary.operator === 'and'
    const [if_true, if_false] = is_and ? [right_label, end_label] : [end_label, right_label]
    this.ir.emit(`br i1 ${left}, label %${if_true}, label %${if_false}`)
    this.ir.start_block(right_label)
    const right = this.generate_expression(binary.right)
    const right_block = this.ir.current_block
    this.ir.emit(`br label %${end_label}`)
    this.ir.start_block(end_label)
    const decided = is_and ? 'false' : 'true'
    return this.ir.assign(`phi i1 [ ${decided}, %${left_block} ], [ ${right}, %${right_block} ]`)
  }

  // Tests the conditions in order; every arm jumps to one end block that merges the values.
  private generate_case(case_expression: Case): string {
    const end_label = this.ir.fresh_label('case.end')
    const incoming: string[] = []
    const generate_arm_value = (value: Expression) => {
      const operand = this.generate_expression(value)
      incoming.push(`[ ${operand}, %${this.ir.current_block} ]`)
      this.ir.emit(`br label %${end_label}`)
    }
    for (const arm of case_expression.arms) {
      const condition = this.generate_expression(arm.condition)
      const arm_label = this.ir.fresh_label('case.arm')
      const next_label = this.ir.fresh_label('case.next')
      this.ir.emit(`br i1 ${condition}, label %${arm_label}, label %${next_label}`)
      this.ir.start_block(arm_label)
      generate_arm_value(arm.value)
      this.ir.start_block(next_label)
    }
    generate_arm_value(case_expression.otherwise)
    this.ir.start_block(end_label)
    const type = this.types.get(case_expression)!
    if (type.kind === 'void') return ''
    return this.ir.assign(`phi ${ir_type(type)} ${incoming.join(', ')}`)
  }
}
