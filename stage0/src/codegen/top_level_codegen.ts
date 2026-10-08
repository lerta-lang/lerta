// Top-level values in the generated code. Each is a global, which the top-level code initializes
// and functions read; a flag, set once it is initialized, lets a function that runs before then
// throw instead of reading it.
import type { Declaration } from '../syntax/ast.ts'
import type { Types } from '../check/shared.ts'
import type { IrBuilder, IrModule } from './ir_builder.ts'
import { emit_release, ir_type, string_constant, top_level_symbol } from './lerta_ir.ts'
import { is_reference_type, type Type } from '../types.ts'

export type TopLevelGlobal = { name: string; type: Type; pointer: string; flag: string }

export const define_top_level_globals = (
  module: IrModule,
  module_index: number,
  declarations: Declaration[],
  types: Types,
): Map<string, TopLevelGlobal> =>
  new Map(
    declarations.map((declaration) => {
      const { name } = declaration.name
      const type = types.get(declaration.name)!
      const pointer = top_level_symbol(module_index, name)
      const flag = `${pointer}.set`
      module.define_global(pointer, `internal global ${ir_type(type)} zeroinitializer`)
      module.define_global(flag, 'internal global i1 false')
      return [name, { name, type, pointer, flag }]
    }),
  )

export const emit_mark_initialized = (ir: IrBuilder, global: TopLevelGlobal): void => {
  ir.emit(`store i1 true, ptr ${global.flag}`)
}

// Throws unless the value has been initialized.
export const emit_initialized_check = (ir: IrBuilder, global: TopLevelGlobal): void => {
  const is_set = ir.assign(`load i1, ptr ${global.flag}`)
  const set_label = ir.fresh_label('value.set')
  const unset_label = ir.fresh_label('value.unset')
  ir.emit(`br i1 ${is_set}, label %${set_label}, label %${unset_label}`)
  ir.start_block(unset_label)
  const message = string_constant(ir, `'${global.name}' is used before it is initialized`)
  ir.declare('lerta_throw', 'declare void @lerta_throw(ptr) noreturn')
  ir.emit(`call void @lerta_throw(ptr ${message})`)
  ir.emit('unreachable')
  ir.start_block(set_label)
}

// At the end of the program, the references the values hold.
export const emit_release_globals = (ir: IrBuilder, globals: TopLevelGlobal[]): void => {
  for (const global of globals) {
    if (!is_reference_type(global.type)) continue
    emit_release(ir, ir.assign(`load ptr, ptr ${global.pointer}`))
  }
}
