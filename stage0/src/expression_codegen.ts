import {
  type Call,
  type Expression,
  type Identifier,
  type Interpolation,
  type Member,
  type Throw,
} from './ast.ts'
import { call_array_method, emit_length } from './array_codegen.ts'
import { emit_binary_length, emit_binary_slice, emit_decode_utf8 } from './binary_codegen.ts'
import { builtins } from './builtins.ts'
import { emit_closure_call, emit_function_closure } from './closure_codegen.ts'
import { CaseGenerator, type BlockGenerator } from './case_codegen.ts'
import { CollectionGenerator } from './collection_codegen.ts'
import type { Conversions, Types } from './checker.ts'
import type { CheckedInt } from './checked_int.ts'
import type { IrBuilder } from './ir_builder.ts'
import {
  emit_release,
  emit_retain,
  constructor_symbol,
  method_symbol,
  ir_param_type,
  ir_return_type,
  ir_type,
  string_constant,
} from './lerta_ir.ts'
import { call_map_method, emit_map_length, emit_map_new } from './map_codegen.ts'
import { emit_is_present, emit_unwrap, emit_wrap, nil_constant } from './optional_codegen.ts'
import { OperatorGenerator } from './operator_codegen.ts'
import { emit_field_pointer, emit_type_test } from './object_codegen.ts'
import type { Imports } from './imports.ts'
import type { ObjectTypes } from './object_types.ts'
import type { Scopes } from './scopes.ts'
import {
  emit_runtime_call,
  emit_std_value,
  emit_unreachable,
  emit_writer_method,
} from './std_codegen.ts'
import { emit_concat, emit_parse_int, emit_to_string } from './string_codegen.ts'
import type { ThrowBlocks } from './throw_blocks.ts'
import { emit_initialized_check, type TopLevelGlobal } from './top_level_codegen.ts'
import { is_reference_type, type Type } from './types.ts'

// A loop variable or a parameter is an SSA value; a `const` or `var` lives in a stack slot.
// A slot of a top-level value is its global (see top_level_codegen.ts); outside the top-level code,
// it is checked to be initialized before it is used.
export type CodegenLocal =
  | { kind: 'value'; operand: string; type: Type }
  | { kind: 'slot'; pointer: string; type: Type; top_level?: TopLevelSlot }

export type TopLevelSlot = { global: TopLevelGlobal; is_checked: boolean }

// The slot's pointer, once a top-level value is known to be initialized.
export const slot_pointer = (
  ir: IrBuilder,
  local: Extract<CodegenLocal, { kind: 'slot' }>,
): string => {
  if (local.top_level?.is_checked) emit_initialized_check(ir, local.top_level.global)
  return local.pointer
}

// Expressions. Each yields an IR operand; a reference-typed one is owned by the consumer.
export class ExpressionGenerator {
  private readonly ir: IrBuilder
  private readonly types: Types
  private readonly locals: Scopes<CodegenLocal>
  // The symbols of top-level functions, own and imported, which a call prefers to a builtin of the
  // same name.
  private readonly function_symbols: Map<string, string>

  private readonly conversions: Conversions
  private readonly objects: ObjectTypes
  private readonly imports: Imports
  private readonly operators: OperatorGenerator
  private readonly cases: CaseGenerator
  private readonly blocks: BlockGenerator
  private readonly collections: CollectionGenerator

  constructor(
    ir: IrBuilder,
    checked: { types: Types; conversions: Conversions; objects: ObjectTypes; imports: Imports },
    throws: ThrowBlocks,
    checked_int: CheckedInt,
    locals: Scopes<CodegenLocal>,
    function_symbols: Map<string, string>,
    blocks: BlockGenerator,
  ) {
    this.ir = ir
    this.types = checked.types
    this.conversions = checked.conversions
    this.objects = checked.objects
    this.imports = checked.imports
    this.operators = new OperatorGenerator(this, ir, checked.types, checked_int, throws)
    this.blocks = blocks
    this.cases = new CaseGenerator(this, ir, checked.types, blocks)
    this.collections = new CollectionGenerator(this, ir, checked.types)
    this.locals = locals
    this.function_symbols = function_symbols
  }

