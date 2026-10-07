export type Type =
  | { kind: 'String' }
  | { kind: 'Int' }
  | { kind: 'Bool' }
  | { kind: 'UInt8' }
  | { kind: 'Binary' }
  | { kind: 'Array'; element: Type }
  | { kind: 'Map'; key: Type; value: Type }
  // A class or struct (see ObjectTypes). Its name is the one it is declared with; its symbol, made
  // of its module's index and its name, tells it apart from another module's type of the same name,
  // and `module` names that module in messages.
  | { kind: 'Object'; name: string; symbol: string; module: string; is_struct: boolean }
  // `A | B`: classes and structs, by name; the object carries which one it is.
  | { kind: 'Union'; members: Type[] }
  // `T?`: a T or nil.
  | { kind: 'Optional'; inner: Type }
  // The type of the literal `nil`, which fits any optional type.
  | { kind: 'nil' }
  | { kind: 'void' }
  // The result of what does not return, such as `throw`; it fits wherever a value is expected.
  | { kind: 'never' }
  // `stdout` or `stderr` (see std_modules.ts).
  | { kind: 'Writer' }
  // Built-in rule of stage0: satisfied by String, Int, UInt8 and Bool. Only usable as a parameter type.
  | { kind: 'Stringable' }
  | { kind: 'function'; params: Type[]; result: Type }

export const string_type: Type = { kind: 'String' }
export const int_type: Type = { kind: 'Int' }
export const bool_type: Type = { kind: 'Bool' }
export const uint8_type: Type = { kind: 'UInt8' }
export const binary_type: Type = { kind: 'Binary' }
export const void_type: Type = { kind: 'void' }
export const never_type: Type = { kind: 'never' }
export const writer_type: Type = { kind: 'Writer' }
export const stringable_type: Type = { kind: 'Stringable' }

export const array_type = (element: Type): Type => ({ kind: 'Array', element })
export const map_type = (key: Type, value: Type): Type => ({ kind: 'Map', key, value })
export const optional_type = (inner: Type): Type => ({ kind: 'Optional', inner })
// The members are kept in name order, so that `A | B` and `B | A` are the same type.
export const union_type = (members: Type[]): Type => {
  const sorted = members.toSorted((a, b) => type_key(a).localeCompare(type_key(b)))
  return { kind: 'Union', members: sorted }
}
export const nil_type: Type = { kind: 'nil' }

// How a type is written in messages. A class or struct is written by its name, and with its module
// where `qualified` says so, or where a union holds another of the same name.
export const format_type = (type: Type, qualified = false): string => {
  const format = (inner: Type) => format_type(inner, qualified)
  switch (type.kind) {
    case 'Array':
      return `Array<${format(type.element)}>`
    case 'Map':
      return `Map<${format(type.key)}, ${format(type.value)}>`
    case 'Object':
      return qualified ? `${type.name} (of ${type.module})` : type.name
    case 'Union':
      return type.members.map((member) => format_member(member, type, qualified)).join(' | ')
    case 'Optional':
      return type.inner.kind === 'function' || type.inner.kind === 'Union'
        ? `(${format(type.inner)})?`
        : `${format(type.inner)}?`
    case 'function': {
      const params = type.params.map(format).join(', ')
      return `(${params}) -> ${format(type.result)}`
    }
    default:
      return type.kind
  }
}

// A member of a union, with its module if another member has the same name.
export const format_member = (member: Type, union: Type, qualified = false): string => {
  if (union.kind !== 'Union' || member.kind !== 'Object') return format_type(member, qualified)
  const shares_name = union.members.some(
    (other) => other.kind === 'Object' && other.name === member.name && !same_type(other, member),
  )
  return format_type(member, qualified || shares_name)
}

// Two types for a message: as format_type writes them, or, if that cannot tell them apart, with
// the modules of their classes and structs.
export const format_types = (a: Type, b: Type): [string, string] => {
  const plain: [string, string] = [format_type(a), format_type(b)]
  if (plain[0] !== plain[1]) return plain
  return [format_type(a, true), format_type(b, true)]
}

// Identifies a type: as format_type writes it, with classes and structs by their symbols.
export const type_key = (type: Type): string => {
  switch (type.kind) {
    case 'Object':
      return type.symbol
    case 'Array':
      return `Array<${type_key(type.element)}>`
    case 'Map':
      return `Map<${type_key(type.key)}, ${type_key(type.value)}>`
    case 'Union':
      return type.members.map(type_key).join(' | ')
    case 'Optional':
      return `(${type_key(type.inner)})?`
    case 'function':
      return `(${type.params.map(type_key).join(', ')}) -> ${type_key(type.result)}`
    default:
      return type.kind
  }
}

export const same_type = (a: Type, b: Type): boolean => type_key(a) === type_key(b)

// Values of these types are reference counted.
export const is_reference_type = (type: Type): boolean =>
  ['String', 'Binary', 'Array', 'Map', 'Object', 'Union'].includes(type.kind) ||
  (type.kind === 'Optional' && is_reference_type(type.inner))

// A T or nil also fits where a T? is expected.
export const is_assignable = (value: Type, target: Type): boolean => {
  if (value.kind === 'never') return true
  if (target.kind === 'Stringable') return is_stringable(value)
  if (target.kind === 'Union') {
    const members = value.kind === 'Union' ? value.members : [value]
    return members.every((member) => target.members.some((type) => same_type(type, member)))
  }
  if (target.kind === 'Optional' && (value.kind === 'nil' || is_assignable(value, target.inner))) {
    return true
  }
  return same_type(value, target)
}

// Maps hash and compare their keys in the runtime, which knows these two kinds.
export const is_map_key_type = (type: Type): boolean =>
  type.kind === 'String' || type.kind === 'Int'

export const is_stringable = (type: Type): boolean =>
  ['String', 'Int', 'UInt8', 'Bool'].includes(type.kind)

// The type of a value that is either an `a` or a `b`: the same type, or `T?` for a mix of `T`,
// `T?` and nil; `never`, which gives no value, does not count. Undefined if there is none.
export const unify = (a: Type, b: Type): Type | undefined => {
  if (same_type(a, b) || b.kind === 'never') return a
  if (a.kind === 'never') return b
  const inner_of = (type: Type) => (type.kind === 'Optional' ? type.inner : type)
  if (a.kind === 'nil' && b.kind === 'nil') return a
  if (a.kind === 'nil') return optional_type(inner_of(b))
  if (b.kind === 'nil') return optional_type(inner_of(a))
  const is_optional = a.kind === 'Optional' || b.kind === 'Optional'
  return is_optional && same_type(inner_of(a), inner_of(b)) ? optional_type(inner_of(a)) : undefined
}
