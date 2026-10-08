// The `const`s and `var`s at the top level of a module, which its functions and methods see.
import type { Declaration, Identifier, Program } from '../syntax/ast.ts'
import { CompileError } from '../errors.ts'
import type { CheckerLocal } from './expression_checker.ts'

// A top-level declaration whose value is not a function literal.
export const is_top_level_value = (statement: Program[number]): statement is Declaration =>
  statement.kind === 'declaration' && statement.value.kind !== 'function'

export class TopLevelValues {
  // A value's local once the top-level code has declared it; until then its type is unknown.
  private readonly locals = new Map<string, CheckerLocal | undefined>()
  // Whether the top-level code is being checked or has been: until then, only the top-level code
  // of a module that runs before this one, in the same import cycle, can need a value's type.
  private started = false

  constructor(program: Program) {
    for (const statement of program.filter(is_top_level_value)) {
      this.locals.set(statement.name.name, undefined)
    }
  }

  has(name: string): boolean {
    return this.locals.has(name)
  }

  start(): void {
    this.started = true
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
    if (!this.started) return runs_later_error(identifier, 'this module', true)
    const message = `the type of '${name}' is not known yet, as it is declared below code that needs it here; declare it before, or write the type of this function or field`
    return new CompileError(message, line, column)
  }
}

// The error for a use of a value of `module` whose type is not known yet, as the top-level code
// of a module that runs before it, in the same import cycle, needs it: directly, or `in_function`,
// a function whose return type is inferred or a field initializer.
export const runs_later_error = (
  identifier: Identifier,
  module: string,
  in_function: boolean,
): CompileError => {
  const { name, line, column } = identifier
  const advice = in_function
    ? `${module} runs after the top-level code that needs this function or field; write its type`
    : `${module} runs after this module; read it in a function whose return type is written`
  return new CompileError(`the type of '${name}' is not known yet, as ${advice}`, line, column)
}
