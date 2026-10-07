export type Position = { line: number; column: number }

export type StringLiteral = Position & { kind: 'string'; value: string }
export type BooleanLiteral = Position & { kind: 'boolean'; value: boolean }
export type IntegerLiteral = Position & { kind: 'integer'; value: bigint }
export type Identifier = Position & { kind: 'identifier'; name: string }
export type Call = Position & { kind: 'call'; callee: Expression; args: Expression[] }
export type UnaryOperator = '-'
export type Unary = Position & { kind: 'unary'; operator: UnaryOperator; operand: Expression }
export const arithmetic_operators = ['+', '-', '*', '/', '%'] as const
export type ArithmeticOperator = (typeof arithmetic_operators)[number]
export const comparison_operators = ['==', '!=', '<', '<=', '>', '>='] as const
export type ComparisonOperator = (typeof comparison_operators)[number]
export const is_arithmetic = (operator: BinaryOperator): operator is ArithmeticOperator =>
  (arithmetic_operators as readonly string[]).includes(operator)
export type BinaryOperator = ArithmeticOperator | ComparisonOperator
export type Binary = Position & {
  kind: 'binary'
  operator: BinaryOperator
  left: Expression
  right: Expression
}

// `start...end`: the integers from start up to, but not including, end.
export type Range = Position & { kind: 'range'; start: Expression; end: Expression }

// `case` without a subject: the first arm whose condition is true gives the value.
export type CaseArm = { condition: Expression; value: Expression }
export type Case = Position & { kind: 'case'; arms: CaseArm[]; otherwise: Expression }

export type Expression =
  | StringLiteral
  | BooleanLiteral
  | IntegerLiteral
  | Identifier
  | Call
  | Unary
  | Binary
  | Range
  | Case

export type For = Position & {
  kind: 'for'
  variable: Identifier
  iterable: Expression
  body: Statement[]
}

export type Statement = Expression | For

export type Program = Statement[]
