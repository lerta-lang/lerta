// Generates a function of a program: its blocks, declarations, returns and constructors;
// ControlFlowGenerator generates control flow, and AssignmentGenerator assignments.
import {
  is_expression,
  type Comprehension,
  type Declaration,
  type FunctionLiteral,
  type Jump,
  type Return,
  type Statement,
} from '../syntax/ast.ts'
import type { Checked } from '../check/checker.ts'
import type { Capture, Types } from '../check/shared.ts'
import { AssignmentGenerator } from './assignment_codegen.ts'
import { CheckedInt } from './checked_int.ts'
import { ControlFlowGenerator } from './control_flow_codegen.ts'
import { ThrowBlocks } from './throw_blocks.ts'
import type { BlockGenerator } from './case_codegen.ts'
import { emit_allocate, emit_cell, emit_cell_pointer, emit_field_pointer } from './heap_object.ts'
import {
  emit_capture_pointer,
  emit_closure,
  emit_static_closure,
  slot_ir_type,
  type CapturedSlot,
} from './closure_codegen.ts'
import { ExpressionGenerator, type CodegenLocal } from './expression_codegen.ts'
import { IrBuilder, type IrModule } from './ir_builder.ts'
import {
  constructor_symbol,
  emit_release,
  emit_retain,
  ir_return_type,
  ir_type,
  method_symbol,
} from './lerta_ir.ts'
import type { FieldInfo, ObjectInfo, ObjectTypes } from '../check/object_types.ts'
import type { Module } from '../loader.ts'
import { Scopes, type Scope } from '../scopes.ts'
import {
  emit_mark_initialized,
  emit_release_globals,
  type TopLevelGlobal,
} from './top_level_codegen.ts'
import { is_reference_type, void_type, type Type } from '../types.ts'

type CheckedTypes = Pick<
  Checked,
  | 'types'
  | 'conversions'
  | 'objects'
  | 'imports'
  | 'extensions'
  | 'captures'
  | 'shared_vars'
  | 'instances'
>

// The modules and their top-level values, by module index; the module of the code being generated;
// and whether this is its top-level code, which declares its values, rather than a function, which
// uses them once they are initialized.
export type TopLevelContext = {
  modules: Module[]
  globals: Map<string, TopLevelGlobal>[]
  module: Module
  top_level_code: boolean
}

// A top-level value that may be used before it is initialized, so it is checked.
const checked_slot = (global: TopLevelGlobal): CodegenLocal => {
  const { pointer, type } = global
  return { kind: 'slot', pointer, type, top_level: { global, is_checked: true } }
}

export class FunctionGenerator implements BlockGenerator {
  private readonly types: Types
  private readonly objects: ObjectTypes
  private readonly ir: IrBuilder
  private readonly locals: Scopes<CodegenLocal>
  private readonly module: IrModule
  private readonly checked: CheckedTypes
  private readonly function_symbols: Map<string, string>
  private readonly top_level: TopLevelContext
  private readonly throws: ThrowBlocks
  private readonly checked_int: CheckedInt
  private readonly expressions: ExpressionGenerator
  // The result type of the function being generated; lerta_main returns nothing.
  private result_type: Type = void_type
  private readonly control_flow: ControlFlowGenerator
  private readonly assignments: AssignmentGenerator

  constructor(
    module: IrModule,
    checked: CheckedTypes,
    function_symbols: Map<string, string>,
    top_level: TopLevelContext,
  ) {
    this.module = module
    this.checked = checked
    this.function_symbols = function_symbols
    this.top_level = top_level
    // Outside every scope: the module's top-level values, which a function checks to be
    // initialized, and the values it imports. Those of the modules of its import cycle are checked
    // too; the other modules have initialized theirs.
    this.locals = new Scopes<CodegenLocal>((name) => {
      const own = top_level.top_level_code ? undefined : this.own_values().get(name)
      if (own !== undefined) return checked_slot(own)
      const imported = checked.imports.get(name)?.export
      if (imported?.kind !== 'lerta_value') return undefined
      const global = top_level.globals[imported.module_index].get(imported.name)!
      const exporter = top_level.modules[imported.module_index]
      if (top_level.module.cycle?.has(exporter)) return checked_slot(global)
      return { kind: 'slot', pointer: global.pointer, type: global.type }
    })
    this.types = checked.types
    this.objects = checked.objects
    this.ir = new IrBuilder(module)
    this.throws = new ThrowBlocks(this.ir)
    this.checked_int = new CheckedInt(this.ir, this.throws)
    this.expressions = new ExpressionGenerator(
      this.ir,
      checked,
      this.throws,
      this.checked_int,
      this.locals,
      function_symbols,
      this,
    )
    this.control_flow = new ControlFlowGenerator(
      this,
      this.ir,
      this.types,
      this.locals,
      this.expressions,
    )
    this.assignments = new AssignmentGenerator(
      this.ir,
      this.types,
      this.objects,
      this.locals,
      this.expressions,
      this.checked_int,
    )
  }

