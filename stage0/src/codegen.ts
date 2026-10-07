import type { Binary, Call, Case, ComparisonOperator, Expression, Program, Unary } from './ast.ts'
import { builtins } from './builtins.ts'
import type { Types } from './checker.ts'
import { IrBuilder } from './ir_builder.ts'
import type { Type } from './types.ts'

// Emits LLVM IR for a checked program: its top-level code becomes lerta_main.
export const generate = (program: Program, types: Types): string =>
  new Generator(types).generate(program)

const LERTA_IMMORTAL = '-9223372036854775808'
const INT_MIN = '-9223372036854775808'

const ir_type = (type: Type): string => {
  switch (type.kind) {
    case 'String':
      return 'ptr'
    case 'Int':
      return 'i64'
    case 'Bool':
      return 'i1'
    default:
      throw new Error(`no IR type for ${type.kind}`)
  }
}

// A C `bool` parameter expects its argument zero-extended.
const ir_param_type = (type: Type): string => (type.kind === 'Bool' ? 'i1 zeroext' : ir_type(type))

const comparison_predicates: Record<ComparisonOperator, string> = {
  '==': 'eq',
  '!=': 'ne',
  '<': 'slt',
  '<=': 'sle',
  '>': 'sgt',
  '>=': 'sge',
}

const overflow_intrinsics = { '+': 'sadd', '-': 'ssub', '*': 'smul' } as const

// Bytes other than printable ASCII, '"' and '\' are written as \XX in IR strings.
const ir_string_bytes = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => {
    const is_plain = b >= 0x20 && b <= 0x7e && b !== 0x22 && b !== 0x5c
    return is_plain ? String.fromCharCode(b) : `\\${b.toString(16).toUpperCase().padStart(2, '0')}`
  }).join('')

// Exceptions raised by the generated code itself; each has one shared block that throws it.
const exceptions = {
  overflow: 'integer overflow',
  division_by_zero: 'division by zero',
} as const
type Exception = keyof typeof exceptions

class Generator {
  private readonly types: Types
  private readonly ir = new IrBuilder()
  private readonly thrown = new Set<Exception>()

  constructor(types: Types) {
    this.types = types
  }

  generate(program: Program): string {
    for (const statement of program) this.generate_expression(statement)
    this.ir.emit('ret void')
    for (const exception of this.thrown) this.generate_throw_block(exception)
    return this.ir.render('void @lerta_main()')
  }

  // Returns the IR operand holding the value; void calls return ''.
  private generate_expression(expression: Expression): string {
    switch (expression.kind) {
      case 'string':
        return this.string_constant(expression.value)
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
        throw new Error('function values are not supported')
    }
  }

  private generate_call(call: Call): string {
    if (call.callee.kind !== 'identifier') throw new Error('only builtins can be called')
    const arg_types = call.args.map((arg) => this.types.get(arg)!)
    const symbol = builtins.get(call.callee.name)!.runtime_symbol(arg_types)
    const params = arg_types.map(ir_param_type).join(', ')
    this.ir.declare(symbol, `declare void @${symbol}(${params})`)
    const args = call.args.map(
      (arg, i) => `${ir_type(arg_types[i])} ${this.generate_expression(arg)}`,
    )
    this.ir.emit(`call void @${symbol}(${args.join(', ')})`)
    return ''
  }

  private generate_unary(unary: Unary): string {
    const operand = this.generate_expression(unary.operand)
    return this.checked_arithmetic('-', '0', operand)
  }

  private generate_binary(binary: Binary): string {
    const left = this.generate_expression(binary.left)
    const right = this.generate_expression(binary.right)
    const { operator } = binary
    if (operator === '/' || operator === '%') return this.checked_division(operator, left, right)
    if (operator === '+' || operator === '-' || operator === '*') {
      return this.checked_arithmetic(operator, left, right)
    }
    const operand_type = ir_type(this.types.get(binary.left)!)
    return this.ir.assign(
      `icmp ${comparison_predicates[operator]} ${operand_type} ${left}, ${right}`,
    )
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

  private checked_arithmetic(operator: '+' | '-' | '*', left: string, right: string): string {
    const intrinsic = `llvm.${overflow_intrinsics[operator]}.with.overflow.i64`
    this.ir.declare(intrinsic, `declare { i64, i1 } @${intrinsic}(i64, i64)`)
    const result = this.ir.assign(`call { i64, i1 } @${intrinsic}(i64 ${left}, i64 ${right})`)
    const overflowed = this.ir.assign(`extractvalue { i64, i1 } ${result}, 1`)
    this.throw_if(overflowed, 'overflow')
    return this.ir.assign(`extractvalue { i64, i1 } ${result}, 0`)
  }

  // INT_MIN / -1 overflows; INT_MIN % -1 is rejected too, since LLVM leaves it undefined.
  private checked_division(operator: '/' | '%', left: string, right: string): string {
    const is_zero = this.ir.assign(`icmp eq i64 ${right}, 0`)
    this.throw_if(is_zero, 'division_by_zero')
    const is_min = this.ir.assign(`icmp eq i64 ${left}, ${INT_MIN}`)
    const is_minus_one = this.ir.assign(`icmp eq i64 ${right}, -1`)
    const overflows = this.ir.assign(`and i1 ${is_min}, ${is_minus_one}`)
    this.throw_if(overflows, 'overflow')
    const instruction = operator === '/' ? 'sdiv' : 'srem'
    return this.ir.assign(`${instruction} i64 ${left}, ${right}`)
  }

  private throw_if(condition: string, exception: Exception): void {
    this.thrown.add(exception)
    const continue_label = this.ir.fresh_label('continue')
    this.ir.emit(`br i1 ${condition}, label %throw.${exception}, label %${continue_label}`)
    this.ir.start_block(continue_label)
  }

  private generate_throw_block(exception: Exception): void {
    this.ir.declare('lerta_throw', 'declare void @lerta_throw(ptr) noreturn')
    const message = this.string_constant(exceptions[exception])
    this.ir.start_block(`throw.${exception}`)
    this.ir.emit(`call void @lerta_throw(ptr ${message})`)
    this.ir.emit('unreachable')
  }

  // An immortal LertaString (see runtime/lerta.h) holding the literal's bytes.
  private string_constant(value: string): string {
    const bytes = new TextEncoder().encode(value)
    const bytes_type = `[${bytes.length} x i8]`
    const type = `{ i64, i64, ${bytes_type} }`
    const bytes_init = `${bytes_type} c"${ir_string_bytes(bytes)}"`
    const init = `{ i64 ${LERTA_IMMORTAL}, i64 ${bytes.length}, ${bytes_init} }`
    return this.ir.global('lerta.string', `private unnamed_addr constant ${type} ${init}`)
  }
}
