// Types written in the source, such as `Array<Int>` in an annotation.
import type {
  FunctionTypeName,
  Identifier,
  NamedType,
  RecordTypeName,
  Position,
  TypeAlias,
  TypeName,
  UnionTypeName,
} from '../syntax/ast.ts'
import { CompileError } from '../errors.ts'
import {
  array_type,
  is_map_key_type,
  iter_type,
  map_type,
  never_type,
  record_type,
  format_type,
  is_reference_type,
  optional_type,
  same_type,
  union_type,
  binary_type,
  bool_type,
  int_type,
  string_type,
  uint8_type,
  void_type,
  type Type,
} from '../types.ts'

const simple_types = new Map<string, Type>([
  ['Int', int_type],
  ['String', string_type],
  ['Bool', bool_type],
  ['UInt8', uint8_type],
  ['Byte', uint8_type],
  ['Binary', binary_type],
])

// Names of builtin types, which a class or struct cannot take.
export const is_builtin_type_name = (name: string): boolean =>
  simple_types.has(name) || ['Array', 'Iter', 'Map', 'void', 'never'].includes(name)

type Aliases = Map<string, { alias: TypeAlias; type: Type | undefined }>

// Resolves type names, including the classes and structs of the program.
export class TypeResolver {
  private readonly object_type: (name: string) => Type | undefined
  // Type aliases, resolved on first use, so that they can refer to each other in any order.
  private readonly aliases: Aliases
  private readonly resolving: Set<string>
  // The types that the type parameters of a generic function stand for (see with_type_parameters).
  private readonly type_parameters: Map<string, Type>

  constructor(
    object_type: (name: string) => Type | undefined,
    aliases: Aliases = new Map(),
    resolving = new Set<string>(),
    type_parameters = new Map<string, Type>(),
  ) {
    this.object_type = object_type
    this.aliases = aliases
    this.resolving = resolving
    this.type_parameters = type_parameters
  }

  // A resolver of the same names, in which those of type parameters stand for the given types, as
  // in the body of a generic function.
  with_type_parameters(type_parameters: Map<string, Type>): TypeResolver {
    return new TypeResolver(this.object_type, this.aliases, this.resolving, type_parameters)
  }

  // Whether the name is that of a type, which a type parameter cannot take.
  has_type(name: string): boolean {
    return (
      is_builtin_type_name(name) || this.object_type(name) !== undefined || this.has_alias(name)
    )
  }

  add_alias(alias: TypeAlias): void {
    const { name } = alias.name
    if (this.aliases.has(name) || is_builtin_type_name(name) || this.object_type(name)) {
      throw new CompileError(`'${name}' is already defined`, alias.name.line, alias.name.column)
    }
    this.aliases.set(name, { alias, type: undefined })
  }

  // Resolves every alias, so that an alias that is never used is checked too.
  resolve_aliases(): void {
    for (const { alias } of this.aliases.values()) this.resolve_alias(alias.name.name, alias.name)
  }

  alias_type(name: Identifier): Type {
    return this.resolve_alias(name.name, name)!
  }

  has_alias(name: string): boolean {
    return this.aliases.has(name)
  }

  // `void` and `never` are only allowed as a return type, `is_result`.
  resolve(type_name: TypeName, is_result = false): Type {
    if (type_name.kind === 'union_type') return this.resolve_union(type_name)
    const type =
      type_name.kind === 'record_type'
        ? this.resolve_record(type_name)
        : type_name.kind === 'function_type'
          ? this.resolve_function(type_name)
          : this.resolve_name(type_name, is_result)
    if (!type_name.optional) return type
    if (type.kind === 'void' || type.kind === 'never') {
      const message = `${type.kind} cannot be optional`
      throw new CompileError(message, type_name.line, type_name.column)
    }
    if (type.kind === 'Optional') {
      const message = `${format_type(type)} cannot be optional again: its nil would be ambiguous`
      throw new CompileError(message, type_name.line, type_name.column)
    }
    return optional_type(type)
  }

