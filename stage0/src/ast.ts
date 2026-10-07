export type Position = { line: number; column: number }

export type StringLiteral = Position & { kind: 'string'; value: string }
// `"a#{b}c"`: text parts and interpolated expressions, in order.
export type Interpolation = Position & { kind: 'interpolation'; parts: (string | Expression)[] }
export type NilLiteral = Position & { kind: 'nil' }
export type BooleanLiteral = Position & { kind: 'boolean'; value: boolean }
export type IntegerLiteral = Position & { kind: 'integer'; value: bigint }
export type Identifier = Position & { kind: 'identifier'; name: string }
// `x!`: x without nil; it throws if x is nil.
export type Unwrap = Position & { kind: 'unwrap'; operand: Expression }
// `x ? fallback`: x without nil, or the fallback if x is nil.
export type Coalesce = Position & { kind: 'coalesce'; value: Expression; fallback: Expression }
// `[a, b]`
export type ArrayLiteral = Position & { kind: 'array'; elements: Expression[] }
// `object[index]`
export type Index = Position & { kind: 'index'; object: Expression; index: Expression }
// `f(a, b)`, or `Point(x: 1, y: 2)` with named arguments, which construct a class or struct.
export type NamedArgument = { name: Identifier; value: Expression }
export type Call = Position & {
  kind: 'call'
  callee: Expression
  args: Expression[]
  named_args: NamedArgument[]
}
// `@` inside a method or a field initializer: the object itself. `@x` is `this.x`.
export type This = Position & { kind: 'this' }
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

// A type written in the source, such as `Int` in a parameter.
export type TypeName = Position & {
  kind: 'type_name'
  name: string
  args: TypeName[]
  // Written with `?`: the type or nil.
  optional: boolean
}

export type Parameter = { name: Identifier; type: TypeName }

// `(x: Int): Int -> body`. The body's last expression is the return value.
export type FunctionLiteral = Position & {
  kind: 'function'
  params: Parameter[]
  return_type: TypeName | undefined
  body: Statement[]
}

// `case` without a subject: the first arm whose condition is true gives the value.
export type CaseArm = { condition: Expression; value: Expression }
export type Case = Position & { kind: 'case'; arms: CaseArm[]; otherwise: Expression }

export type Expression =
  | StringLiteral
  | Interpolation
  | BooleanLiteral
  | NilLiteral
  | IntegerLiteral
  | Identifier
  | ArrayLiteral
  | Index
  | Call
  | This
  | Member
  | Unary
  | Binary
  | Unwrap
  | Coalesce
  | Range
  | Case
  | FunctionLiteral

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
  type: TypeName | undefined
  value: Expression
}

export const assignment_operators = ['=', '+=', '-=', '*=', '/=', '%='] as const
export type AssignmentOperator = (typeof assignment_operators)[number]
export type Assignment = Position & {
  kind: 'assignment'
  operator: AssignmentOperator
  target: Identifier | Index | Member
  value: Expression
}

// `if const name = value`: the condition holds when value is not nil, and name is the value
// without nil inside the body.
export type Binding = Position & { kind: 'binding'; name: Identifier; value: Expression }

export type Condition = Expression | Binding

// `else if` is an `if` alone in the else branch.
export type If = Position & {
  kind: 'if'
  condition: Condition
  then_body: Statement[]
  else_body: Statement[]
}

export type While = Position & { kind: 'while'; condition: Condition; body: Statement[] }

export type Jump = Position & { kind: 'break' | 'continue' }

export type Return = Position & { kind: 'return'; value: Expression | undefined }

// A member of a class or struct body: a field (with a type, an initial value, or both) or, for a
// function literal value, a method.
export type MemberDeclaration = Position & {
  name: Identifier
  modifier: 'const' | 'var' | undefined
  type: TypeName | undefined
  value: Expression | undefined
}

export type TypeDeclaration = Position & {
  kind: 'type_declaration'
  is_struct: boolean
  name: Identifier
  members: MemberDeclaration[]
}

export type Statement =
  Expression | TypeDeclaration | Declaration | Assignment | If | While | For | Jump | Return

export type Program = Statement[]

const statement_only_kinds = [
  'type_declaration',
  'declaration',
  'assignment',
  'if',
  'while',
  'for',
  'break',
  'continue',
  'return',
]

export const is_expression = (statement: Statement): statement is Expression =>
  !statement_only_kinds.includes(statement.kind)

// `x == nil` or `x != nil`, on either side.
export const is_nil_test = (binary: Binary): boolean =>
  (binary.operator === '==' || binary.operator === '!=') &&
  (binary.left.kind === 'nil' || binary.right.kind === 'nil')
