// Where `break`, `continue` and `return` may be written as expressions: where nothing evaluated
// before them is still held, so that jumping away leaves nothing to release. That is a statement,
// the value of a declaration or of an assignment to a variable, and, within those, the fallback of
// `?` and the values of `then`/`else` and of case arms.
import { type Condition, type Expression, type Program, type Statement } from '../syntax/ast.ts'
import { CompileError } from '../errors.ts'

// Which jumps the statements of a block may make. Inside an expression that holds values, such
// as `'a' + case ...`, the statements of an arm may not return, and may only leave or continue a
// loop that starts among them.
type Jumps = { may_return: boolean; may_leave_loop: boolean }

const all_jumps: Jumps = { may_return: true, may_leave_loop: true }
const no_jumps: Jumps = { may_return: false, may_leave_loop: false }

export const reject_misplaced_jumps = (program: Program): void =>
  visit_statements(program, all_jumps)

const visit_statements = (statements: Statement[], jumps: Jumps): void => {
  for (const statement of statements) visit_statement(statement, jumps)
}

const visit_statement = (statement: Statement, jumps: Jumps): void => {
  const in_loop = { ...jumps, may_leave_loop: true }
  switch (statement.kind) {
    case 'declaration':
      return visit(statement.value, jumps)
    case 'assignment':
      visit(statement.target, no_jumps)
      return visit(statement.value, statement.target.kind === 'identifier' ? jumps : no_jumps)
    case 'if':
      visit_condition(statement.condition)
      visit_statements(statement.then_body, jumps)
      return visit_statements(statement.else_body, jumps)
    case 'while':
      visit_condition(statement.condition)
      return visit_statements(statement.body, in_loop)
    case 'for':
      visit(statement.iterable, no_jumps)
      return visit_statements(statement.body, in_loop)
    case 'type_declaration':
    case 'extend':
      for (const member of statement.members) {
        if (member.value !== undefined) visit(member.value, all_jumps)
      }
      return
    case 'import':
    case 'type_alias':
    case 'extern':
      return
    default:
      return visit(statement, jumps)
  }
}

const visit_condition = (condition: Condition): void =>
  visit(condition.kind === 'binding' ? condition.value : condition, no_jumps)

// `jumps` says which jumps the expression itself may be; its operands, which are evaluated while
// others are held, may make none.
const visit = (expression: Expression, jumps: Jumps): void => {
  const operand = (child: Expression) => visit(child, no_jumps)
  switch (expression.kind) {
    case 'break':
    case 'continue':
    case 'return': {
      const allowed = expression.kind === 'return' ? jumps.may_return : jumps.may_leave_loop
      if (!allowed) {
        const message = `'${expression.kind}' cannot be used here: only as a statement or as the value of a declaration or of an assignment to a variable, directly or through '?', then/else or case arms`
        throw new CompileError(message, expression.line, expression.column)
      }
      if (expression.kind === 'return' && expression.value !== undefined) {
        visit(expression.value, jumps)
      }
      return
    }
    case 'coalesce':
      operand(expression.value)
      return visit(expression.fallback, jumps)
    case 'conditional':
      operand(expression.condition)
      visit(expression.then_value, jumps)
      return visit(expression.else_value, jumps)
    case 'case':
      if (expression.subject !== undefined) operand(expression.subject)
      for (const arm of expression.arms) {
        arm.patterns.forEach(operand)
        visit_statements(arm.body, jumps)
      }
      if (expression.otherwise !== undefined) visit_statements(expression.otherwise, jumps)
      return
    case 'function':
      // No loop is outside a function; a jump out of none is an error of its own.
      return visit_statements(expression.body, all_jumps)
    case 'interpolation':
      for (const part of expression.parts) if (typeof part !== 'string') operand(part)
      return
    case 'array':
      return expression.elements.forEach(operand)
    case 'comprehension':
      operand(expression.element)
      operand(expression.iterable)
      if (expression.guard !== undefined) operand(expression.guard)
      return
    case 'record':
      for (const field of expression.fields) operand(field.value)
      return
    case 'map':
      for (const entry of expression.entries) {
        operand(entry.key)
        operand(entry.value)
      }
      return
    case 'call':
      operand(expression.callee)
      expression.args.forEach(operand)
      for (const arg of expression.named_args) operand(arg.value)
      return
    case 'index':
      operand(expression.object)
      return operand(expression.index)
    case 'member':
      return operand(expression.object)
    case 'unary':
    case 'unwrap':
      return operand(expression.operand)
    case 'binary':
      operand(expression.left)
      return operand(expression.right)
    case 'range':
      operand(expression.start)
      return operand(expression.end)
    case 'throw':
      return operand(expression.message)
    case 'is':
      return operand(expression.value)
    case 'string':
    case 'integer':
    case 'boolean':
    case 'nil':
    case 'identifier':
    case 'this':
      return
    default: {
      const unhandled: never = expression
      throw new Error(`no jump check for ${(unhandled as Expression).kind}`)
    }
  }
}
