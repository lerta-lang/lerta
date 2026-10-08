// What the checkers of one module share, and the types of what checking records.
import type { Call, Expression, FunctionLiteral, Identifier, NamedType } from '../syntax/ast.ts'
import type { CompileWarning } from '../errors.ts'
import type { Extensions } from './extensions.ts'
import type { Functions } from './functions.ts'
import type { Instance } from './generics.ts'
import type { Imports } from './imports.ts'
import type { FieldInfo, ObjectTypes } from './object_types.ts'
import type { TopLevelValues } from './top_level_values.ts'
import type { TypeResolver } from './type_names.ts'
import type { Type } from '../types.ts'

// The type of every expression in a checked program, and the type that the name of `x is T`
// stands for.
export type Types = Map<Expression | NamedType, Type>
// The type an expression is converted to where it is used, such as an Int passed as an Int?.
export type Conversions = Map<Expression, Type>
// What each function literal that is not a top-level function captures from around it: the names
// and the types they have there, which may be narrowed.
export type Capture = { name: string; type: Type; is_var: boolean }
export type Captures = Map<FunctionLiteral, Capture[]>

// The type of a C function, and the module of the extern that first declared it.
export type ExternType = { type: Type; module_name: string }

// What all the checkers of one program share.
export type Shared = {
  types: Types
  conversions: Conversions
  warnings: CompileWarning[]
  functions: Functions
  objects: ObjectTypes
  resolver: TypeResolver
  imports: Imports
  extensions: Extensions
  top_level: TopLevelValues
  captures: Captures
  extern_types: Map<string, ExternType>
  // The module's index, how messages name it, and the path that diagnostics give for it (see
  // Module).
  module_index: number
  module_name: string
  module_path: string | undefined
  // The instances of generic functions that calls call.
  instances: Map<Call, Instance>
  // The `var`s that function literals capture, by their declarations' names.
  shared_vars: Set<Identifier>
}

// The type of the object that `@` refers to: in a method, the method of an extend, or the
// initializer of a field, which sees the constructor arguments and the fields initialized before it.
export type SelfContext = { type: Type; initializing: FieldInfo | undefined }

// The function whose body is being checked: its written return type, or the one being inferred.
export type FunctionContext = {
  annotated: Type | undefined
  inferred: Type | undefined
  // The returned values, converted to the return type once it is known.
  results: { value: Expression; type: Type }[]
}
