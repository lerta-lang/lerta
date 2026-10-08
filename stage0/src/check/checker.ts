// Checks a program: the types of its expressions, its conversions and its warnings.
import type { Call, Identifier, Import, Program } from '../syntax/ast.ts'
import { check_function, check_object } from './bodies.ts'
import { declare_extends, declare_names } from './declarations.ts'
import { CompileError, CompileWarning } from '../errors.ts'
import { exports_of_module } from './exports.ts'
import { Extensions } from './extensions.ts'
import { Functions, method_key } from './functions.ts'
import type { GenericFunction, Instance } from './generics.ts'
import { Imports, type Export } from './imports.ts'
import { is_standard_module, with_module_path, type Module } from '../loader.ts'
import { ObjectTypes, type ObjectInfo } from './object_types.ts'
import type { Captures, Conversions, ExternType, Shared, Types } from './shared.ts'
import { StatementChecker } from './statement_checker.ts'
import { reject_misplaced_jumps } from './jump_positions.ts'
import { TopLevelValues } from './top_level_values.ts'
import { TypeResolver } from './type_names.ts'

// Warnings are found as scopes end; they are reported in source order, once each, though each
// instance of a generic function finds those of its body again.
const in_source_order = (warnings: CompileWarning[]): CompileWarning[] => {
  const keys = new Set<string>()
  return warnings
    .filter((warning) => {
      const key = `${warning.line}:${warning.column}:${warning.message}`
      const is_new = !keys.has(key)
      keys.add(key)
      return is_new
    })
    .toSorted((a, b) => a.line - b.line || a.column - b.column)
}

export type Checked = {
  types: Types
  conversions: Conversions
  objects: ObjectTypes
  imports: Imports
  extensions: Extensions
  warnings: CompileWarning[]
  captures: Captures
  shared_vars: Set<Identifier>
  // What the module exports, for the modules that import it, besides its extends.
  exports: Map<string, Export>
  instances: Map<Call, Instance>
  generics: GenericFunction[]
  // Adds the warnings about the names that the module never uses, once every module is checked.
  warn_unused: () => void
}

// What the modules share: the classes and structs of every module checked so far, by symbol, and
// the type each C function was first declared with by an extern.
type ProgramWide = { infos: Map<string, ObjectInfo>; extern_types: Map<string, ExternType> }

// Checks the modules in order, each after those it imports (see load_modules). The warnings of
// all the modules come back with the last one's, or with the error. They are gathered at the end,
// since a module that calls a generic function of another checks an instance of it there, which
// may find warnings and use names of that module.
export const check_modules = (modules: Module[]): Checked[] => {
  const checked: Checked[] = []
  const warnings_of_modules = modules.map((): CompileWarning[] => [])
  const program_wide: ProgramWide = { infos: new Map(), extern_types: new Map() }
  const all_warnings = (): CompileWarning[] => {
    for (const result of checked) result.warn_unused()
    // A program's author cannot act on the warnings of the standard modules, which would warn, for
    // example, about the names that only generic functions the program never calls use.
    return modules
      .filter((module) => !is_standard_module(module))
      .flatMap((module) => {
        const warnings = in_source_order(warnings_of_modules[module.index])
        for (const warning of warnings) warning.module_path = module.display_path
        return warnings
      })
  }
  try {
    for (const module of modules) {
      const imported = (statement: Import) => checked[module.imported.get(statement)!.index]
      const warnings = warnings_of_modules[module.index]
      checked.push(
        with_module_path(module.display_path, () =>
          check(module, imported, program_wide, warnings),
        ),
      )
      while (checked.some((result) => result.generics.some((generic) => generic.check_pending())));
    }
  } catch (error) {
    if (error instanceof CompileError) error.warnings = all_warnings()
    throw error
  }
  checked.at(-1)!.warnings = all_warnings()
  return checked
}

// `imported` gives the checked module that an import names.
const check = (
  module: Module,
  imported: (statement: Import) => Checked,
  program_wide: ProgramWide,
  warnings: CompileWarning[],
): Checked => {
  const { program } = module
  const exports_of = (statement: Import) => imported(statement).exports
  const shared = create_shared(module, exports_of, program_wide, warnings)
  const { types, conversions, functions, objects, resolver, imports, captures } = shared
  reject_misplaced_jumps(program)
  declare_names(program, shared)
  declare_extends(module, imported, shared)
  const warn_unused = check_code(program, shared)
  const exports = exports_of_module(module, functions, objects, resolver, types, shared.imports)
  return {
    types,
    conversions,
    objects,
    imports,
    extensions: shared.extensions,
    warnings,
    captures,
    shared_vars: shared.shared_vars,
    exports,
    instances: shared.instances,
    generics: [...functions.generics(), ...shared.extensions.own_generics()],
    warn_unused,
  }
}

const create_shared = (
  module: Module,
  exports_of: (statement: Import) => Map<string, Export>,
  program_wide: ProgramWide,
  warnings: CompileWarning[],
): Shared => {
  const imports = new Imports(exports_of)
  // An imported type, marking its import as used.
  const imported_type = (name: string) => {
    const imported = imports.get(name)
    if (imported?.export.kind !== 'type') return undefined
    imports.use(name)
    return imported.export
  }
  const module_name = module.display_path ?? 'the entry module'
  const objects: ObjectTypes = new ObjectTypes(
    (info) => check_object(shared, info),
    (name) => imported_type(name)?.info,
    program_wide.infos,
    module.index,
    module_name,
  )
  const resolver = new TypeResolver(
    (name) => objects.object_type(name) ?? imported_type(name)?.type,
  )
  const functions: Functions = new Functions((entry) => check_function(shared, entry), resolver)
  const shared: Shared = {
    types: new Map(),
    conversions: new Map(),
    warnings,
    functions,
    objects,
    resolver,
    imports,
    extensions: new Extensions(module.index, module_name),
    top_level: new TopLevelValues(module.program),
    captures: new Map(),
    extern_types: program_wide.extern_types,
    module_index: module.index,
    module_name,
    module_path: module.display_path,
    instances: new Map(),
    shared_vars: new Set(),
  }
  return shared
}

// The top-level code, then the objects and functions, which may use its names. Returns what warns
// about the names never used, which the instances of its generic functions that other modules
// call may use still.
const check_code = (program: Program, shared: Shared): (() => void) => {
  const warn_unused_top_level = new StatementChecker(shared, undefined, undefined).check_top_level(
    program,
  )
  shared.objects.check_all()
  shared.functions.check_all()
  reject_deinit_results(shared)
  return () => {
    warn_unused_top_level()
    shared.warnings.push(...shared.imports.unused_warnings())
  }
}

// A deinit runs as part of a release, where nothing could take a value it gave, or handle a throw.
const reject_deinit_results = ({ objects, functions }: Shared): void => {
  for (const info of objects.all()) {
    const literal = info.methods.get('deinit')
    if (literal === undefined) continue
    const key = method_key(info.declaration.name.name, 'deinit')
    const type = functions.type_of(key, literal)
    const result = type?.kind === 'function' ? type.result : undefined
    if (result?.kind === 'never') {
      throw new CompileError('deinit cannot throw', literal.line, literal.column)
    }
    if (result !== undefined && result.kind !== 'void') {
      throw new CompileError('deinit gives no value', literal.line, literal.column)
    }
  }
}
