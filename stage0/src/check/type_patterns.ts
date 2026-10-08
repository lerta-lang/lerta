// Types with type parameters, as patterns: `Array<T>` stands for any array. Generic functions and
// extends match, substitute and infer their type parameters with these.
import type { TypeParameter } from '../syntax/ast.ts'
import {
  array_type,
  iter_type,
  map_type,
  optional_type,
  record_type,
  same_type,
  type_key,
  union_type,
  type Type,
} from '../types.ts'

export const type_parameter = (name: string): Type => ({ kind: 'TypeParameter', name })

// The type parameters standing for themselves, for resolving the types written with them.
export const placeholders = (type_params: TypeParameter[]): Map<string, Type> =>
  new Map(type_params.map(({ name }) => [name.name, type_parameter(name.name)]))

// The type with each type it is made of replaced by `replace` of it.
const map_parts = (type: Type, replace: (part: Type) => Type): Type => {
  switch (type.kind) {
    case 'Array':
      return array_type(replace(type.element))
    case 'Iter':
      return iter_type(replace(type.item))
    case 'Map':
      return map_type(replace(type.key), replace(type.value))
    case 'Optional':
      return optional_type(replace(type.inner))
    case 'Record':
      return record_type(type.fields.map(({ name, type }) => ({ name, type: replace(type) })))
    case 'Union':
      return union_type(type.members.map(replace))
    case 'function':
      return { kind: 'function', params: type.params.map(replace), result: replace(type.result) }
    default:
      return type
  }
}

// The type with the type parameters that `bindings` has replaced by their types.
export const substitute = (type: Type, bindings: Map<string, Type>): Type =>
  type.kind === 'TypeParameter'
    ? (bindings.get(type.name) ?? type)
    : map_parts(type, (part) => substitute(part, bindings))

// The types that the type is made of, such as the items of an array.
export const parts_of = (type: Type): Type[] => {
  const parts: Type[] = []
  map_parts(type, (part) => {
    parts.push(part)
    return part
  })
  return parts
}

export const type_depth = (type: Type): number => 1 + Math.max(0, ...parts_of(type).map(type_depth))

// Whether the type is the pattern with its type parameters replaced, as Array<Int> is Array<T>.
export const matches = (pattern: Type, type: Type): boolean => {
  const bindings = new Map<string, Type>()
  infer(pattern, type, (name, bound) => {
    if (!bindings.has(name)) bindings.set(name, bound)
  })
  return same_type(substitute(pattern, bindings), type)
}

// Whether some type matches both patterns, as Array<Int> matches Array<T> and Array<Int>. A type
// parameter stands for any type on either side, even where it is repeated, as in Map<T, T>.
export const overlaps = (a: Type, b: Type): boolean => {
  if (a.kind === 'TypeParameter' || b.kind === 'TypeParameter') return true
  const [a_parts, b_parts] = [parts_of(a), parts_of(b)]
  return (
    shape_key(a) === shape_key(b) &&
    a_parts.length === b_parts.length &&
    a_parts.every((part, i) => overlaps(part, b_parts[i]))
  )
}

// The type without the types it is made of: Array<_> for any array.
const shape_key = (type: Type): string => type_key(map_parts(type, () => type_parameter('_')))

export const has_type_parameters = (type: Type): boolean =>
  type.kind === 'TypeParameter' || parts_of(type).some(has_type_parameters)

// Binds the type parameters in `pattern` to the types they have in `type`, where its shape
// matches: `Array<T>` and an `Array<Int>` bind T to Int. A type parameter bound already is kept;
// the caller then checks that the type fits.
export const infer = (
  pattern: Type,
  type: Type,
  bind: (name: string, type: Type) => void,
): void => {
  const match = (a: Type | undefined, b: Type | undefined) => {
    if (a !== undefined && b !== undefined) infer(a, b, bind)
  }
  switch (pattern.kind) {
    case 'TypeParameter':
      return bind(pattern.name, type)
    case 'Optional':
      return match(pattern.inner, type.kind === 'Optional' ? type.inner : type)
    case 'Array':
      return match(pattern.element, type.kind === 'Array' ? type.element : undefined)
    case 'Iter':
      return match(pattern.item, type.kind === 'Iter' ? type.item : undefined)
    case 'Map':
      if (type.kind !== 'Map') return
      match(pattern.key, type.key)
      return match(pattern.value, type.value)
    case 'Record':
      if (type.kind !== 'Record') return
      for (const field of pattern.fields) {
        match(field.type, type.fields.find(({ name }) => name === field.name)?.type)
      }
      return
    case 'function':
      if (type.kind !== 'function' || type.params.length !== pattern.params.length) return
      pattern.params.forEach((param, i) => match(param, type.params[i]))
      return match(pattern.result, type.result)
    default:
      return
  }
}
