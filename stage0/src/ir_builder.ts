// Accumulates the text of an LLVM IR module with a single function. It knows
// IR syntax only, not Lerta semantics.
export class IrBuilder {
  private readonly globals: string[] = []
  private readonly declarations = new Map<string, string>()
  private readonly body: string[] = []
  // Stack slots go first in the entry block, where LLVM promotes them to registers.
  private readonly stack_slots: string[] = []
  private register_count = 0
  private label_count = 0
  private current_label = 'entry'

  // Declaring the same symbol again with the same text is harmless.
  declare(symbol: string, declaration: string): void {
    const existing = this.declarations.get(symbol)
    if (existing !== undefined && existing !== declaration) {
      throw new Error(`conflicting declarations of ${symbol}`)
    }
    this.declarations.set(symbol, declaration)
  }

  // Adds `@<prefix>.<n> = <definition>` and returns the global's name.
  global(prefix: string, definition: string): string {
    const name = `@${prefix}.${this.globals.length}`
    this.globals.push(`${name} = ${definition}`)
    return name
  }

  // Emits `%r<n> = <value>` and returns the register.
  assign(value: string): string {
    const register = this.fresh_register()
    this.assign_to(register, value)
    return register
  }

  // A register to be assigned later with `assign_to`, for `phi` operands defined further down.
  fresh_register(): string {
    return `%r${this.register_count++}`
  }

  assign_to(register: string, value: string): void {
    this.emit(`${register} = ${value}`)
  }

  // A stack slot for a value of the IR type, valid in the whole function.
  alloca(type: string): string {
    const register = this.fresh_register()
    this.stack_slots.push(`  ${register} = alloca ${type}`)
    return register
  }

  emit(instruction: string): void {
    this.body.push(`  ${instruction}`)
  }

  fresh_label(prefix: string): string {
    return `${prefix}.${this.label_count++}`
  }

  start_block(label: string): void {
    this.body.push(`${label}:`)
    this.current_label = label
  }

  // The block that instructions are being emitted into, as needed by `phi`.
  get current_block(): string {
    return this.current_label
  }

  // The module with the function `define <signature>` holding everything emitted.
  render(signature: string): string {
    const function_lines = [
      `define ${signature} {`,
      'entry:',
      ...this.stack_slots,
      ...this.body,
      '}',
    ]
    return [...this.globals, ...this.declarations.values(), ...function_lines].join('\n') + '\n'
  }
}
