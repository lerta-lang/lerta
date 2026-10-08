// Reads the entry module and the modules it imports, directly or not, including std:builtins, which
// the others import (see builtins_module).
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import type { Import, Program } from './syntax/ast.ts'
import { CompileError } from './errors.ts'
import { tokenize } from './syntax/lexer.ts'
import { parse } from './syntax/parser.ts'

export type Module = {
  // Its position in the list of modules, which keeps its symbols apart from the others'.
  index: number
  // For diagnostics: relative to the entry module's directory, or `std:name` for a standard module;
  // undefined for the entry module.
  display_path: string | undefined
  program: Program
  // The modules that its imports refer to.
  imported: Map<Import, Module>
}

// The standard modules, `std:name`, are the files of this directory.
const std_dir = join(import.meta.dirname, '../../std')

// Every module imports std:builtins, as `import 'std:builtins'`, for the builtin functions and the
// methods of the builtin types that it gives; all but std:builtins itself and the standard modules
// that it imports, directly or not, which cannot use them.
export const builtins_module = 'std:builtins'
const builtins_import = (): Import => ({
  kind: 'import',
  names: [],
  module: builtins_module,
  line: 1,
  column: 1,
})
// std:builtins and the standard modules it imports, which cannot import it back.
const builtins_and_dependencies = ['builtins', 'io'].map((name) =>
  realpathSync(join(std_dir, `${name}.lerta`)),
)

// The file an import names: a path that starts with `./` or `../` is relative to `from`, the
// directory of the importing file; `std:name` is a standard module. Other names are reserved.
const imported_file = (statement: Import, from: string): string => {
  const { module } = statement
  if (module.startsWith('./') || module.startsWith('../')) return join(from, `${module}.lerta`)
  const std_name = module.startsWith('std:') ? module.slice('std:'.length) : undefined
  if (std_name !== undefined && std_modules().includes(std_name)) {
    return join(std_dir, `${std_name}.lerta`)
  }
  const message =
    std_name === undefined
      ? `unknown module '${module}'; a file is imported by a path that starts with ./ or ../`
      : `unknown module '${module}'; the standard modules are ${std_modules()
          .map((name) => `std:${name}`)
          .join(', ')}`
  throw new CompileError(message, statement.line, statement.column)
}

// The names of the standard modules, the files of std_dir.
const std_modules = (): string[] =>
  readdirSync(std_dir)
    .filter((file) => file.endsWith('.lerta'))
    .map((file) => file.slice(0, -'.lerta'.length))
    .sort()

// An entry path that names no file, which has no line to report a compile error at.
export class SourceFileError extends Error {}

// The modules, each after those it imports, so the entry module comes last.
export const load_modules = (entry_path: string): Module[] => {
  if (!is_file(entry_path)) throw new SourceFileError(`'${entry_path}' is not a file`)
  const modules: Module[] = []
  const by_real_path = new Map<string, Module>()
  const loading = new Set<string>()
  const entry_dir = dirname(entry_path)

  // Files are known by their real paths, so that one file reached by different paths loads once,
  // and a module's imports are relative to where it really is. Diagnostics name a module by a path
  // from the entry module's directory as given.
  const load = (path: string, display_path: string | undefined): Module => {
    const real_path = realpathSync(path)
    const program = with_module_path(display_path, () =>
      parse(tokenize(readFileSync(path, 'utf8'))),
    )
    if (!builtins_and_dependencies.includes(real_path)) program.unshift(builtins_import())
    const imported = new Map<Import, Module>()
    loading.add(real_path)
    for (const statement of program) {
      if (statement.kind !== 'import') continue
      const module = with_module_path(display_path, () =>
        visit(imported_file(statement, dirname(real_path)), statement),
      )
      imported.set(statement, module)
    }
    loading.delete(real_path)
    const module = { index: modules.length, display_path, program, imported }
    modules.push(module)
    by_real_path.set(real_path, module)
    return module
  }

  const visit = (path: string, statement: Import): Module => {
    if (!is_file(path)) {
      const message = `cannot find module '${statement.module}'`
      throw new CompileError(message, statement.line, statement.column)
    }
    const real_path = realpathSync(path)
    const loaded = by_real_path.get(real_path)
    if (loaded !== undefined) return loaded
    if (loading.has(real_path)) {
      const message = `'${statement.module}' imports this module back; circular imports are not supported yet`
      throw new CompileError(message, statement.line, statement.column)
    }
    const is_std = dirname(real_path) === realpathSync(std_dir)
    const display_path = is_std ? statement.module : relative(entry_dir, path)
    return load(path, display_path)
  }

  load(entry_path, undefined)
  return modules
}

export const is_standard_module = (module: Module): boolean =>
  module.display_path?.startsWith('std:') ?? false

const is_file = (path: string): boolean =>
  statSync(path, { throwIfNoEntry: false })?.isFile() ?? false

// Runs `f`, giving a compile error that it throws, and the warnings that come with it, the
// module's path unless they have one already.
export const with_module_path = <T>(display_path: string | undefined, f: () => T): T => {
  try {
    return f()
  } catch (error) {
    if (error instanceof CompileError) {
      for (const diagnostic of [error, ...error.warnings]) diagnostic.module_path ??= display_path
    }
    throw error
  }
}