  // Returns the IR operand holding the value, converted where it is used (an Int as an Int?, for
  // example); void calls return ''.
  generate(expression: Expression): string {
    const target = this.conversions.get(expression)
    if (expression.kind === 'nil') return nil_constant(target!)
    const operand = this.generate_value(expression)
    if (target === undefined) return operand
    return emit_wrap(this.ir, operand, this.types.get(expression)!)
  }

  // The type of the operand that `generate` returns: the type the expression is converted to, if
  // it is.
  type_at_use(expression: Expression): Type {
    return this.conversions.get(expression) ?? this.types.get(expression)!
  }

  // An i1 for a condition: a Bool, or an optional value that holds when not nil (a Bool? holds
  // when it is true).
  generate_condition(expression: Expression): string {
    const operand = this.generate(expression)
    const type = this.types.get(expression)!
    if (type.kind !== 'Optional') return operand
    const present = emit_is_present(this.ir, operand, type)
    this.release_if_reference(expression, operand)
    if (type.inner.kind !== 'Bool') return present
    const value = emit_unwrap(this.ir, operand, type)
    return this.ir.assign(`and i1 ${present}, ${value}`)
  }

  private generate_value(expression: Expression): string {
    switch (expression.kind) {
      case 'nil':
        throw new Error('nil is generated by generate, where it is converted')
      case 'throw':
        return this.generate_throw(expression)
      case 'break':
      case 'continue':
      case 'return':
        this.blocks.generate_jump(expression)
        return 'poison'
      case 'is': {
        const object = this.generate(expression.value)
        const type = this.types.get(expression.type)!
        if (type.kind !== 'Object') throw new Error('is tests a class or struct')
        const test = emit_type_test(this.ir, object, type)
        emit_release(this.ir, object)
        return test
      }
      case 'this': {
        const object = this.locals.lookup('@')!
        if (object.kind !== 'value') throw new Error('@ is a value')
        emit_retain(this.ir, object.operand)
        return object.operand
      }
      case 'unwrap':
        return this.operators.generate_unwrap(expression)
      case 'coalesce':
        return this.operators.generate_coalesce(expression)
      case 'string':
        if (this.types.get(expression)!.kind === 'UInt8') {
          return new TextEncoder().encode(expression.value)[0].toString()
        }
        return string_constant(this.ir, expression.value)
      case 'interpolation':
        return this.generate_interpolation(expression)
      case 'integer':
        return expression.value.toString()
      case 'boolean':
        return expression.value ? 'true' : 'false'
      case 'call':
        return this.generate_call(expression)
      case 'unary':
        return this.operators.generate_unary(expression)
      case 'binary':
        return this.operators.generate_binary(expression)
      case 'case':
        return this.cases.generate(expression)
      case 'conditional':
        return this.cases.generate_conditional(expression)
      case 'identifier':
        return this.generate_identifier(expression)
      case 'range':
        throw new Error('ranges are only generated by for')
      case 'member':
        return this.generate_property(expression)
      case 'array':
        return this.collections.generate_array(expression)
      case 'map':
        return this.collections.generate_map(expression)
      case 'index':
        return this.collections.generate_index(expression)
      case 'function':
        return this.blocks.generate_closure(expression)
    }
  }

  // Arguments are borrowed: the caller releases its temporaries after the call.
  private generate_call(call: Call): string {
    const { callee } = call
    if (callee.kind === 'member') return this.generate_method_call(call, callee)
    const call_type = this.types.get(call)!
    if (callee.kind === 'identifier' && callee.name === 'Map' && this.is_builtin_name('Map')) {
      if (call_type.kind !== 'Map') throw new Error('Map() has a map type')
      return emit_map_new(this.ir, call_type)
    }
    const is_value = callee.kind !== 'identifier' || this.locals.lookup(callee.name) !== undefined
    if (is_value)
      return this.call_closure(this.generate(callee), this.types.get(callee)!, call.args)
    const callee_type = this.types.get(callee)!
    if (callee_type.kind === 'Object') return this.generate_construction(call, callee_type)
    const imported = this.locals.lookup(callee.name) ? undefined : this.imports.get(callee.name)
    if (imported?.export.kind === 'function') {
      const operands = call.args.map((arg) => ({
        type: this.type_at_use(arg),
        operand: this.generate(arg),
      }))
      const result = emit_runtime_call(this.ir, imported.export.symbol, callee_type, operands)
      call.args.forEach((arg, i) => this.release_if_reference(arg, operands[i].operand))
      return result
    }
    const arg_types = call.args.map((arg) => this.type_at_use(arg))
    const operands = call.args.map((arg) => this.generate(arg))
    const args = operands.map((operand, i) => `${ir_type(arg_types[i])} ${operand}`).join(', ')
    const symbol = this.function_symbols.get(callee.name)
    const result =
      symbol !== undefined
        ? this.call_user_function(symbol, callee_type, args)
        : this.call_builtin(callee.name, arg_types, args)
    call.args.forEach((arg, i) => this.release_if_reference(arg, operands[i]))
    return result
  }

