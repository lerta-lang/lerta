// Top-level functions and the methods of classes and structs. They can be used anywhere in the
// module, before their declaration too, so a body is checked on demand: when its return type is
// first needed, or at the end.
import type { FunctionLiteral, Identifier, Position } from './ast.ts'
import { CompileError } from './errors.ts'
import type { TypeResolver } from './type_names.ts'
import type { Type } from './types.ts'

export type FunctionEntry = {
  name: Identifier
  literal: FunctionLiteral
  // Known from the annotations, or once the body is checked when the return type is inferred.
  type: Type | undefined
  state: 'unchecked' | 'checking' | 'checked'
  // The class or struct of a method, which its body sees as `@`.
  this_type: Type | undefined
}

// The written types of the parameters; `expected`, the types a function type expects, stands in
// for those left out (the caller checks that there are as many).
export const parameter_types = (
  literal: FunctionLiteral,
  resolver: TypeResolver,
  expected: Type[] = [],
): Type[] =>
  literal.params.map((param, i) => {
    if (param.type !== undefined) return resolver.resolve(param.type)
    const type = expected[i]
    if (type !== undefined) return type
    const { name, line, column } = param.name
    throw new CompileError(`the type of the parameter '${name}' must be written`, line, column)
  })

export class Functions {
  private readonly entries = new Map<string, FunctionEntry>()
  // Checks a body, setting the entry's type if it was not annotated.
  private readonly check_body: (entry: FunctionEntry) => void
  private readonly resolver: TypeResolver

  constructor(check_body: (entry: FunctionEntry) => void, resolver: TypeResolver) {
    this.check_body = check_body
    this.resolver = resolver
  }

  // A method is keyed by its type and name, as `Point.length` (see `method_key`).
  add(key: string, name: Identifier, literal: FunctionLiteral, this_type?: Type): void {
    if (this.entries.has(key)) {
      throw new CompileError(`'${name.name}' is already defined`, name.line, name.column)
    }
    const type: Type | undefined =
      literal.return_type === undefined
        ? undefined
        : {
            kind: 'function',
            params: parameter_types(literal, this.resolver),
            result: this.resolver.resolve(literal.return_type, true),
          }
    this.entries.set(key, { name, literal, type, state: 'unchecked', this_type })
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

export const method_key = (type_name: string, method: string): string => `${type_name}.${method}`
