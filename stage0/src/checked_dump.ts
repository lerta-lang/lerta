// The syntax trees of a program's modules, as dump_ast writes them, with the types that the
// checker gave their nodes, so that the checker of the compiler written in Lerta can be compared
// with this one.
import { dump_ast } from './ast_dump.ts'
import type { Checked } from './check/checker.ts'
import { is_standard_module, type Module } from './loader.ts'
import type { Expression } from './syntax/ast.ts'
import { format_type } from './types.ts'

export const dump_checked = (entry_path: string, modules: Module[], checked: Checked[]): string =>
  modules
    .filter((module) => !is_standard_module(module))
    .map((module) => {
      const header = `module ${module.display_path ?? entry_path}\n`
      return header + dump_ast(module.program, type_annotation(checked[module.index]))
    })
    .join('')

// ` : <type>`, and ` => <converted type>` if it is converted; nothing for a node without a type.
const type_annotation =
  ({ types, conversions }: Checked) =>
  (node: object): string => {
    const type = types.get(node as Expression)
    if (type === undefined) return ''
    const converted = conversions.get(node as Expression)
    const conversion = converted === undefined ? '' : ` => ${format_type(converted)}`
    return ` : ${format_type(type)}${conversion}`
  }
