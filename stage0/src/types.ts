export type Type =
  | { kind: 'String' }
  | { kind: 'Int' }
  | { kind: 'Bool' }
  | { kind: 'UInt8' }
  | { kind: 'Binary' }
  | { kind: 'Array'; element: Type }
  // `T?`: a T or nil.
  | { kind: 'Optional'; inner: Type }
  // The type of the literal `nil`, which fits any optional type.
  | { kind: 'nil' }
  | { kind: 'void' }
  // Built-in rule of stage0: satisfied by String, Int, UInt8 and Bool. Only usable as a parameter type.
  | { kind: 'Stringable' }
  | { kind: 'function'; params: Type[]; result: Type }

export const string_type: Type = { kind: 'String' }
export const int_type: Type = { kind: 'Int' }
export const bool_type: Type = { kind: 'Bool' }
export const uint8_type: Type = { kind: 'UInt8' }
export const binary_type: Type = { kind: 'Binary' }
export const void_type: Type = { kind: 'void' }
export const stringable_type: Type = { kind: 'Stringable' }

export const array_type = (element: Type): Type => ({ kind: 'Array', element })
export const optional_type = (inner: Type): Type => ({ kind: 'Optional', inner })
export const nil_type: Type = { kind: 'nil' }

export const format_type = (type: Type): string => {
  switch (type.kind) {
    case 'Array':
      return `Array<${format_type(type.element)}>`
    case 'Optional':
      return type.inner.kind === 'function'
        ? `(${format_type(type.inner)})?`
        : `${format_type(type.inner)}?`
    case 'function': {
      const params = type.params.map(format_type).join(', ')
      return `(${params}) -> ${format_type(type.result)}`
    }
    default:
      return type.kind
  }
}

export const same_type = (a: Type, b: Type): boolean => format_type(a) === format_type(b)

// Values of these types are reference counted.
export const is_reference_type = (type: Type): boolean =>
  ['String', 'Binary', 'Array'].includes(type.kind) ||
  (type.kind === 'Optional' && is_reference_type(type.inner))

// A T or nil also fits where a T? is expected.
export const is_assignable = (value: Type, target: Type): boolean => {
  if (target.kind === 'Stringable') return is_stringable(value)
  if (target.kind === 'Optional' && (value.kind === 'nil' || same_type(value, target.inner))) {
    return true
  }
  return same_type(value, target)
}

export const is_stringable = (type: Type): boolean =>
  ['String', 'Int', 'UInt8', 'Bool'].includes(type.kind)

// The type of a value that is either an `a` or a `b`: the same type, or `T?` for a mix of `T`,
// `T?` and nil. Undefined if there is none.
export const unify = (a: Type, b: Type): Type | undefined => {
  if (same_type(a, b)) return a
  const inner_of = (type: Type) => (type.kind === 'Optional' ? type.inner : type)
  if (a.kind === 'nil' && b.kind === 'nil') return a
  if (a.kind === 'nil') return optional_type(inner_of(b))
  if (b.kind === 'nil') return optional_type(inner_of(a))
  const is_optional = a.kind === 'Optional' || b.kind === 'Optional'
  return is_optional && same_type(inner_of(a), inner_of(b)) ? optional_type(inner_of(a)) : undefined
}
