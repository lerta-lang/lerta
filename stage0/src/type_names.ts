// Types written in the source, such as `Array<Int>` in an annotation.
import type { TypeName } from './ast.ts'
import { CompileError } from './errors.ts'
import {
  array_type,
  format_type,
  is_reference_type,
  optional_type,
  binary_type,
  bool_type,
  int_type,
  string_type,
  uint8_type,
  void_type,
  type Type,
} from './types.ts'

const simple_types = new Map<string, Type>([
  ['Int', int_type],
  ['String', string_type],
  ['Bool', bool_type],
  ['UInt8', uint8_type],
  ['Byte', uint8_type],
  ['Binary', binary_type],
])

// `void` is only allowed as a return type.
export const resolve_type = (type_name: TypeName, allow_void = false): Type => {
  const type = resolve_name(type_name, allow_void)
  if (!type_name.optional) return type
  if (type.kind === 'void') {
    throw new CompileError('void cannot be optional', type_name.line, type_name.column)
  }
  return optional_type(type)
}

const resolve_name = (type_name: TypeName, allow_void: boolean): Type => {
  const { name, args, line, column } = type_name
  if (name === 'Array' && args.length === 1) return array_type(resolve_element(args[0]))
  if (name === 'Array') throw new CompileError('Array takes one type argument', line, column)
  if (args.length > 0) throw new CompileError(`'${name}' takes no type arguments`, line, column)
  if (allow_void && name === 'void') return void_type
  const type = simple_types.get(name)
  if (type === undefined) throw new CompileError(`unknown type '${name}'`, line, column)
  return type
}

// An array item is 8 bytes, which cannot hold an optional Int, UInt8 or Bool.
const resolve_element = (type_name: TypeName): Type => {
  const type = resolve_type(type_name)
  if (type.kind === 'Optional' && !is_reference_type(type)) {
    const message = `an array cannot hold values of type ${format_type(type)} yet`
    throw new CompileError(message, type_name.line, type_name.column)
  }
  return type
}
