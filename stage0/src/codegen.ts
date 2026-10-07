import type { Expression, Program } from './ast.ts'
import { builtins } from './builtins.ts'

// Emits LLVM IR for a checked program: its top-level code becomes lerta_main.
export const generate = (program: Program): string => new Generator().generate(program)

const LERTA_IMMORTAL = '-9223372036854775808'

// Bytes other than printable ASCII, '"' and '\' are written as \XX in IR strings.
const ir_string_bytes = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => {
    const is_plain = b >= 0x20 && b <= 0x7e && b !== 0x22 && b !== 0x5c
    return is_plain ? String.fromCharCode(b) : `\\${b.toString(16).toUpperCase().padStart(2, '0')}`
  }).join('')

class Generator {
  private readonly globals: string[] = []
  private readonly body: string[] = []
  private readonly used_runtime_symbols = new Set<string>()

  generate(program: Program): string {
    for (const statement of program) this.generate_expression(statement)
    const declarations = [...this.used_runtime_symbols].map(
      (symbol) => `declare void @${symbol}(ptr)`,
    )
    const main = ['define void @lerta_main() {', ...this.body, '  ret void', '}']
    return [...this.globals, ...declarations, ...main].join('\n') + '\n'
  }

  // Returns the IR operand holding the value; void calls return ''.
  private generate_expression(expression: Expression): string {
    switch (expression.kind) {
      case 'string':
        return this.string_constant(expression.value)
      case 'call': {
        if (expression.callee.kind !== 'identifier') throw new Error('only builtins can be called')
        const symbol = builtins.get(expression.callee.name)!.runtime_symbol
        const args = expression.args.map((arg) => `ptr ${this.generate_expression(arg)}`)
        this.used_runtime_symbols.add(symbol)
        this.body.push(`  call void @${symbol}(${args.join(', ')})`)
        return ''
      }
      case 'identifier':
        throw new Error('function values are not supported')
    }
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
