export type Type =
  { kind: 'String' } | { kind: 'void' } | { kind: 'function'; params: Type[]; result: Type }

export const string_type: Type = { kind: 'String' }
export const void_type: Type = { kind: 'void' }

export const format_type = (type: Type): string => {
  if (type.kind !== 'function') return type.kind
  const params = type.params.map(format_type).join(', ')
  return `(${params}) -> ${format_type(type.result)}`
}

export const same_type = (a: Type, b: Type): boolean => format_type(a) === format_type(b)
