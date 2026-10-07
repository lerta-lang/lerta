// Nested scopes of local names, innermost last. Builtins live outside every scope.

export type Scope<T> = Map<string, T>

export class Scopes<T> {
  private readonly scopes: Scope<T>[] = []

  get depth(): number {
    return this.scopes.length
  }

  push(): Scope<T> {
    const scope: Scope<T> = new Map()
    this.scopes.push(scope)
    return scope
  }

  pop(): Scope<T> {
    return this.scopes.pop()!
  }

  // Returns whether the name is new, already defined in the innermost scope (and then not
  // defined again), or shadows a name of an outer scope.
  define(name: string, local: T): 'new' | 'redefined' | 'shadowing' {
    const innermost = this.scopes.at(-1)!
    if (innermost.has(name)) return 'redefined'
    const is_shadowing = this.scopes.some((scope) => scope.has(name))
    innermost.set(name, local)
    return is_shadowing ? 'shadowing' : 'new'
  }

  lookup(name: string): T | undefined {
    for (const scope of this.scopes.toReversed()) {
      const local = scope.get(name)
      if (local !== undefined) return local
    }
    return undefined
  }

  // The scopes from `depth` inward, innermost first.
  inner_scopes(depth: number): Scope<T>[] {
    return this.scopes.slice(depth).toReversed()
  }
}
