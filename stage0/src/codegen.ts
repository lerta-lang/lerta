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
  type Program,
  type Return,
  type Statement,
} from './ast.ts'
import type { Checked, Types } from './checker.ts'
import { emit_get, emit_set } from './array_codegen.ts'
import { CheckedInt } from './checked_int.ts'
import { ControlFlowGenerator } from './control_flow_codegen.ts'
import { ThrowBlocks } from './throw_blocks.ts'
import { ExpressionGenerator, type CodegenLocal } from './expression_codegen.ts'
import { IrBuilder, IrModule } from './ir_builder.ts'
import {
  constructor_symbol,
  emit_release,
  emit_retain,
  function_symbol,
  ir_return_type,
  ir_type,
  method_symbol,
} from './lerta_ir.ts'
import { define_object, emit_allocate, emit_field_pointer } from './object_codegen.ts'
import type { FieldInfo, ObjectInfo, ObjectTypes } from './object_types.ts'
import { Scopes, type Scope } from './scopes.ts'
import { is_reference_type, type Type } from './types.ts'

type FunctionDeclaration = Declaration & { value: FunctionLiteral }

const is_function_declaration = (statement: Statement): statement is FunctionDeclaration =>
  statement.kind === 'declaration' && statement.value.kind === 'function'

// Emits LLVM IR for a checked program: its top-level code becomes lerta_main; each top-level
// function, method and constructor becomes a function of its own.
export const generate = (program: Program, checked: CheckedTypes): string => {
  const module = new IrModule()
  const functions = program.filter(is_function_declaration)
  const function_names = new Set(functions.map((declaration) => declaration.name.name))
  const new_generator = () => new FunctionGenerator(module, checked, function_names)
  const is_main_code = (statement: Statement) =>
    !is_function_declaration(statement) && statement.kind !== 'type_declaration'
  new_generator().generate_main(program.filter(is_main_code))
  for (const declaration of functions) {
    const symbol = function_symbol(declaration.name.name)
    new_generator().generate_function(symbol, declaration.value, undefined)
  }
  for (const info of checked.objects.all()) {
    define_object(module, new IrBuilder(module), info)
    new_generator().generate_constructor(info)
    for (const [name, literal] of info.methods) {
      const symbol = method_symbol(info.declaration.name.name, name)
      new_generator().generate_function(symbol, literal, info.type)
    }
  }
  return module.render()
}

type CheckedTypes = Pick<Checked, 'types' | 'conversions' | 'objects'>

export class FunctionGenerator {
  private readonly types: Types
  private readonly objects: ObjectTypes
  private readonly ir: IrBuilder
  private readonly locals = new Scopes<CodegenLocal>()
  private readonly throws: ThrowBlocks
  private readonly checked_int: CheckedInt
  private readonly expressions: ExpressionGenerator
  private readonly control_flow: ControlFlowGenerator

  constructor(module: IrModule, checked: CheckedTypes, function_names: Set<string>) {
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
      function_names,
    )
    this.control_flow = new ControlFlowGenerator(
      this,
      this.ir,
      this.types,
      this.locals,
      this.expressions,
    )
  }

  generate_main(statements: Statement[]): void {
    this.generate_block(statements)
    this.ir.emit('ret void')
    this.finish('void @lerta_main()')
  }

  // Parameters are borrowed SSA values; a method gets its object first, as `@`. The last
  // statement, if an expression, gives the result.
  generate_function(symbol: string, literal: FunctionLiteral, this_type: Type | undefined): void {
    const type = this.types.get(literal)!
    if (type.kind !== 'function') throw new Error('a function literal has a function type')
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
      this.emit_return(type.result, this.expressions.generate(last))
    } else {
      if (last !== undefined) this.generate_statement(last)
      if (type.result.kind === 'void') this.emit_return(type.result, '')
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

  // Releases every scope of the function before returning the owned value.
  private emit_return(type: Type, value: string): void {
    for (const scope of this.locals.inner_scopes(0)) this.release_scope(scope)
    this.ir.emit(type.kind === 'void' ? 'ret void' : `ret ${ir_type(type)} ${value}`)
  }

  private generate_return(return_statement: Return): void {
    const { value } = return_statement
    const type = value === undefined ? undefined : this.expressions.type_at_use(value)
    const operand = value === undefined ? '' : this.expressions.generate(value)
    this.emit_return(type ?? { kind: 'void' }, operand)
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
      if (local.kind === 'slot' && is_reference_type(local.type)) {
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
    this.locals.define(declaration.name.name, this.store_in_slot(value, type))
  }

  // The new value is stored before the old one is released, which is safe even if they are the
  // same object.
  private generate_assignment(assignment: Assignment): void {
    const { target } = assignment
    if (target.kind === 'index') return this.generate_index_assignment(assignment, target)
    if (target.kind === 'member') return this.generate_field_assignment(assignment, target)
    const local = this.locals.lookup(target.name)!
    if (local.kind !== 'slot') throw new Error('only slots can be assigned')
    const type = ir_type(local.type)
    const { old, value } = this.load_and_evaluate(assignment, () =>
      this.ir.assign(`load ${type}, ptr ${local.pointer}`),
    )
    const result = this.combine(assignment.operator, old, value, local.type)
    this.ir.emit(`store ${type} ${result}, ptr ${local.pointer}`)
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

  // The array retains the new item and releases the old one.
  private generate_index_assignment(assignment: Assignment, target: Index): void {
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
