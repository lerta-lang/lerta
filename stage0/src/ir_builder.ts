// Accumulates the text of an LLVM IR module. It knows IR syntax only, not Lerta semantics.
export class IrModule {
  private readonly type_definitions: string[] = []
  private readonly globals: string[] = []
  private readonly declarations = new Map<string, string>()
  private readonly functions: string[] = []

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

  add_type(definition: string): void {
    this.type_definitions.push(definition)
  }

  add_function(definition: string): void {
    this.functions.push(definition)
  }

  render(): string {
    const parts = [
      this.type_definitions,
      this.globals,
      [...this.declarations.values()],
      this.functions,
    ]
    return parts.flat().join('\n') + '\n'
  }
}

// Accumulates the body of one function of a module.
export class IrBuilder {
  private readonly module: IrModule
  private readonly body: string[] = []
  // Stack slots go first in the entry block, where LLVM promotes them to registers.
  private readonly stack_slots: string[] = []
  private register_count = 0
  private label_count = 0
  private current_label = 'entry'

  constructor(module: IrModule) {
    this.module = module
  }

  declare(symbol: string, declaration: string): void {
    this.module.declare(symbol, declaration)
  }

  global(prefix: string, definition: string): string {
    return this.module.global(prefix, definition)
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

  // Adds the function `define <signature>`, holding everything emitted, to the module.
  finish(signature: string): void {
    const lines = [`define ${signature} {`, 'entry:', ...this.stack_slots, ...this.body, '}']
    this.module.add_function(lines.join('\n'))
  }
}