  private resolve_record(type_name: RecordTypeName): Type {
    const names = new Set<string>()
    for (const { name } of type_name.fields) {
      if (names.has(name.name)) {
        throw new CompileError(`'${name.name}' is already a field`, name.line, name.column)
      }
      names.add(name.name)
    }
    const fields = type_name.fields.map(({ name, type }) => ({
      name: name.name,
      type: this.resolve(type),
    }))
    return record_type(fields)
  }

  private resolve_function(type_name: FunctionTypeName): Type {
    const params = type_name.params.map((param) => this.resolve(param))
    return { kind: 'function', params, result: this.resolve(type_name.result, true) }
  }

  // A union holds classes and structs; a member that is itself a union is flattened.
  private resolve_union(type_name: UnionTypeName): Type {
    const members = type_name.members.flatMap((member) => {
      const type = this.resolve(member)
      if (type.kind === 'Union') return type.members
      if (type.kind === 'Object') return [type]
      const message = `a union can only hold classes and structs so far, not ${format_type(type)}`
      throw new CompileError(message, member.line, member.column)
    })
    const unique = members.filter(
      (type, i) => members.findIndex((other) => same_type(other, type)) === i,
    )
    return union_type(unique)
  }

  private resolve_alias(name: string, at: Position): Type | undefined {
    const entry = this.aliases.get(name)
    if (entry === undefined) return undefined
    if (entry.type !== undefined) return entry.type
    if (this.resolving.has(name)) {
      throw new CompileError(`the type '${name}' refers to itself`, at.line, at.column)
    }
    this.resolving.add(name)
    entry.type = this.resolve(entry.alias.type)
    this.resolving.delete(name)
    return entry.type
  }

  private resolve_name(type_name: NamedType, is_result: boolean): Type {
    const { name, args, line, column } = type_name
    if (name === 'Array' && args.length === 1) return array_type(this.resolve_element(args[0]))
    if (name === 'Array') throw new CompileError('Array takes one type argument', line, column)
    if (name === 'Iter' && args.length === 1) return iter_type(this.resolve(args[0]))
    if (name === 'Iter') throw new CompileError('Iter takes one type argument', line, column)
    if (name === 'Map' && args.length === 2) {
      return map_type(this.resolve_key(args[0]), this.resolve_map_value(args[1]))
    }
    if (name === 'Map') throw new CompileError('Map takes two type arguments', line, column)
    if (args.length > 0) throw new CompileError(`'${name}' takes no type arguments`, line, column)
    if (is_result && name === 'void') return void_type
    if (is_result && name === 'never') return never_type
    const type =
      this.type_parameters.get(name) ??
      simple_types.get(name) ??
      this.object_type(name) ??
      this.resolve_alias(name, type_name)
    if (type === undefined) throw new CompileError(`unknown type '${name}'`, line, column)
    return type
  }

  // A type parameter's type argument is checked where it is given (see GenericCallChecker).
  private resolve_key(type_name: TypeName): Type {
    const type = this.resolve(type_name)
    if (!is_map_key_type(type) && type.kind !== 'TypeParameter') {
      const message = `a map key must be a String or an Int, got ${format_type(type)}`
      throw new CompileError(message, type_name.line, type_name.column)
    }
    return type
  }

  // A missing key reads as nil, so a value cannot be nil itself.
  private resolve_map_value(type_name: TypeName): Type {
    const type = this.resolve(type_name)
    if (type.kind === 'Optional') {
      const message = `a map cannot hold values of type ${format_type(type)}`
      throw new CompileError(message, type_name.line, type_name.column)
    }
    return type
  }

  // An array item is 8 bytes, which cannot hold an optional Int, UInt8 or Bool.
  private resolve_element(type_name: TypeName): Type {
    const type = this.resolve(type_name)
    if (type.kind === 'Optional' && !is_reference_type(type)) {
      const message = `an array cannot hold values of type ${format_type(type)} yet`
      throw new CompileError(message, type_name.line, type_name.column)
    }
    return type
  }
}
