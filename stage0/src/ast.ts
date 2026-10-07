export type Position = { line: number; column: number }

export type StringLiteral = Position & { kind: 'string'; value: string }
export type BooleanLiteral = Position & { kind: 'boolean'; value: boolean }
export type IntegerLiteral = Position & { kind: 'integer'; value: bigint }
export type Identifier = Position & { kind: 'identifier'; name: string }
export type Call = Position & { kind: 'call'; callee: Expression; args: Expression[] }
// `object.name`; so far only a method of a builtin type, and only when called.
export type Member = Position & { kind: 'member'; object: Expression; name: Identifier }
export type UnaryOperator = '-' | 'not'
export type Unary = Position & { kind: 'unary'; operator: UnaryOperator; operand: Expression }
export const arithmetic_operators = ['+', '-', '*', '/', '%'] as const
export type ArithmeticOperator = (typeof arithmetic_operators)[number]
export const comparison_operators = ['==', '!=', '<', '<=', '>', '>='] as const
export type ComparisonOperator = (typeof comparison_operators)[number]
export const is_arithmetic = (operator: BinaryOperator): operator is ArithmeticOperator =>
  (arithmetic_operators as readonly string[]).includes(operator)
export type LogicalOperator = 'and' | 'or'
export type BinaryOperator = ArithmeticOperator | ComparisonOperator | LogicalOperator
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
  | Member
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

// `const name = value` or `var name = value`.
export type Declaration = Position & {
  kind: 'declaration'
  mutable: boolean
  name: Identifier
  value: Expression
}

export const assignment_operators = ['=', '+=', '-=', '*=', '/=', '%='] as const
export type AssignmentOperator = (typeof assignment_operators)[number]
export type Assignment = Position & {
  kind: 'assignment'
  operator: AssignmentOperator
  target: Identifier
  value: Expression
}

// `else if` is an `if` alone in the else branch.
export type If = Position & {
  kind: 'if'
  condition: Expression
  then_body: Statement[]
  else_body: Statement[]
}

export type While = Position & { kind: 'while'; condition: Expression; body: Statement[] }

export type Jump = Position & { kind: 'break' | 'continue' }

export type Statement = Expression | Declaration | Assignment | If | While | For | Jump

export type Program = Statement[]
