// Generates the program: the modules' top-level code, and every function of theirs (see
// FunctionGenerator).
import {
  is_function_declaration,
  is_generic,
  type FunctionDeclaration,
  type Statement,
} from '../syntax/ast.ts'
import type { Checked } from '../check/checker.ts'
import { FunctionGenerator } from './function_codegen.ts'
import { IrModule } from './ir_builder.ts'
import {
  extension_symbol,
  function_symbol,
  instance_symbol,
  module_init_symbol,
  method_symbol,
} from './lerta_ir.ts'
import { define_object } from './object_codegen.ts'
import type { Module } from '../loader.ts'
import { define_top_level_globals, type TopLevelGlobal } from './top_level_codegen.ts'
import { is_top_level_value } from '../check/top_level_values.ts'

// A generic function is generated per instance instead.
const is_plain_function = (statement: Statement): statement is FunctionDeclaration =>
  is_function_declaration(statement) && !is_generic(statement.value)

// Emits LLVM IR for the checked modules (see check_modules) as one program. The entry module's
// top-level code becomes lerta_main, which first runs that of the other modules, in order; each
// function, method, constructor and instance of a generic function becomes a function of its own.
// The instances are generated with their generic function, once all the calls are checked.
export const generate = (modules: Module[], checked: Checked[]): string => {
  const ir_module = new IrModule()
  const entry = modules.at(-1)!
  const globals = modules.map((module) =>
    define_top_level_globals(
      ir_module,
      module.index,
      module.program.filter(is_top_level_value),
      checked[module.index].types,
    ),
  )
  for (const module of modules) {
    const main =
      module === entry
        ? { signature: 'void @lerta_main()', runs_first: modules.slice(0, -1) }
        : { signature: `void ${module_init_symbol(module.index)}()`, runs_first: [] }
    const module_checked = checked[module.index]
    const symbols = function_symbols(module, checked)
    const generator = (top_level_code = false, extensions = module_checked.extensions) =>
      new FunctionGenerator(ir_module, { ...module_checked, extensions }, symbols, {
        values: globals[module.index],
        top_level_code,
      })
    const is_main_code = (statement: Statement) =>
      !is_function_declaration(statement) && statement.kind !== 'type_declaration'
    generator(true).generate_main(
      module.program.filter(is_main_code),
      main.signature,
      main.runs_first.map((other) => module_init_symbol(other.index)),
      module === entry ? released_globals(globals) : [],
    )
    for (const declaration of module.program.filter(is_plain_function)) {
      const symbol = function_symbol(module.index, declaration.name.name)
      generator().generate_function(symbol, declaration.value, undefined)
    }
    for (const instance of module_checked.generics.flatMap((generic) => generic.instances)) {
      generator(false, instance.extensions).generate_function(
        instance_symbol(instance),
        instance.literal,
        instance.this_type,
      )
    }
    for (const info of module_checked.objects.all()) {
      define_object(ir_module, info)
      generator().generate_constructor(info)
      for (const [name, literal] of info.methods) {
        const symbol = method_symbol(info.type, name)
        generator().generate_function(symbol, literal, info.type)
      }
    }
    for (const method of module_checked.extensions.own) {
      if (method.generic !== undefined) continue
      generator().generate_function(extension_symbol(method), method.literal, method.receiver)
    }
  }
  return ir_module.render()
}

// Every module's top-level values, released at the end of the program in the reverse order of
// their initialization, so that a deinit that runs then may still use those initialized before, as
// print uses std:io's stdout.
const released_globals = (globals: Map<string, TopLevelGlobal>[]): TopLevelGlobal[] =>
  globals.flatMap((values) => [...values.values()]).toReversed()

// The symbols of the functions a module can call by name: its own and those it imports.
const function_symbols = (module: Module, checked: Checked[]): Map<string, string> => {
  const symbols = new Map<string, string>()
  for (const declaration of module.program.filter(is_plain_function)) {
    symbols.set(declaration.name.name, function_symbol(module.index, declaration.name.name))
  }
  for (const imported of checked[module.index].imports.all()) {
    const { export: export_ } = imported
    if (export_.kind === 'lerta_function') {
      symbols.set(imported.name.name, function_symbol(export_.module_index, export_.name))
    }
  }
  return symbols
}
