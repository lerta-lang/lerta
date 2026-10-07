// Generates operators: arithmetic, comparisons, `and`/`or`, nil tests, `!` and `?`.
import {
  is_arithmetic,
  is_nil_test,
  type Binary,
  type Coalesce,
  type ComparisonOperator,
  type Unary,
  type Unwrap,
} from './ast.ts'
import type { Types } from './checker.ts'
import type { CheckedInt } from './checked_int.ts'
import type { ExpressionGenerator } from './expression_codegen.ts'
import type { IrBuilder } from './ir_builder.ts'
import { ir_type } from './lerta_ir.ts'
import { emit_is_present, emit_unwrap } from './optional_codegen.ts'
import { emit_concat, emit_equals } from './string_codegen.ts'
import type { ThrowBlocks } from './throw_blocks.ts'

const comparison_predicates: Record<ComparisonOperator, string> = {
  '==': 'eq',
  '!=': 'ne',
  '<': 'slt',
  '<=': 'sle',
  '>': 'sgt',
  '>=': 'sge',
}

export class OperatorGenerator {
  private readonly expressions: ExpressionGenerator
  private readonly ir: IrBuilder
  private readonly types: Types
  private readonly checked_int: CheckedInt
  private readonly throws: ThrowBlocks

  constructor(
    expressions: ExpressionGenerator,
    ir: IrBuilder,
    types: Types,
    checked_int: CheckedInt,
    throws: ThrowBlocks,
  ) {
    this.expressions = expressions
    this.ir = ir
    this.types = types
    this.checked_int = checked_int
    this.throws = throws
  }

  generate_unary(unary: Unary): string {
    if (unary.operator === 'not') {
      return this.ir.assign(`xor i1 ${this.expressions.generate_condition(unary.operand)}, true`)
    }
    const operand = this.expressions.generate(unary.operand)
    return this.checked_int.apply('-', '0', operand, this.types.get(unary)!)
  }

  generate_binary(binary: Binary): string {
    if (binary.operator === 'and' || binary.operator === 'or') return this.generate_logical(binary)
    if (is_nil_test(binary)) return this.generate_nil_test(binary)
    const left = this.expressions.generate(binary.left)
    const right = this.expressions.generate(binary.right)
    const { operator } = binary
    if (this.types.get(binary.left)!.kind === 'String') {
      if (operator === '+') return emit_concat(this.ir, [left, right])
      const equal = emit_equals(this.ir, left, right)
      return operator === '==' ? equal : this.ir.assign(`xor i1 ${equal}, true`)
    }
    const operand_type = this.types.get(binary.left)!
    if (is_arithmetic(operator)) return this.checked_int.apply(operator, left, right, operand_type)
    const is_byte = operand_type.kind === 'UInt8'
    // UInt8 is ordered as unsigned.
    const predicate = comparison_predicates[operator].replace(/^s/, is_byte ? 'u' : 's')
    return this.ir.assign(`icmp ${predicate} ${ir_type(operand_type)} ${left}, ${right}`)
  }

  // `x == nil` or `x != nil`.
  private generate_nil_test(binary: Binary): string {
    const value = binary.left.kind === 'nil' ? binary.right : binary.left
    const operand = this.expressions.generate(value)
    const present = emit_is_present(this.ir, operand, this.types.get(value)!)
    this.expressions.release_if_reference(value, operand)
    return binary.operator === '!=' ? present : this.ir.assign(`xor i1 ${present}, true`)
  }

  // Short-circuit: the right operand is evaluated only when the left one does not decide.
  private generate_logical(binary: Binary): string {
    const left = this.expressions.generate_condition(binary.left)
    const left_block = this.ir.current_block
    const right_label = this.ir.fresh_label('logical.right')
    const end_label = this.ir.fresh_label('logical.end')
    const is_and = binary.operator === 'and'
    const [if_true, if_false] = is_and ? [right_label, end_label] : [end_label, right_label]
    this.ir.emit(`br i1 ${left}, label %${if_true}, label %${if_false}`)
    this.ir.start_block(right_label)
    const right = this.expressions.generate_condition(binary.right)
    const right_block = this.ir.current_block
    this.ir.emit(`br label %${end_label}`)
    this.ir.start_block(end_label)
    const decided = is_and ? 'false' : 'true'
    return this.ir.assign(`phi i1 [ ${decided}, %${left_block} ], [ ${right}, %${right_block} ]`)
  }

  // `x!` throws if x is nil.
  generate_unwrap(unwrap: Unwrap): string {
    const operand = this.expressions.generate(unwrap.operand)
    const type = this.types.get(unwrap.operand)!
    const absent = this.ir.assign(`xor i1 ${emit_is_present(this.ir, operand, type)}, true`)
    this.throws.throw_if(absent, 'unwrapped_nil')
    return emit_unwrap(this.ir, operand, type)
  }

  // The fallback is only evaluated when the value is nil.
  generate_coalesce(coalesce: Coalesce): string {
    const operand = this.expressions.generate(coalesce.value)
    const type = this.types.get(coalesce.value)!
    const present = emit_is_present(this.ir, operand, type)
    const unwrapped = emit_unwrap(this.ir, operand, type)
    const value_block = this.ir.current_block
    const fallback_label = this.ir.fresh_label('coalesce.fallback')
    const end_label = this.ir.fresh_label('coalesce.end')
    this.ir.emit(`br i1 ${present}, label %${end_label}, label %${fallback_label}`)
    this.ir.start_block(fallback_label)
    const fallback = this.expressions.generate(coalesce.fallback)
    const fallback_block = this.ir.current_block
    this.ir.emit(`br label %${end_label}`)
    this.ir.start_block(end_label)
    const inner = ir_type(this.types.get(coalesce)!)
    const incoming = `[ ${unwrapped}, %${value_block} ], [ ${fallback}, %${fallback_block} ]`
    return this.ir.assign(`phi ${inner} ${incoming}`)
  }
}
