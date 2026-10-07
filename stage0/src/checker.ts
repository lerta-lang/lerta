import {
  is_arithmetic,
  type Binary,
  type Call,
  type Case,
  type Expression,
  type For,
  type Identifier,
  type Member,
  type Program,
  type Statement,
  type Unary,
} from './ast.ts'
import { builtin_methods, builtins } from './builtins.ts'
import { CompileError, CompileWarning } from './errors.ts'
import {
  bool_type,
  format_type,
  int_type,
  is_assignable,
  same_type,
  string_type,
  type Type,
} from './types.ts'

// The type of every expression in a checked program.
export type Types = Map<Expression, Type>

export const check = (program: Program): { types: Types; warnings: CompileWarning[] } => {
  const checker = new Checker()
  try {
    checker.check_statements(program)
  } catch (error) {
    if (error instanceof CompileError) error.warnings = checker.warnings
    throw error
  }
  return { types: checker.types, warnings: checker.warnings }
}

class Checker {
  readonly types: Types = new Map()
  readonly warnings: CompileWarning[] = []
  // Local names, innermost scope last.
  private readonly scopes: Map<string, Type>[] = []

  check_statements(statements: Statement[]): void {
    for (const statement of statements) this.check_statement(statement)
  }

  private check_statement(statement: Statement): void {
    if (statement.kind === 'for') this.check_for(statement)
    else this.check_expression_statement(statement)
  }

  // Only ranges can be iterated so far.
  private check_for(for_statement: For): void {
    const { iterable, variable } = for_statement
    if (iterable.kind !== 'range') {
      throw new CompileError("expected a range after 'in'", iterable.line, iterable.column)
    }
    this.expect_type(iterable.start, int_type)
    this.expect_type(iterable.end, int_type)
    this.with_scope(() => {
      this.define_local(variable, int_type)
      this.check_statements(for_statement.body)
    })
  }

  private with_scope(body: () => void): void {
    this.scopes.push(new Map())
    try {
      body()
    } finally {
      this.scopes.pop()
    }
  }

  // Shadowing a builtin is silent, so that new builtins do not affect existing code. Shadowing a
  // local name is a warning, unless the name starts with `_` to show that it is intended.
  private define_local(identifier: Identifier, type: Type): void {
    const { name, line, column } = identifier
    const is_shadowing = this.scopes.some((scope) => scope.has(name))
    if (is_shadowing && !name.startsWith('_')) {
      this.warnings.push(
        new CompileWarning(`'${name}' shadows a name in an outer scope`, line, column),
      )
    }
    this.scopes.at(-1)!.set(name, type)
    this.types.set(identifier, type)
  }

  private lookup(name: string): Type | undefined {
    for (const scope of this.scopes.toReversed()) {
      const type = scope.get(name)
      if (type !== undefined) return type
    }
    return builtins.get(name)?.type
  }

  // See the rules for discarded values in docs/reference/errors.md.
  private check_expression_statement(statement: Expression): void {
    const type = this.type_of(statement)
    if (statement.kind === 'call' || type.kind === 'void') return
    if (type.kind === 'function' && statement.kind === 'identifier') {
      const message = `function value is unused; to call it, write \`${statement.name}()\``
      throw new CompileError(message, statement.line, statement.column)
    }
    throw new CompileError('value is unused', statement.line, statement.column)
  }

  private type_of(expression: Expression): Type {
    const type = this.compute_type(expression)
    this.types.set(expression, type)
    return type
  }

  private compute_type(expression: Expression): Type {
    switch (expression.kind) {
      case 'string':
        return string_type
      case 'integer':
        return int_type
      case 'boolean':
        return bool_type
      case 'identifier':
        return this.type_of_identifier(expression)
      case 'call':
        return this.type_of_call(expression)
      case 'unary':
        return this.type_of_unary(expression)
      case 'binary':
        return this.type_of_binary(expression)
      case 'case':
        return this.type_of_case(expression)
      case 'member': {
        const message = `a method must be called: write \`${expression.name.name}()\``
        throw new CompileError(message, expression.name.line, expression.name.column)
      }
      case 'range':
        throw new CompileError(
          "a range can only be used after 'in' of a 'for'",
          expression.line,
          expression.column,
        )
    }
  }

  private type_of_identifier(identifier: Identifier): Type {
    const type = this.lookup(identifier.name)
    if (type === undefined) {
      const message = `undefined name '${identifier.name}'`
      throw new CompileError(message, identifier.line, identifier.column)
    }
    return type
  }

  private type_of_call(call: Call): Type {
    const { callee } = call
    const callee_type =
      callee.kind === 'member' ? this.type_of_method(callee) : this.type_of(callee)
    if (callee_type.kind !== 'function') {
      const message = `cannot call a value of type ${format_type(callee_type)}`
      throw new CompileError(message, call.line, call.column)
    }
    const { params } = callee_type
    if (call.args.length !== params.length) {
      const message = `expected ${params.length} argument(s), got ${call.args.length}`
      throw new CompileError(message, call.line, call.column)
    }
    call.args.forEach((arg, i) => this.expect_type(arg, params[i]))
    return callee_type.result
  }

  private type_of_method(member: Member): Type {
    const object_type = this.type_of(member.object)
    const { name, line, column } = member.name
    const method = builtin_methods[object_type.kind]?.get(name)
    if (method === undefined) {
      throw new CompileError(
        `type ${format_type(object_type)} has no method '${name}'`,
        line,
        column,
      )
    }
    this.types.set(member, method)
    return method
  }

  private type_of_unary(unary: Unary): Type {
    this.expect_type(unary.operand, int_type)
    return int_type
  }

  private type_of_binary(binary: Binary): Type {
    if (binary.operator === '==' || binary.operator === '!=') return this.type_of_equality(binary)
    this.expect_type(binary.left, int_type)
    this.expect_type(binary.right, int_type)
    return is_arithmetic(binary.operator) ? int_type : bool_type
  }

  // `==` and `!=` compare two Ints or two Bools.
  private type_of_equality(binary: Binary): Type {
    const left_type = this.type_of(binary.left)
    if (left_type.kind !== 'Int' && left_type.kind !== 'Bool') {
      const message = `cannot compare values of type ${format_type(left_type)}`
      throw new CompileError(message, binary.left.line, binary.left.column)
    }
    this.expect_type(binary.right, left_type)
    return bool_type
  }

  // Every arm must have the type of the first one.
  private type_of_case(case_expression: Case): Type {
    for (const arm of case_expression.arms) this.expect_type(arm.condition, bool_type)
    const [first, ...rest] = case_expression.arms.map((arm) => arm.value)
    const type = this.type_of(first)
    for (const value of [...rest, case_expression.otherwise]) {
      const value_type = this.type_of(value)
      if (!same_type(value_type, type)) {
        const types = `expected ${format_type(type)}, got ${format_type(value_type)}`
        const message = `case arms must have the same type: ${types}`
        throw new CompileError(message, value.line, value.column)
      }
    }
    return type
  }

  private expect_type(expression: Expression, expected: Type): void {
    const type = this.type_of(expression)
    if (!is_assignable(type, expected)) {
      const message = `expected ${format_type(expected)}, got ${format_type(type)}`
      throw new CompileError(message, expression.line, expression.column)
    }
  }
}