  // `runs_first` are the symbols of the top-level code of the imported modules; the values of all
  // modules are released at the end of the entry module's.
  generate_main(
    statements: Statement[],
    signature: string,
    runs_first: string[],
    releases: TopLevelGlobal[],
  ): void {
    for (const symbol of runs_first) this.ir.emit(`call void ${symbol}()`)
    this.generate_block(statements)
    emit_release_globals(this.ir, releases)
    this.ir.emit('ret void')
    this.finish(signature)
  }

  private own_values(): Map<string, TopLevelGlobal> {
    return this.top_level.globals[this.top_level.module.index]
  }

  generate_comprehension(comprehension: Comprehension): string {
    return this.control_flow.generate_comprehension(comprehension)
  }

  generate_closure(literal: FunctionLiteral): string {
    const captures = this.checked.captures.get(literal)!
    const symbol = this.module.fresh_symbol('lerta.lambda')
    const body_generator = new FunctionGenerator(this.module, this.checked, this.function_symbols, {
      ...this.top_level,
      top_level_code: false,
    })
    body_generator.generate_function(symbol, literal, undefined, captures)
    const captured = captures.map(({ name, type, is_var }) => {
      const local = this.locals.lookup(name)!
      if (!is_var) {
        const slot = { kind: 'value', type } as const
        return { slot, operand: this.expressions.read_local(local, type) }
      }
      if (local.kind !== 'slot' || local.cell === undefined)
        throw new Error(`the captured var '${name}' has no cell`)
      emit_retain(this.ir, local.cell.cell)
      return { slot: { kind: 'cell' } as const, operand: local.cell.cell }
    })
    return captured.length === 0
      ? emit_static_closure(this.ir, symbol)
      : emit_closure(this.ir, symbol, captured)
  }

  // Parameters are borrowed SSA values; a method gets its object first, as `@`, and a function
  // literal its closure, from which it reads the values it captures. The last statement, if an
  // expression, gives the result.
  generate_function(
    symbol: string,
    literal: FunctionLiteral,
    this_type: Type | undefined,
    captures?: Capture[],
  ): void {
    const type = this.types.get(literal)!
    if (type.kind !== 'function') throw new Error('a function literal has a function type')
    this.result_type = type.result
    const params = literal.params.map((param, i) => ({
      name: param.name.name,
      type: type.params[i],
    }))
    const scope = this.locals.push()
    if (this_type !== undefined)
      scope.set('@', { kind: 'value', operand: '%this', type: this_type })
    for (const [i, param] of params.entries()) {
      scope.set(param.name, { kind: 'value', operand: `%p${i}`, type: param.type })
    }
    // A captured var is its cell, which the closure holds; the literal reads and writes through it.
    const slots = (captures ?? []).map(({ type, is_var }): CapturedSlot =>
      is_var ? { kind: 'cell' } : { kind: 'value', type },
    )
    for (const [i, { name, type, is_var }] of (captures ?? []).entries()) {
      const pointer = emit_capture_pointer(this.ir, '%closure', slots, i)
      const value = this.ir.assign(`load ${slot_ir_type(slots[i])}, ptr ${pointer}`)
      scope.set(
        name,
        is_var
          ? {
              kind: 'slot',
              pointer: emit_cell_pointer(this.ir, type, value),
              type,
              cell: { cell: value, is_owned: false },
            }
          : { kind: 'value', operand: value, type },
      )
    }
    const last = literal.body.at(-1)
    for (const statement of literal.body.slice(0, -1)) this.generate_statement(statement)
    if (last !== undefined && is_expression(last) && type.result.kind !== 'void') {
      this.emit_return(this.expressions.generate(last))
    } else {
      if (last !== undefined) this.generate_statement(last)
      if (type.result.kind === 'void') this.emit_return('')
      else this.ir.emit('unreachable')
    }
    this.locals.pop()
    const param_list = params.map((param, i) => `${ir_type(param.type)} %p${i}`)
    if (this_type !== undefined) param_list.unshift(`${ir_type(this_type)} %this`)
    if (captures !== undefined) param_list.unshift('ptr %closure')
    this.finish(`${ir_return_type(type.result)} ${symbol}(${param_list.join(', ')})`)
  }

  // Takes the constructor arguments (the fields without an initializer, in order) borrowed, as
  // for any call; then computes the other fields in order, and runs `init` last.
  generate_constructor(info: ObjectInfo): void {
    const object = emit_allocate(this.ir, info)
    const arguments_ = info.fields.filter((field) => field.value === undefined)
    for (const [i, field] of arguments_.entries()) {
      if (is_reference_type(field.type!)) emit_retain(this.ir, `%p${i}`)
      this.store_field(object, info, field, `%p${i}`)
    }
    const scope = this.locals.push()
    scope.set('@', { kind: 'value', operand: object, type: info.type })
    for (const field of info.fields) {
      if (field.value !== undefined) {
        this.store_field(object, info, field, this.expressions.generate(field.value))
      }
    }
    this.locals.pop()
    if (info.has_init) this.ir.emit(`call void ${method_symbol(info.type, 'init')}(ptr ${object})`)
    this.ir.emit(`ret ptr ${object}`)
    const params = arguments_.map((field, i) => `${ir_type(field.type!)} %p${i}`).join(', ')
    this.finish(`ptr ${constructor_symbol(info.type)}(${params})`)
  }

