export type Type =
  | { kind: 'String' }
  | { kind: 'Int' }
  | { kind: 'void' }
  // Built-in rule of stage0: satisfied by String and Int. Only usable as a parameter type.
  | { kind: 'Stringable' }
  | { kind: 'function'; params: Type[]; result: Type }

export const string_type: Type = { kind: 'String' }
export const int_type: Type = { kind: 'Int' }
export const void_type: Type = { kind: 'void' }
export const stringable_type: Type = { kind: 'Stringable' }

export const format_type = (type: Type): string => {
  if (type.kind !== 'function') return type.kind
  const params = type.params.map(format_type).join(', ')
  return `(${params}) -> ${format_type(type.result)}`
}

export const same_type = (a: Type, b: Type): boolean => format_type(a) === format_type(b)

export const is_assignable = (value: Type, target: Type): boolean => {
  if (target.kind === 'Stringable') return value.kind === 'String' || value.kind === 'Int'
  return same_type(value, target)
}
