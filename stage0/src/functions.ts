// Top-level functions. They can be used anywhere in the module, before their declaration too, so
// a function's body is checked on demand: when its return type is first needed, or at the end.
import type { FunctionLiteral, Identifier, Position } from './ast.ts'
import { CompileError } from './errors.ts'
import { resolve_type } from './type_names.ts'
import type { Type } from './types.ts'

export type FunctionEntry = {
  name: Identifier
  literal: FunctionLiteral
  // Known from the annotations, or once the body is checked when the return type is inferred.
  type: Type | undefined
  state: 'unchecked' | 'checking' | 'checked'
}

export const parameter_types = (literal: FunctionLiteral): Type[] =>
  literal.params.map((param) => resolve_type(param.type))

export class Functions {
  private readonly entries = new Map<string, FunctionEntry>()
  // Checks a body, setting the entry's type if it was not annotated.
  private readonly check_body: (entry: FunctionEntry) => void

  constructor(check_body: (entry: FunctionEntry) => void) {
    this.check_body = check_body
  }

  add(name: Identifier, literal: FunctionLiteral): void {
    if (this.entries.has(name.name)) {
      throw new CompileError(`'${name.name}' is already defined`, name.line, name.column)
    }
    const type: Type | undefined =
      literal.return_type === undefined
        ? undefined
        : {
            kind: 'function',
            params: parameter_types(literal),
            result: resolve_type(literal.return_type, true),
          }
    this.entries.set(name.name, { name, literal, type, state: 'unchecked' })
  }

  has(name: string): boolean {
    return this.entries.has(name)
  }

  // The function's type, checking its body first if the return type must be inferred.
  type_of(name: string, at: Position): Type | undefined {
    const entry = this.entries.get(name)
    if (entry === undefined) return undefined
    if (entry.type !== undefined) return entry.type
    if (entry.state === 'checking') {
      const message = `'${name}' is recursive, so its return type must be written`
      throw new CompileError(message, at.line, at.column)
    }
    this.check(entry)
    return entry.type
  }

  check_all(): void {
    for (const entry of this.entries.values()) this.check(entry)
  }

  private check(entry: FunctionEntry): void {
    if (entry.state !== 'unchecked') return
    entry.state = 'checking'
    this.check_body(entry)
    entry.state = 'checked'
  }
}