  private store_field(object: string, info: ObjectInfo, field: FieldInfo, value: string): void {
    const pointer = emit_field_pointer(this.ir, object, info, field)
    this.ir.emit(`store ${ir_type(field.type!)} ${value}, ptr ${pointer}`)
  }

  private finish(signature: string): void {
    this.throws.emit_blocks()
    this.ir.finish(signature)
  }

  // Releases every scope of the function before returning the owned value. The function's result
  // type decides the instruction: a returned value that never comes (`return throw ...`) is poison.
  private emit_return(value: string): void {
    for (const scope of this.locals.inner_scopes(0)) this.release_scope(scope)
    const result = this.result_type
    const returns_nothing = result.kind === 'void' || result.kind === 'never'
    this.ir.emit(returns_nothing ? 'ret void' : `ret ${ir_type(result)} ${value}`)
  }

  hold(value: string, type: Type): () => void {
    const scope = this.locals.push()
    // The name cannot be written in the source, so no code can read it.
    scope.set('(held)', this.store_in_slot(value, type))
    return () => {
      this.release_scope(scope)
      this.locals.pop()
    }
  }

  // A jump ends the block; the code after it, until the next label, is unreachable.
  generate_jump(jump: Jump | Return): void {
    if (jump.kind !== 'return') return this.control_flow.generate_jump(jump)
    const { value } = jump
    this.emit_return(value === undefined ? '' : this.expressions.generate(value))
    this.ir.start_block(this.ir.fresh_label('unreachable'))
  }

  // A block that gives a value (see BlockGenerator). The value is computed before the locals are
  // released, as it may be one of them.
  generate_block_value(body: Statement[]): string {
    const scope = this.locals.push()
    for (const statement of body.slice(0, -1)) this.generate_statement(statement)
    const last = body.at(-1)!
    const value = is_expression(last) ? this.expressions.generate(last) : ''
    if (!is_expression(last)) this.generate_statement(last)
    this.release_scope(scope)
    this.locals.pop()
    return value
  }

  // A block is a scope: the references held by its locals are released at its end.
  // The body is statements, or a function that generates code in the block's scope.
  generate_block(
    body: Statement[] | (() => void),
    define = (_scope: Scope<CodegenLocal>) => {},
  ): void {
    const scope = this.locals.push()
    define(scope)
    if (Array.isArray(body)) {
      for (const statement of body) this.generate_statement(statement)
    } else {
      body()
    }
    this.release_scope(scope)
    this.locals.pop()
  }

  release_scope(scope: Scope<CodegenLocal>): void {
    for (const local of scope.values()) {
      if (local.kind !== 'slot' || local.top_level !== undefined) continue
      if (local.cell !== undefined) {
        if (local.cell.is_owned) emit_release(this.ir, local.cell.cell)
      } else if (is_reference_type(local.type)) {
        emit_release(this.ir, this.ir.assign(`load ptr, ptr ${local.pointer}`))
      }
    }
  }

  private generate_statement(statement: Statement): void {
    switch (statement.kind) {
      case 'for':
        return this.control_flow.generate_for(statement)
      case 'while':
        return this.control_flow.generate_while(statement)
      case 'if':
        return this.control_flow.generate_if(statement)
      case 'declaration':
        return this.generate_declaration(statement)
      case 'assignment':
        return this.assignments.generate_assignment(statement)
      case 'type_declaration':
      case 'type_alias':
      case 'import':
      case 'extern':
      case 'extend':
        return
      default:
        return this.expressions.release_if_reference(
          statement,
          this.expressions.generate(statement),
        )
    }
  }

  private generate_declaration(declaration: Declaration): void {
    const type = this.types.get(declaration.name)!
    const value = this.expressions.generate(declaration.value)
    const { name } = declaration.name
    const global = this.own_values().get(name)
    const is_top_level = this.top_level.top_level_code && this.locals.depth === 1
    if (this.checked.shared_vars.has(declaration.name)) {
      const cell = emit_cell(this.ir, type, value)
      const pointer = emit_cell_pointer(this.ir, type, cell)
      this.locals.define(name, { kind: 'slot', pointer, type, cell: { cell, is_owned: true } })
      return
    }
    if (!is_top_level || global === undefined) {
      this.locals.define(name, this.store_in_slot(value, type))
      return
    }
    this.ir.emit(`store ${ir_type(type)} ${value}, ptr ${global.pointer}`)
    emit_mark_initialized(this.ir, global)
    const top_level = { global, is_checked: false }
    this.locals.define(name, { kind: 'slot', pointer: global.pointer, type, top_level })
  }

  store_in_slot(value: string, type: Type): CodegenLocal {
    const pointer = this.ir.alloca(ir_type(type))
    this.ir.emit(`store ${ir_type(type)} ${value}, ptr ${pointer}`)
    return { kind: 'slot', pointer, type }
  }
}