  // Calls a function value, a closure, which the call owns and releases; it is evaluated before
  // the arguments, as a named function is known before them.
  private call_closure(closure: string, type: Type, args: Expression[]): string {
    const operands = args.map((arg) => this.generate(arg))
    const result = emit_closure_call(this.ir, closure, type, operands)
    args.forEach((arg, i) => this.release_if_reference(arg, operands[i]))
    emit_release(this.ir, closure)
    return result
  }

  // The named arguments are evaluated in the order they are written, then passed in the order of
  // the fields; an optional field left out is nil.
  private generate_construction(call: Call, type: Type): string {
    const info = this.objects.info(type)
    const given = new Map(
      call.named_args.map((arg) => [arg.name.name, { arg, operand: this.generate(arg.value) }]),
    )
    const args = info.fields
      .filter((field) => field.value === undefined)
      .map((field) => {
        const value = given.get(field.name.name)?.operand ?? nil_constant(field.type!)
        return `${ir_type(field.type!)} ${value}`
      })
    const object = this.ir.assign(`call ptr ${constructor_symbol(info.type)}(${args.join(', ')})`)
    for (const { arg, operand } of given.values()) this.release_if_reference(arg.value, operand)
    return object
  }

  // A builtin name can be taken by a local or a top-level function.
  private is_builtin_name(name: string): boolean {
    return this.locals.lookup(name) === undefined && !this.function_symbols.has(name)
  }

  private call_user_function(symbol: string, type: Type, args: string): string {
    if (type.kind !== 'function') throw new Error('a called function has a function type')
    const call = `call ${ir_return_type(type.result)} ${symbol}(${args})`
    if (type.result.kind !== 'void' && type.result.kind !== 'never') return this.ir.assign(call)
    this.ir.emit(call)
    if (type.result.kind !== 'never') return ''
    emit_unreachable(this.ir)
    return 'poison'
  }

  private call_builtin(name: string, arg_types: Type[], args: string): string {
    const symbol = builtins.get(name)!.runtime_symbol(arg_types)
    const params = arg_types.map(ir_param_type).join(', ')
    this.ir.declare(symbol, `declare void @${symbol}(${params})`)
    this.ir.emit(`call void @${symbol}(${args})`)
    return ''
  }

  // `to_string()` passes on the object's ownership (a String returns itself); the other methods
  // borrow the object and release it after the call, as they do the arguments.
  private generate_method_call(call: Call, member: Member): string {
    const object_type = this.types.get(member.object)!
    const object = this.generate(member.object)
    const { name } = member.name
    if (object_type.kind === 'Writer') {
      const args = call.args.map((arg) => this.generate(arg))
      emit_writer_method(this.ir, name, object, args)
      call.args.forEach((arg, i) => this.release_if_reference(arg, args[i]))
      return ''
    }
    if (object_type.kind === 'Object' && !this.objects.info(object_type).methods.has(name)) {
      // A field that holds a function.
      const closure = this.read_field(object, object_type, member)
      return this.call_closure(closure, this.types.get(member)!, call.args)
    }
    if (object_type.kind === 'Object') {
      const args = call.args.map((arg) => this.generate(arg))
      const typed_args = args.map((arg, i) => `${ir_type(this.type_at_use(call.args[i]))} ${arg}`)
      const symbol = method_symbol(object_type, name)
      const result = this.call_user_function(
        symbol,
        this.types.get(member)!,
        [`ptr ${object}`, ...typed_args].join(', '),
      )
      call.args.forEach((arg, i) => this.release_if_reference(arg, args[i]))
      emit_release(this.ir, object)
      return result
    }
    if (name === 'to_string') return emit_to_string(this.ir, object, object_type)
    if (name === 'to_int') return this.ir.assign(`zext i8 ${object} to i64`)
    if (name === 'parse_int' || name === 'decode_utf8') {
      const result =
        name === 'parse_int' ? emit_parse_int(this.ir, object) : emit_decode_utf8(this.ir, object)
      emit_release(this.ir, object)
      return result
    }
    const args = call.args.map((arg) => this.generate(arg))
    const result =
      object_type.kind === 'Array'
        ? call_array_method(this.ir, name, object, object_type.element, args)
        : object_type.kind === 'Map'
          ? call_map_method(this.ir, name, object, args, object_type)
          : emit_binary_slice(this.ir, object, args[0], args[1])
    call.args.forEach((arg, i) => this.release_if_reference(arg, args[i]))
    emit_release(this.ir, object)
    return result
  }

