// Calls: of functions written in Lerta, of C functions, of closures, of constructors and of
// methods. Arguments are borrowed: the caller releases its temporaries after the call.
import type { Call, Expression, Member } from '../syntax/ast.ts'
import { call_array_method } from './array_codegen.ts'
import type { Checked } from '../check/checker.ts'
import { emit_closure_call } from './closure_codegen.ts'
import type { CodegenLocal, ExpressionGenerator } from './expression_codegen.ts'
import type { Extensions } from '../check/extensions.ts'
import { emit_runtime_call, emit_unreachable } from './extern_codegen.ts'
import type { Imports } from '../check/imports.ts'
import type { IrBuilder } from './ir_builder.ts'
import { call_iter_method, is_iter_method } from './iter_codegen.ts'
import {
  constructor_symbol,
  emit_release,
  extension_symbol,
  instance_symbol,
  ir_return_type,
  ir_type,
  method_symbol,
} from './lerta_ir.ts'
import { call_map_method, emit_map_new } from './map_codegen.ts'
import { find_method, type MethodSource } from '../check/methods.ts'
import type { ObjectTypes } from '../check/object_types.ts'
import { nil_constant } from './optional_codegen.ts'
import type { Scopes } from '../scopes.ts'
import type { Types } from '../check/shared.ts'
import type { Type } from '../types.ts'

export class CallGenerator {
  private readonly expressions: ExpressionGenerator
  private readonly ir: IrBuilder
  private readonly types: Types
  private readonly objects: ObjectTypes
  private readonly imports: Imports
  private readonly extensions: Extensions
  private readonly instances: Checked['instances']
  private readonly locals: Scopes<CodegenLocal>
  // The symbols of top-level functions, own and imported.
  private readonly function_symbols: Map<string, string>

  constructor(
    expressions: ExpressionGenerator,
    ir: IrBuilder,
    checked: Pick<Checked, 'types' | 'objects' | 'imports' | 'extensions' | 'instances'>,
    locals: Scopes<CodegenLocal>,
    function_symbols: Map<string, string>,
  ) {
    this.expressions = expressions
    this.ir = ir
    this.types = checked.types
    this.objects = checked.objects
    this.imports = checked.imports
    this.extensions = checked.extensions
    this.instances = checked.instances
    this.locals = locals
    this.function_symbols = function_symbols
  }

  generate_call(call: Call): string {
    const { callee } = call
    if (callee.kind === 'member') return this.generate_method_call(call, callee)
    const instance = this.instances.get(call)
    if (instance !== undefined) {
      return this.call_function(instance_symbol(instance), instance.type!, call.args)
    }
    const call_type = this.types.get(call)!
    if (callee.kind === 'identifier' && callee.name === 'Map' && this.is_builtin_name('Map')) {
      if (call_type.kind !== 'Map') throw new Error('Map() has a map type')
      return emit_map_new(this.ir, call_type)
    }
    const is_value = callee.kind !== 'identifier' || this.locals.lookup(callee.name) !== undefined
    if (is_value) {
      const closure = this.expressions.generate(callee)
      return this.call_closure(closure, this.types.get(callee)!, call.args)
    }
    const callee_type = this.types.get(callee)!
    if (callee_type.kind === 'Object') return this.generate_construction(call, callee_type)
    const imported = this.imports.get(callee.name)
    if (imported?.export.kind === 'function') {
      const { symbol } = imported.export
      return this.with_arguments(call.args, (operands) => {
        const typed = operands.map((operand, i) => ({
          type: this.expressions.type_at_use(call.args[i]),
          operand,
        }))
        return emit_runtime_call(this.ir, symbol, callee_type, typed)
      })
    }
    return this.call_function(this.function_symbols.get(callee.name)!, callee_type, call.args)
  }

