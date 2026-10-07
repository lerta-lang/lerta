// Generates the functions of a program: blocks, declarations, assignments, returns and
// constructors; ControlFlowGenerator generates control flow.
import {
  is_expression,
  type Assignment,
  type AssignmentOperator,
  type Declaration,
  type FunctionLiteral,
  type Index,
  type Member,
  type Return,
  type Statement,
} from './ast.ts'
import type { Checked, Types } from './checker.ts'
import { emit_get, emit_set } from './array_codegen.ts'
import { emit_map_set } from './map_codegen.ts'
import { CheckedInt } from './checked_int.ts'
import { ControlFlowGenerator } from './control_flow_codegen.ts'
import { ThrowBlocks } from './throw_blocks.ts'
import { ExpressionGenerator, slot_pointer, type CodegenLocal } from './expression_codegen.ts'
import { IrBuilder, IrModule } from './ir_builder.ts'
import {
  constructor_symbol,
  emit_release,
  emit_retain,
  function_symbol,
  module_init_symbol,
  ir_return_type,
  ir_type,
  method_symbol,
} from './lerta_ir.ts'
import { define_object, emit_allocate, emit_field_pointer } from './object_codegen.ts'
import type { FieldInfo, ObjectInfo, ObjectTypes } from './object_types.ts'
import type { Module } from './loader.ts'
import { Scopes, type Scope } from './scopes.ts'
import {
  define_top_level_globals,
  emit_mark_initialized,
  emit_release_globals,
  type TopLevelGlobal,
} from './top_level_codegen.ts'
import { is_top_level_value } from './top_level_values.ts'
import { is_reference_type, void_type, type Type } from './types.ts'

type FunctionDeclaration = Declaration & { value: FunctionLiteral }

const is_function_declaration = (statement: Statement): statement is FunctionDeclaration =>
  statement.kind === 'declaration' && statement.value.kind === 'function'

// Emits LLVM IR for the checked modules (see check_modules) as one program. The entry module's
// top-level code becomes lerta_main, which first runs that of the other modules, in order; each
// function, method and constructor becomes a function of its own.
export const generate = (modules: Module[], checked: Checked[]): string => {
  const ir_module = new IrModule()
  const entry = modules.at(-1)!
  const globals = modules.map((module) =>
    define_top_level_globals(
      ir_module,
      module.program.filter(is_top_level_value),
      checked[module.index].types,
    ),
  )
  for (const module of modules) {
    const main =
      module === entry
        ? { signature: 'void @lerta_main()', runs_first: modules.slice(0, -1) }
        : { signature: `void ${module_init_symbol(module.index)}()`, runs_first: [] }
    const generator = (top_level_code = false) =>
      new FunctionGenerator(ir_module, checked[module.index], function_symbols(module, checked), {
        values: globals[module.index],
        top_level_code,
      })
    const is_main_code = (statement: Statement) =>
      !is_function_declaration(statement) && statement.kind !== 'type_declaration'
    generator(true).generate_main(
      module.program.filter(is_main_code),
      main.signature,
      main.runs_first.map((other) => module_init_symbol(other.index)),
      module === entry ? globals.flatMap((values) => [...values.values()]) : [],
    )
    for (const declaration of module.program.filter(is_function_declaration)) {
      const symbol = function_symbol(module.index, declaration.name.name)
      generator().generate_function(symbol, declaration.value, undefined)
    }
    for (const info of checked[module.index].objects.all()) {
      define_object(ir_module, new IrBuilder(ir_module), info)
      generator().generate_constructor(info)
      for (const [name, literal] of info.methods) {
        const symbol = method_symbol(info.declaration.name.name, name)
        generator().generate_function(symbol, literal, info.type)
      }
    }
  }
  return ir_module.render()
}

// The symbols of the functions a module can call by name: its own and those it imports.
const function_symbols = (module: Module, checked: Checked[]): Map<string, string> => {
  const symbols = new Map<string, string>()
  for (const declaration of module.program.filter(is_function_declaration)) {
    symbols.set(declaration.name.name, function_symbol(module.index, declaration.name.name))
  }
  for (const imported of checked[module.index].imports.all()) {
    const { export: export_ } = imported
    if (export_.kind === 'lerta_function') symbols.set(imported.name.name, export_.symbol)
  }
  return symbols
}

