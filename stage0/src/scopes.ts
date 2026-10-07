// The types of local names, innermost scope last. Builtins live outside every scope.
import type { Identifier } from './ast.ts'
import { builtins } from './builtins.ts'
import type { Type } from './types.ts'

export class Scopes {
  private readonly scopes: Map<string, Type>[] = []

  within<T>(body: () => T): T {
    this.scopes.push(new Map())
    try {
      return body()
    } finally {
      this.scopes.pop()
    }
  }

  // Returns whether the name shadows a local name of an outer scope.
  define(identifier: Identifier, type: Type): boolean {
    const is_shadowing = this.scopes.some((scope) => scope.has(identifier.name))
    this.scopes.at(-1)!.set(identifier.name, type)
    return is_shadowing
  }

  lookup(name: string): Type | undefined {
    for (const scope of this.scopes.toReversed()) {
      const type = scope.get(name)
      if (type !== undefined) return type
    }
    return builtins.get(name)?.type
  }
}
