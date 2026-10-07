export type Position = { line: number; column: number }

export type StringLiteral = Position & { kind: 'string'; value: string }
export type IntegerLiteral = Position & { kind: 'integer'; value: bigint }
export type Identifier = Position & { kind: 'identifier'; name: string }
export type Call = Position & { kind: 'call'; callee: Expression; args: Expression[] }
export type UnaryOperator = '-'
export type Unary = Position & { kind: 'unary'; operator: UnaryOperator; operand: Expression }
export type BinaryOperator = '+' | '-' | '*' | '/' | '%'
export type Binary = Position & {
  kind: 'binary'
  operator: BinaryOperator
  left: Expression
  right: Expression
}

export type Expression = StringLiteral | IntegerLiteral | Identifier | Call | Unary | Binary

// Every statement is an expression statement so far.
export type Program = Expression[]