  // A field's value is retained, since every expression yields an owned reference.
  private read_field(object: string, type: Type, member: Member): string {
    const info = this.objects.info(type)
    const field = info.fields.find((field) => field.name.name === member.name.name)!
    const pointer = emit_field_pointer(this.ir, object, info, field)
    const value = this.ir.assign(`load ${ir_type(field.type!)}, ptr ${pointer}`)
    if (is_reference_type(field.type!)) emit_retain(this.ir, value)
    emit_release(this.ir, object)
    return value
  }

  // `s.binary` is the string itself, passing on its ownership; `length` borrows its object.
  private generate_property(member: Member): string {
    const object = this.generate(member.object)
    const object_type = this.types.get(member.object)!
    const object_kind = object_type.kind
    if (object_kind === 'Object') return this.read_field(object, object_type, member)
    if (object_kind === 'String') return object
    const length =
      object_kind === 'Binary'
        ? emit_binary_length(this.ir, object)
        : object_kind === 'Map'
          ? emit_map_length(this.ir, object)
          : emit_length(this.ir, object)
    emit_release(this.ir, object)
    return length
  }

  private generate_interpolation(interpolation: Interpolation): string {
    const parts = interpolation.parts.map((part) =>
      typeof part === 'string'
        ? string_constant(this.ir, part)
        : emit_to_string(this.ir, this.generate(part), this.types.get(part)!),
    )
    return emit_concat(this.ir, parts)
  }

  // Every expression of a reference type yields an owned reference, which its consumer releases.
  release_if_reference(expression: Expression, operand: string): void {
    if (is_reference_type(this.type_at_use(expression))) emit_release(this.ir, operand)
  }

  // Reading a reference from a slot retains it, since every expression yields an owned reference.
  // A local narrowed to its type without nil is read as such.
  private generate_identifier(identifier: Identifier): string {
    const local = this.locals.lookup(identifier.name)
    const symbol = this.function_symbols.get(identifier.name)
    if (local === undefined && symbol !== undefined) {
      return emit_function_closure(this.ir, symbol, this.types.get(identifier)!)
    }
    if (local === undefined) return this.generate_imported_value(identifier)
    return this.read_local(local, this.types.get(identifier)!)
  }

  // The local's value, retained if a reference, as the type it has where it is read: without nil
  // where it is narrowed.
  read_local(local: CodegenLocal, type: Type): string {
    const value =
      local.kind === 'value'
        ? local.operand
        : this.ir.assign(`load ${ir_type(local.type)}, ptr ${slot_pointer(this.ir, local)}`)
    if (is_reference_type(local.type)) emit_retain(this.ir, value)
    const is_narrowed = local.type.kind === 'Optional' && type.kind !== 'Optional'
    return is_narrowed ? emit_unwrap(this.ir, value, local.type) : value
  }
  private generate_imported_value(identifier: Identifier): string {
    const imported = this.imports.get(identifier.name)!.export
    if (imported.kind !== 'value') throw new Error('only an imported value is read as a name')
    return emit_std_value(this.ir, imported.read)
  }

  // The message is not released, since the program ends here.
  private generate_throw(throw_expression: Throw): string {
    const message = this.generate(throw_expression.message)
    this.ir.declare('lerta_throw', 'declare void @lerta_throw(ptr) noreturn')
    this.ir.emit(`call void @lerta_throw(ptr ${message})`)
    emit_unreachable(this.ir)
    return 'poison'
  }
}
