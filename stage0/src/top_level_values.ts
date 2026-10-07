// The `const`s and `var`s at the top level of a module, which its functions and methods see.
import type { Declaration, Identifier, Program } from './ast.ts'
import { CompileError } from './errors.ts'
import type { CheckerLocal } from './expression_checker.ts'

// A top-level declaration whose value is not a function literal.
export const is_top_level_value = (statement: Program[number]): statement is Declaration =>
  statement.kind === 'declaration' && statement.value.kind !== 'function'

export class TopLevelValues {
  // A value's local once the top-level code has declared it; until then its type is unknown.
  private readonly locals = new Map<string, CheckerLocal | undefined>()

  constructor(program: Program) {
    for (const statement of program.filter(is_top_level_value)) {
      this.locals.set(statement.name.name, undefined)
    }
  }

  has(name: string): boolean {
    return this.locals.has(name)
  }

  // Called as the top-level code declares the value.
  define(local: CheckerLocal): void {
    this.locals.set(local.identifier.name, local)
  }

  // The value's local, if the top-level code has declared it so far.
  lookup(name: string): CheckerLocal | undefined {
    return this.locals.get(name)
  }

  // The error for a use of a value whose type is not known yet: one that the top-level code
  // declares below a call that needs the type of the function using it (whose return type is
  // inferred) or of the object whose field initializer uses it.
  pending_error(identifier: Identifier): CompileError | undefined {
    const { name, line, column } = identifier
    if (!this.locals.has(name) || this.locals.get(name) !== undefined) return undefined
    const message = `the type of '${name}' is not known yet, as it is declared below code that needs it here; declare it before, or write the type of this function or field`
    return new CompileError(message, line, column)
  }
}
