import type { Binary, Call, Expression, Program, Unary } from './ast.ts'
import { builtins } from './builtins.ts'
import type { Types } from './checker.ts'
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
    default:
      throw new Error(`no IR type for ${type.kind}`)
  }
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
  private readonly globals: string[] = []
  private readonly declarations = new Map<string, string>()
  private readonly body: string[] = []
  private readonly thrown = new Set<Exception>()
  private register_count = 0
  private label_count = 0

  constructor(types: Types) {
    this.types = types
  }

  generate(program: Program): string {
    for (const statement of program) this.generate_expression(statement)
    this.body.push('  ret void')
    for (const exception of this.thrown) this.generate_throw_block(exception)
    const main = ['define void @lerta_main() {', 'entry:', ...this.body, '}']
    return [...this.globals, ...this.declarations.values(), ...main].join('\n') + '\n'
  }

  // Returns the IR operand holding the value; void calls return ''.
  private generate_expression(expression: Expression): string {
    switch (expression.kind) {
      case 'string':
        return this.string_constant(expression.value)
      case 'integer':
        return expression.value.toString()
      case 'call':
        return this.generate_call(expression)
      case 'unary':
        return this.generate_unary(expression)
      case 'binary':
        return this.generate_binary(expression)
      case 'identifier':
        throw new Error('function values are not supported')
    }
  }

  private generate_call(call: Call): string {
    if (call.callee.kind !== 'identifier') throw new Error('only builtins can be called')
    const arg_types = call.args.map((arg) => this.types.get(arg)!)
    const symbol = builtins.get(call.callee.name)!.runtime_symbol(arg_types)
    const param_ir_types = arg_types.map(ir_type)
    this.add_declaration(symbol, `declare void @${symbol}(${param_ir_types.join(', ')})`)
    const args = call.args.map((arg, i) => `${param_ir_types[i]} ${this.generate_expression(arg)}`)
    this.body.push(`  call void @${symbol}(${args.join(', ')})`)
    return ''
  }

  private generate_unary(unary: Unary): string {
    const operand = this.generate_expression(unary.operand)
    return this.checked_arithmetic('-', '0', operand)
  }

  private generate_binary(binary: Binary): string {
    const left = this.generate_expression(binary.left)
    const right = this.generate_expression(binary.right)
    if (binary.operator === '/' || binary.operator === '%') {
      return this.checked_division(binary.operator, left, right)
    }
    return this.checked_arithmetic(binary.operator, left, right)
  }

  private checked_arithmetic(operator: '+' | '-' | '*', left: string, right: string): string {
    const intrinsic = `llvm.${overflow_intrinsics[operator]}.with.overflow.i64`
    this.add_declaration(intrinsic, `declare { i64, i1 } @${intrinsic}(i64, i64)`)
    const result = this.register()
    this.body.push(`  ${result} = call { i64, i1 } @${intrinsic}(i64 ${left}, i64 ${right})`)
    const overflowed = this.register()
    this.body.push(`  ${overflowed} = extractvalue { i64, i1 } ${result}, 1`)
    this.throw_if(overflowed, 'overflow')
    const value = this.register()
    this.body.push(`  ${value} = extractvalue { i64, i1 } ${result}, 0`)
    return value
  }

  // INT_MIN / -1 overflows; INT_MIN % -1 is rejected too, since LLVM leaves it undefined.
  private checked_division(operator: '/' | '%', left: string, right: string): string {
    const is_zero = this.register()
    this.body.push(`  ${is_zero} = icmp eq i64 ${right}, 0`)
    this.throw_if(is_zero, 'division_by_zero')
    const is_min = this.register()
    this.body.push(`  ${is_min} = icmp eq i64 ${left}, ${INT_MIN}`)
    const is_minus_one = this.register()
    this.body.push(`  ${is_minus_one} = icmp eq i64 ${right}, -1`)
    const overflows = this.register()
    this.body.push(`  ${overflows} = and i1 ${is_min}, ${is_minus_one}`)
    this.throw_if(overflows, 'overflow')
    const value = this.register()
    const instruction = operator === '/' ? 'sdiv' : 'srem'
    this.body.push(`  ${value} = ${instruction} i64 ${left}, ${right}`)
    return value
  }

  private throw_if(condition: string, exception: Exception): void {
    this.thrown.add(exception)
    const continue_label = `continue.${this.label_count++}`
    this.body.push(`  br i1 ${condition}, label %throw.${exception}, label %${continue_label}`)
    this.body.push(`${continue_label}:`)
  }

  private generate_throw_block(exception: Exception): void {
    this.add_declaration('lerta_throw', 'declare void @lerta_throw(ptr) noreturn')
    const message = this.string_constant(exceptions[exception])
    this.body.push(`throw.${exception}:`)
    this.body.push(`  call void @lerta_throw(ptr ${message})`)
    this.body.push('  unreachable')
  }

  private add_declaration(symbol: string, declaration: string): void {
    this.declarations.set(symbol, declaration)
  }

  private register(): string {
    return `%r${this.register_count++}`
  }

  // An immortal LertaString (see runtime/lerta.h) holding the literal's bytes.
  private string_constant(value: string): string {
    const bytes = new TextEncoder().encode(value)
    const name = `@lerta.string.${this.globals.length}`
    const bytes_type = `[${bytes.length} x i8]`
    const type = `{ i64, i64, ${bytes_type} }`
    const bytes_init = `${bytes_type} c"${ir_string_bytes(bytes)}"`
    const init = `{ i64 ${LERTA_IMMORTAL}, i64 ${bytes.length}, ${bytes_init} }`
    this.globals.push(`${name} = private unnamed_addr constant ${type} ${init}`)
    return name
  }
}
