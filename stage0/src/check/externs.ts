// Externs: the C functions a module declares, whose types all the modules must agree on.
import type { Program, Position } from '../syntax/ast.ts'
import { CompileError } from '../errors.ts'
import type { Shared } from './shared.ts'
import { format_type, is_reference_type, type Type } from '../types.ts'

// An extern's type is a function type, which gives the C function's parameters and result. A C
// function has one C type, so all the externs of a symbol in the program must agree on it; a String
// and a Binary, both pointers, can stand for the same parameter.
export const declare_externs = (
  program: Program,
  { resolver, imports, extern_types, module_name }: Shared,
): void => {
  for (const statement of program) {
    if (statement.kind !== 'extern') continue
    const type = resolver.resolve(statement.type, true)
    if (type.kind !== 'function') {
      const { line, column } = statement.type
      throw new CompileError('an extern is a C function, of a function type', line, column)
    }
    reject_optionals_without_c_type(type, statement.type)
    const { symbol } = statement
    const declared = extern_types.get(symbol.name)
    if (declared !== undefined && c_signature(declared.type) !== c_signature(type)) {
      const message = `the C function '${symbol.name}' is declared as ${format_type(declared.type)} in ${declared.module_name}`
      throw new CompileError(message, symbol.line, symbol.column)
    }
    if (declared === undefined) extern_types.set(symbol.name, { type, module_name })
    imports.add_extern(statement.name, type, symbol.name)
  }
}

// Of the optional values that are not references, only an Int? has a C type, LertaOptionalInt.
const reject_optionals_without_c_type = (type: Type, at: Position): void => {
  if (type.kind !== 'function') return
  for (const value_type of [...type.params, type.result]) {
    const is_value = value_type.kind === 'Optional' && !is_reference_type(value_type)
    if (is_value && value_type.inner.kind !== 'Int') {
      const message = `a C function cannot take or return a ${format_type(value_type)}; of the optional values, only references and Int? have a C type`
      throw new CompileError(message, at.line, at.column)
    }
  }
}

// The C type that a value of the type is passed as: a reference is a pointer, and an Int? a pair of
// a flag and the value (LertaOptionalInt in runtime/lerta.h; see codegen/lerta_ir.ts).
const c_type = (type: Type): string => {
  if (is_reference_type(type)) return 'pointer'
  return type.kind === 'Optional' ? `${c_type(type.inner)}?` : type.kind
}

const c_signature = (type: Type): string => {
  if (type.kind !== 'function') throw new Error('an extern has a function type')
  return `(${type.params.map(c_type).join(', ')}) -> ${c_type(type.result)}`
}