  // The methods of Iters (see call_iter_method) take the object and the arguments; the other
  // methods borrow them, and the object is released after the call. A member that is no method
  // (see find_method) is a field that holds a function.
  private generate_method_call(call: Call, member: Member): string {
    const object_type = this.types.get(member.object)!
    const object = this.expressions.generate(member.object)
    const { name } = member.name
    const source = find_method(object_type, name, this.objects, this.extensions)
    if (source === undefined) {
      const closure = this.expressions.read_field(object, object_type, name)
      return this.call_closure(closure, this.types.get(member)!, call.args)
    }
    if (source.kind === 'builtin' && is_iter_method(object_type, name)) {
      const args = call.args.map((arg) => this.expressions.generate(arg))
      return call_iter_method(this.ir, name, object, object_type, args)
    }
    const result =
      source.kind === 'builtin'
        ? this.with_arguments(call.args, (args) =>
            call_collection_method(this.ir, name, object, object_type, args),
          )
        : this.call_function(
            this.lerta_method_symbol(source, name, call),
            this.types.get(member)!,
            call.args,
            `${ir_type(object_type)} ${object}`,
          )
    this.expressions.release_if_reference(member.object, object)
    return result
  }

  // The symbol of a method written in Lerta: of a class or struct, of an extend, or of the
  // instance of a generic method that the call calls.
  private lerta_method_symbol(source: LertaMethod, name: string, call: Call): string {
    if (source.kind === 'own') return method_symbol(source.receiver, name)
    const { method } = source
    return method.generic === undefined
      ? extension_symbol(method)
      : instance_symbol(this.instances.get(call)!)
  }

  // Calls a function written in Lerta by its symbol; a method gets `receiver`, its object as an IR
  // argument, first.
  private call_function(symbol: string, type: Type, args: Expression[], receiver?: string): string {
    return this.with_arguments(args, (operands) => {
      const typed_args = operands.map(
        (operand, i) => `${ir_type(this.expressions.type_at_use(args[i]))} ${operand}`,
      )
      const all_args = receiver === undefined ? typed_args : [receiver, ...typed_args]
      return this.call_user_function(symbol, type, all_args.join(', '))
    })
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

  // Calls a function value, a closure, which the call owns and releases; it is evaluated before
  // the arguments, as a named function is known before them.
  private call_closure(closure: string, type: Type, args: Expression[]): string {
    const result = this.with_arguments(args, (operands) =>
      emit_closure_call(this.ir, closure, type, operands),
    )
    emit_release(this.ir, closure)
    return result
  }

  // Generates the arguments, which `emit_call` borrows, and releases them after the call.
  private with_arguments(args: Expression[], emit_call: (operands: string[]) => string): string {
    const operands = args.map((arg) => this.expressions.generate(arg))
    const result = emit_call(operands)
    args.forEach((arg, i) => this.expressions.release_if_reference(arg, operands[i]))
    return result
  }

  // The named arguments are evaluated in the order they are written, then passed in the order of
  // the fields; an optional field left out is nil.
  private generate_construction(call: Call, type: Type): string {
    const info = this.objects.info(type)
    const given = new Map(
      call.named_args.map((arg) => [
        arg.name.name,
        { arg, operand: this.expressions.generate(arg.value) },
      ]),
    )
    const args = info.fields
      .filter((field) => field.value === undefined)
      .map((field) => {
        const value = given.get(field.name.name)?.operand ?? nil_constant(field.type!)
        return `${ir_type(field.type!)} ${value}`
      })
    const object = this.ir.assign(`call ptr ${constructor_symbol(info.type)}(${args.join(', ')})`)
    for (const { arg, operand } of given.values()) {
      this.expressions.release_if_reference(arg.value, operand)
    }
    return object
  }

  // A builtin name can be taken by a local or a top-level function.
  private is_builtin_name(name: string): boolean {
    return this.locals.lookup(name) === undefined && !this.function_symbols.has(name)
  }
}

type LertaMethod = Exclude<MethodSource, { kind: 'builtin' }>

const call_collection_method = (
  ir: IrBuilder,
  name: string,
  object: string,
  type: Type,
  args: string[],
): string => {
  if (type.kind === 'Array') return call_array_method(ir, name, object, type.element, args)
  if (type.kind === 'Map') return call_map_method(ir, name, object, args, type)
  throw new Error(`no method '${name}' of ${type.kind}`)
}
