// Where the method that a type has by a name comes from, which the checker types a call by and
// codegen calls. An extend cannot give a type a method it has already (see declare_extend), so at
// most one source has it. A field that holds a function is no method.
import { builtin_method } from './builtins.ts'
import type { ExtensionMethod, Extensions } from './extensions.ts'
import type { ObjectTypes } from './object_types.ts'
import type { Type } from '../types.ts'

export type MethodSource =
  // A method of the class or struct.
  | { kind: 'own'; receiver: Extract<Type, { kind: 'Object' }> }
  | { kind: 'extension'; method: ExtensionMethod }
  // One that the compiler gives (see builtins.ts), of its type.
  | { kind: 'builtin'; type: Type }

export const find_method = (
  receiver: Type,
  name: string,
  objects: ObjectTypes,
  extensions: Extensions,
): MethodSource | undefined => {
  if (receiver.kind === 'Object' && objects.info(receiver).methods.has(name)) {
    return { kind: 'own', receiver }
  }
  const method = extensions.find(receiver, name)
  if (method !== undefined) return { kind: 'extension', method }
  const type = builtin_method(receiver, name)
  return type === undefined ? undefined : { kind: 'builtin', type }
}