type CheckedTypes = Pick<Checked, 'types' | 'conversions' | 'objects' | 'imports'>

export class FunctionGenerator {
  private readonly types: Types
  private readonly objects: ObjectTypes
  private readonly ir: IrBuilder
  private readonly locals: Scopes<CodegenLocal>
  // The top-level values of the module, and whether this is its top-level code, which declares
  // them, rather than a function, which uses them once they are initialized.
  private readonly top_level: { values: Map<string, TopLevelGlobal>; top_level_code: boolean }
  private readonly throws: ThrowBlocks
  private readonly checked_int: CheckedInt
  private readonly expressions: ExpressionGenerator
  // The result type of the function being generated; lerta_main returns nothing.
  private result_type: Type = void_type
  private readonly control_flow: ControlFlowGenerator

  constructor(
    module: IrModule,
    checked: CheckedTypes,
    function_symbols: Map<string, string>,
    top_level: { values: Map<string, TopLevelGlobal>; top_level_code: boolean },
  ) {
    this.top_level = top_level
    this.locals = new Scopes<CodegenLocal>((name) => {
      const global = top_level.top_level_code ? undefined : top_level.values.get(name)
      if (global === undefined) return undefined
      return {
        kind: 'slot',
        pointer: global.pointer,
        type: global.type,
        top_level: { global, is_checked: true },
      }
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
    )
    this.control_flow = new ControlFlowGenerator(
      this,
      this.ir,
      this.types,
      this.locals,
      this.expressions,
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

  // Parameters are borrowed SSA values; a method gets its object first, as `@`. The last
  // statement, if an expression, gives the result.
  generate_function(symbol: string, literal: FunctionLiteral, this_type: Type | undefined): void {
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
    if (this_type !== undefined) param_list.unshift('ptr %this')
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
    const name = info.declaration.name.name
    if (info.has_init) this.ir.emit(`call void ${method_symbol(name, 'init')}(ptr ${object})`)
    this.ir.emit(`ret ptr ${object}`)
    const params = arguments_.map((field, i) => `${ir_type(field.type!)} %p${i}`).join(', ')
    this.finish(`ptr ${constructor_symbol(name)}(${params})`)
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

  private generate_return(return_statement: Return): void {
    const { value } = return_statement
    this.emit_return(value === undefined ? '' : this.expressions.generate(value))
    this.ir.start_block(this.ir.fresh_label('unreachable'))
  }

  // A block is a scope: the references held by its locals are released at its end.
  generate_block(statements: Statement[], define = (_scope: Scope<CodegenLocal>) => {}): void {
    const scope = this.locals.push()
    define(scope)
    for (const statement of statements) this.generate_statement(statement)
    this.release_scope(scope)
    this.locals.pop()
  }

  release_scope(scope: Scope<CodegenLocal>): void {
    for (const local of scope.values()) {
      if (local.kind === 'slot' && local.top_level === undefined && is_reference_type(local.type)) {
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
        return this.generate_assignment(statement)
      case 'return':
        return this.generate_return(statement)
      case 'break':
      case 'continue':
        return this.control_flow.generate_jump(statement)
      case 'type_declaration':
      case 'type_alias':
      case 'import':
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
    const global = this.top_level.values.get(name)
    const is_top_level = this.top_level.top_level_code && this.locals.depth === 1
    if (!is_top_level || global === undefined) {
      this.locals.define(name, this.store_in_slot(value, type))
      return
    }
    this.ir.emit(`store ${ir_type(type)} ${value}, ptr ${global.pointer}`)
    emit_mark_initialized(this.ir, global)
    const top_level = { global, is_checked: false }
    this.locals.define(name, { kind: 'slot', pointer: global.pointer, type, top_level })
  }

  // The new value is stored before the old one is released, which is safe even if they are the
  // same object.
  private generate_assignment(assignment: Assignment): void {
    const { target } = assignment
    if (target.kind === 'index') return this.generate_index_assignment(assignment, target)
    if (target.kind === 'member') return this.generate_field_assignment(assignment, target)
    const local = this.locals.lookup(target.name)!
    if (local.kind !== 'slot') throw new Error('only slots can be assigned')
    const pointer = slot_pointer(this.ir, local)
    const type = ir_type(local.type)
    const { old, value } = this.load_and_evaluate(assignment, () =>
      this.ir.assign(`load ${type}, ptr ${pointer}`),
    )
    const result = this.combine(assignment.operator, old, value, local.type)
    this.ir.emit(`store ${type} ${result}, ptr ${pointer}`)
    if (is_reference_type(local.type)) emit_release(this.ir, old)
  }

  // The field takes the new value's reference and releases the old one.
  private generate_field_assignment(assignment: Assignment, target: Member): void {
    const object_type = this.types.get(target.object)!
    const info = this.objects.info(object_type)
    const field = info.fields.find((field) => field.name.name === target.name.name)!
    const object = this.expressions.generate(target.object)
    const pointer = emit_field_pointer(this.ir, object, info, field)
    const type = field.type!
    const { old, value } = this.load_and_evaluate(assignment, () =>
      this.ir.assign(`load ${ir_type(type)}, ptr ${pointer}`),
    )
    const result = this.combine(assignment.operator, old, value, type)
    this.ir.emit(`store ${ir_type(type)} ${result}, ptr ${pointer}`)
    if (is_reference_type(type)) emit_release(this.ir, old)
    emit_release(this.ir, object)
  }

  // The array or map retains the new item and releases the old one.
  private generate_index_assignment(assignment: Assignment, target: Index): void {
    const object_type = this.types.get(target.object)!
    if (object_type.kind === 'Map')
      return this.generate_map_assignment(assignment, target, object_type)
    const element = this.types.get(target)!
    const array = this.expressions.generate(target.object)
    const index = this.expressions.generate(target.index)
    const old = assignment.operator === '=' ? '' : emit_get(this.ir, array, index, element)
    const value = this.expressions.generate(assignment.value)
    const result = this.combine(assignment.operator, old, value, element)
    emit_set(this.ir, array, index, result, element)
    if (is_reference_type(element)) emit_release(this.ir, result)
    emit_release(this.ir, array)
  }

  // Only `=` applies to a map value. The key, like an index, is evaluated before the value.
  private generate_map_assignment(
    assignment: Assignment,
    target: Index,
    type: Extract<Type, { kind: 'Map' }>,
  ): void {
    const map = this.expressions.generate(target.object)
    const key = this.expressions.generate(target.index)
    const value = this.expressions.generate(assignment.value)
    emit_map_set(this.ir, map, key, value, type)
    this.expressions.release_if_reference(target.index, key)
    this.expressions.release_if_reference(assignment.value, value)
    emit_release(this.ir, map)
  }

  // For `=`, the value is evaluated before the old one is loaded, since evaluating it may change
  // the target (a method that assigns the same field, for example); releasing a stale old value
  // would then free it twice. For `+=` and so on, the old Int is loaded first, as it is combined.
  private load_and_evaluate(
    assignment: Assignment,
    load: () => string,
  ): { old: string; value: string } {
    if (assignment.operator !== '=') {
      const old = load()
      return { old, value: this.expressions.generate(assignment.value) }
    }
    const value = this.expressions.generate(assignment.value)
    return { old: load(), value }
  }

  // The value to store: the new one for `=`, or the old one combined with it for `+=` and so on.
  private combine(operator: AssignmentOperator, old: string, value: string, type: Type): string {
    if (operator === '=') return value
    return this.checked_int.apply(operator[0] as '+' | '-' | '*' | '/' | '%', old, value, type)
  }

  store_in_slot(value: string, type: Type): CodegenLocal {
    const pointer = this.ir.alloca(ir_type(type))
    this.ir.emit(`store ${ir_type(type)} ${value}, ptr ${pointer}`)
    return { kind: 'slot', pointer, type }
  }
}
