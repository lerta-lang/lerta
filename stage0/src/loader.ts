// Reads the entry module and the modules it imports, directly or not.
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import type { Import, Program } from './syntax/ast.ts'
import { CompileError } from './errors.ts'
import { tokenize } from './syntax/lexer.ts'
import { parse } from './syntax/parser.ts'

export type Module = {
  // Its position in the list of modules, which keeps its symbols apart from the others'.
  index: number
  // Relative to the entry module's directory, for diagnostics; undefined for the entry module.
  display_path: string | undefined
  program: Program
  // The modules that its imports of files refer to.
  imported: Map<Import, Module>
}

// A path that starts with `./` or `../` names a file; others name standard modules.
export const is_file_import = (statement: Import): boolean =>
  statement.module.startsWith('./') || statement.module.startsWith('../')

// The modules, each after those it imports, so the entry module comes last.
export const load_modules = (entry_path: string): Module[] => {
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
    const imported = new Map<Import, Module>()
    loading.add(real_path)
    for (const statement of program) {
      if (statement.kind !== 'import' || !is_file_import(statement)) continue
      const target = join(dirname(real_path), `${statement.module}.lerta`)
      imported.set(
        statement,
        with_module_path(display_path, () => visit(target, statement)),
      )
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
    return load(path, relative(entry_dir, path))
  }

  load(entry_path, undefined)
  return modules
}

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
