export type Position = { line: number; column: number }

export type StringLiteral = Position & { kind: 'string'; value: string }
export type Identifier = Position & { kind: 'identifier'; name: string }
export type Call = Position & { kind: 'call'; callee: Expression; args: Expression[] }

export type Expression = StringLiteral | Identifier | Call

// Every statement is an expression statement so far.
export type Program = Expression[]
