// Nested scopes of local names, innermost last. Builtins live outside every scope.

export type Scope<T> = Map<string, T>

export class Scopes<T> {
  private readonly scopes: Scope<T>[] = []
  // Narrowed views of names, such as a `const x: Int?` known to be an Int; per scope, so that
  // they end with it. They are separate from the definitions, which they do not redefine.
  private readonly overlays: Scope<T>[] = []

  get depth(): number {
    return this.scopes.length
  }

  push(): Scope<T> {
    const scope: Scope<T> = new Map()
    this.scopes.push(scope)
    this.overlays.push(new Map())
    return scope
  }

  pop(): Scope<T> {
    this.overlays.pop()
    return this.scopes.pop()!
  }

  // Until the innermost scope ends, the name is seen as `local`.
  narrow(name: string, local: T): void {
    this.overlays.at(-1)!.set(name, local)
  }

  // Returns whether the name is new, already defined in the innermost scope (and then not
  // defined again), or shadows a name of an outer scope.
  define(name: string, local: T): 'new' | 'redefined' | 'shadowing' {
    const innermost = this.scopes.at(-1)!
    if (innermost.has(name)) return 'redefined'
    const is_shadowing = this.scopes.some((scope) => scope.has(name))
    innermost.set(name, local)
    // The new name replaces a narrowed view of the outer one in this scope.
    this.overlays.at(-1)!.delete(name)
    return is_shadowing ? 'shadowing' : 'new'
  }

  lookup(name: string): T | undefined {
    for (let depth = this.scopes.length - 1; depth >= 0; depth--) {
      const local = this.overlays[depth].get(name) ?? this.scopes[depth].get(name)
      if (local !== undefined) return local
    }
    return undefined
  }

  // The scopes from `depth` inward, innermost first.
  inner_scopes(depth: number): Scope<T>[] {
    return this.scopes.slice(depth).toReversed()
  }
}
