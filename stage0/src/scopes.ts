// Local names, innermost scope last. Builtins live outside every scope.
import type { Identifier } from './ast.ts'
import type { Type } from './types.ts'

export type Local = {
  identifier: Identifier
  type: Type
  mutable: boolean
  // Declared with `const` or `var`, as opposed to a loop variable.
  declared: boolean
  used: boolean
}

export class Scopes {
  private readonly scopes: Map<string, Local>[] = []

  // Runs body in a new scope and returns the locals it declared.
  within(body: () => void): Local[] {
    this.scopes.push(new Map())
    try {
      body()
      return [...this.scopes.at(-1)!.values()]
    } finally {
      this.scopes.pop()
    }
  }

  // Returns whether the name is new, already defined in the innermost scope (and then not
  // defined again), or shadows a name of an outer scope.
  define(local: Local): 'new' | 'redefined' | 'shadowing' {
    const { name } = local.identifier
    const innermost = this.scopes.at(-1)!
    if (innermost.has(name)) return 'redefined'
    const is_shadowing = this.scopes.some((scope) => scope.has(name))
    innermost.set(name, local)
    return is_shadowing ? 'shadowing' : 'new'
  }

  lookup(name: string): Local | undefined {
    for (const scope of this.scopes.toReversed()) {
      const local = scope.get(name)
      if (local !== undefined) return local
    }
    return undefined
  }
}
