// `case` and `then`/`else` in the generated code: the tests of their arms, and the values they
// merge.
import type { Case, CaseArm, Conditional, Expression, Statement } from './ast.ts'
import type { Types } from './checker.ts'
import type { ExpressionGenerator } from './expression_codegen.ts'
import type { IrBuilder } from './ir_builder.ts'
import { emit_release, ir_type } from './lerta_ir.ts'
import { emit_type_test } from './object_codegen.ts'
import { is_reference_type, type Type } from './types.ts'

// Generates a block whose last statement, if an expression, gives its value: the operand, or ''.
export type BlockGenerator = {
  generate_block_value(body: Statement[]): string
}

export class CaseGenerator {
  private readonly blocks: BlockGenerator
  private readonly expressions: ExpressionGenerator
  private readonly ir: IrBuilder
  private readonly types: Types

  constructor(
    expressions: ExpressionGenerator,
    ir: IrBuilder,
    types: Types,
    blocks: BlockGenerator,
  ) {
    this.blocks = blocks
    this.expressions = expressions
    this.ir = ir
    this.types = types
  }

  // The subject is evaluated once and released at the end. The arms are tested in order; every
  // arm jumps to one end block that merges the values. A case over every type of a union has no
  // else arm, and falling past its last test cannot happen.
  generate(case_expression: Case): string {
    const { subject } = case_expression
    const subject_operand = subject === undefined ? undefined : this.expressions.generate(subject)
    const end_label = this.ir.fresh_label('case.end')
    const incoming: string[] = []
    // An arm that ends with a jump gives no operand; it never reaches the end.
    const generate_arm_value = (body: Statement[]) => {
      const operand = this.blocks.generate_block_value(body) || 'poison'
      incoming.push(`[ ${operand}, %${this.ir.current_block} ]`)
      this.ir.emit(`br label %${end_label}`)
    }
    for (const arm of case_expression.arms) {
      const test = this.generate_test(arm, subject, subject_operand)
      const arm_label = this.ir.fresh_label('case.arm')
      const next_label = this.ir.fresh_label('case.next')
      this.ir.emit(`br i1 ${test}, label %${arm_label}, label %${next_label}`)
      this.ir.start_block(arm_label)
      generate_arm_value(arm.body)
      this.ir.start_block(next_label)
    }
    if (case_expression.otherwise === undefined) this.ir.emit('unreachable')
    else generate_arm_value(case_expression.otherwise)
    this.ir.start_block(end_label)
    const result = this.merge(this.types.get(case_expression)!, incoming)
    if (subject !== undefined && is_reference_type(this.types.get(subject)!)) {
      emit_release(this.ir, subject_operand!)
    }
    return result
  }

  // The condition is tested as an `if` tests it; both values jump to one end block that merges
  // them.
  generate_conditional(conditional: Conditional): string {
    const test = this.expressions.generate_condition(conditional.condition)
    const then_label = this.ir.fresh_label('then')
    const else_label = this.ir.fresh_label('else')
    const end_label = this.ir.fresh_label('then.end')
    this.ir.emit(`br i1 ${test}, label %${then_label}, label %${else_label}`)
    const incoming = [
      { label: then_label, value: conditional.then_value },
      { label: else_label, value: conditional.else_value },
    ].map(({ label, value }) => {
      this.ir.start_block(label)
      const operand = this.blocks.generate_block_value([value]) || 'poison'
      const from = this.ir.current_block
      this.ir.emit(`br label %${end_label}`)
      return `[ ${operand}, %${from} ]`
    })
    this.ir.start_block(end_label)
    return this.merge(this.types.get(conditional)!, incoming)
  }

  // The value of the arms at their end block: none for void, and none that comes for never.
  private merge(type: Type, incoming: string[]): string {
    if (type.kind === 'void') return ''
    if (type.kind === 'never') return 'poison'
    return this.ir.assign(`phi ${ir_type(type)} ${incoming.join(', ')}`)
  }

  // An i1 that holds when any of the arm's patterns matches.
  private generate_test(
    arm: CaseArm,
    subject: Expression | undefined,
    operand: string | undefined,
  ): string {
    if (subject === undefined) return this.expressions.generate_condition(arm.patterns[0])
    const subject_type = this.types.get(subject)!
    const tests = arm.patterns.map((pattern) =>
      subject_type.kind === 'Union'
        ? this.type_test(operand!, this.types.get(pattern)!)
        : this.value_test(operand!, subject_type, pattern),
    )
    return tests.reduce((all, test) => this.ir.assign(`or i1 ${all}, ${test}`))
  }

  private type_test(object: string, type: Type): string {
    if (type.kind !== 'Object') throw new Error('a type pattern names a class or struct')
    return emit_type_test(this.ir, object, type.name)
  }

  // The subject is borrowed by the comparison, as it is tested again by the next patterns.
  private value_test(subject: string, type: Type, pattern: Expression): string {
    const value = this.expressions.generate(pattern)
    if (type.kind !== 'String')
      return this.ir.assign(`icmp eq ${ir_type(type)} ${subject}, ${value}`)
    this.ir.declare('lerta_string_equals', 'declare zeroext i1 @lerta_string_equals(ptr, ptr)')
    const equal = this.ir.assign(
      `call zeroext i1 @lerta_string_equals(ptr ${subject}, ptr ${value})`,
    )
    emit_release(this.ir, value)
    return equal
  }
}
