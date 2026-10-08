// A program's syntax tree as text, so that the parser of the compiler written in Lerta can be
// compared with this one. A node is a line `<kind> <line>:<column>`, followed by its other fields,
// one per line, indented under it, in the order of their names; a field that is a node or a list
// puts its contents on the next lines, indented further, with each item of a list after `-`. A
// group of fields without a kind writes its position, if it has one, as ordinary fields.
import type { Program } from './syntax/ast.ts'
import { quote } from './token_dump.ts'

const INDENT = '  '

// The text after a node's header line, such as its type.
export type Annotate = (node: object) => string

export const dump_ast = (program: Program, annotate: Annotate = () => ''): string =>
  dump_list(program, '', annotate)
    .map((line) => `${line}\n`)
    .join('')

const dump_object = (object: object, indent: string, annotate: Annotate): string[] => {
  const fields = Object.entries(object)
  const kind = fields.find(([name]) => name === 'kind')
  const head =
    kind === undefined
      ? []
      : [
          `${indent}${String(kind[1])} ${String(field_of(object, 'line'))}:${String(field_of(object, 'column'))}${annotate(object)}`,
        ]
  const field_indent = kind === undefined ? indent : indent + INDENT
  const rest = fields
    .filter(([name]) => kind === undefined || !['kind', 'line', 'column'].includes(name))
    .toSorted(([a], [b]) => (a < b ? -1 : 1))
    .flatMap(([name, value]) => dump_field(name, value, field_indent, annotate))
  return [...head, ...rest]
}

const field_of = (object: object, name: string): unknown =>
  (object as Record<string, unknown>)[name]

const dump_field = (name: string, value: unknown, indent: string, annotate: Annotate): string[] => {
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${indent}${name}: []`]
    return [`${indent}${name}:`, ...dump_list(value, indent + INDENT, annotate)]
  }
  if (typeof value === 'object' && value !== null) {
    return [`${indent}${name}:`, ...dump_object(value, indent + INDENT, annotate)]
  }
  return [`${indent}${name}: ${dump_scalar(value)}`]
}

const dump_list = (items: unknown[], indent: string, annotate: Annotate): string[] =>
  items.flatMap((item) => {
    if (typeof item === 'object' && item !== null) {
      return [`${indent}-`, ...dump_object(item, indent + INDENT, annotate)]
    }
    return [`${indent}- ${dump_scalar(item)}`]
  })

const dump_scalar = (value: unknown): string => {
  if (value === undefined) return '-'
  if (typeof value === 'string') return quote(value)
  return String(value)
}
