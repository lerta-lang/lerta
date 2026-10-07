// Types written in the source, such as `Array<Int>` in an annotation.
import type { TypeName } from './ast.ts'
import { CompileError } from './errors.ts'
import { array_type, bool_type, int_type, string_type, void_type, type Type } from './types.ts'

const simple_types = new Map<string, Type>([
  ['Int', int_type],
  ['String', string_type],
  ['Bool', bool_type],
])

// `void` is only allowed as a return type.
export const resolve_type = (type_name: TypeName, allow_void = false): Type => {
  const { name, args, line, column } = type_name
  if (name === 'Array' && args.length === 1) return array_type(resolve_type(args[0]))
  if (name === 'Array') throw new CompileError('Array takes one type argument', line, column)
  if (args.length > 0) throw new CompileError(`'${name}' takes no type arguments`, line, column)
  if (allow_void && name === 'void') return void_type
  const type = simple_types.get(name)
  if (type === undefined) throw new CompileError(`unknown type '${name}'`, line, column)
  return type
}
