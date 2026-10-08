// Types arrays and maps: their literals, `Map()`, and indexing (of a Binary too).
import type { ArrayLiteral, Call, Expression, Index, MapLiteral } from '../syntax/ast.ts'
import { CompileError } from '../errors.ts'
import type { CheckerLocal, ExpressionChecker } from './expression_checker.ts'
import type { Functions } from './functions.ts'
import { is_contextual } from './literals.ts'
import type { Scopes } from '../scopes.ts'
import {
  array_type,
  format_type,
  int_type,
  is_map_key_type,
  is_reference_type,
  map_type,
  optional_type,
  uint8_type,
  type Type,
} from '../types.ts'

// The type of the values of a container, such as 'an Iter', which `at` gives: any type with values.
export const check_value_type = (type: Type, at: Expression, container: string): Type => {
  if (type.kind === 'nil') {
    const message = `nil alone does not give the type of ${container}; write it in an annotation`
    throw new CompileError(message, at.line, at.column)
  }
  if (type.kind === 'void' || type.kind === 'never') {
    const message = `${container} cannot hold values of type ${format_type(type)}`
    throw new CompileError(message, at.line, at.column)
  }
  return type
}

// The type of an item of a container, such as 'an array', which `at` gives. An item is 8 bytes,
// which cannot hold an optional Int, UInt8 or Bool.
export const check_item_type = (type: Type, at: Expression, container: string): Type => {
  check_value_type(type, at, container)
  if (type.kind === 'Optional' && !is_reference_type(type)) {
    const message = `${container} cannot hold values of type ${format_type(type)}`
    throw new CompileError(message, at.line, at.column)
  }
  return type
}

export class CollectionChecker {
  private readonly expressions: ExpressionChecker
  private readonly scopes: Scopes<CheckerLocal>
  private readonly functions: Functions

  constructor(expressions: ExpressionChecker, scopes: Scopes<CheckerLocal>, functions: Functions) {
    this.expressions = expressions
    this.scopes = scopes
    this.functions = functions
  }

  // The element type comes from the expected type if there is one, so that `[[], [1]]` can be
  // typed; otherwise from the first element whose type does not come from the context and which
  // gives a value (not a `throw`), so that `[1, c]` holds UInt8s when `c` is one.
  type_of_array(array: ArrayLiteral, expected: Type | undefined): Type {
    if (expected?.kind === 'Array') {
      for (const item of array.elements) this.expressions.expect_type(item, expected.element)
      return expected
    }
    const gives_value = (item: Expression) => item.kind !== 'throw'
    const anchor =
      array.elements.find((item) => gives_value(item) && !is_contextual(item)) ??
      array.elements.find(gives_value) ??
      array.elements[0]
    if (anchor === undefined) {
      const message =
        'the type of an empty array must be written, as in `const xs: Array<Int> = []`'
      throw new CompileError(message, array.line, array.column)
    }
    const element = this.item_type(anchor, 'an array')
    for (const item of array.elements) {
      if (item !== anchor) this.expressions.expect_type(item, element)
    }
    return array_type(element)
  }

  private item_type(item: Expression, container: string): Type {
    return check_item_type(this.expressions.type_of(item), item, container)
  }

  // The types come from the expected type if there is one, otherwise from the first entry.
  type_of_map(map: MapLiteral, expected: Type | undefined): Type {
    const type = expected?.kind === 'Map' ? expected : this.map_type_of_entry(map.entries[0])
    if (type.kind !== 'Map') throw new Error('a map literal has a map type')
    for (const entry of map.entries) {
      this.expressions.expect_type(entry.key, type.key)
      this.expressions.expect_type(entry.value, type.value)
    }
    return type
  }

  private map_type_of_entry(entry: MapLiteral['entries'][number]): Type {
    const key = this.expressions.type_of(entry.key)
    if (!is_map_key_type(key)) {
      const message = `a map key must be a String or an Int, got ${format_type(key)}`
      throw new CompileError(message, entry.key.line, entry.key.column)
    }
    const value = this.item_type(entry.value, 'a map')
    // A missing key reads as nil, so a value cannot be nil itself.
    if (value.kind === 'Optional') {
      const message = `a map cannot hold values of type ${format_type(value)}`
      throw new CompileError(message, entry.value.line, entry.value.column)
    }
    return map_type(key, value)
  }

  // `Map()`, unless the name is taken in the program.
  is_empty_map(callee: Expression): boolean {
    return (
      callee.kind === 'identifier' &&
      callee.name === 'Map' &&
      this.scopes.lookup('Map') === undefined &&
      !this.functions.has('Map')
    )
  }

  type_of_empty_map(call: Call, expected: Type | undefined): Type {
    if (expected?.kind !== 'Map') {
      const message =
        'the type of an empty map must be written, as in `const m: Map<String, Int> = Map()`'
      throw new CompileError(message, call.line, call.column)
    }
    if (call.args.length > 0 || call.named_args.length > 0) {
      throw new CompileError('Map() takes no arguments', call.line, call.column)
    }
    return expected
  }

  // An item of an array or a Binary, or the value of a map's key, which may not be there.
  type_of_index(index: Index): Type {
    const object_type = this.expressions.type_of(index.object)
    if (object_type.kind === 'Map') {
      this.expressions.expect_type(index.index, object_type.key)
      return optional_type(object_type.value)
    }
    if (object_type.kind !== 'Array' && object_type.kind !== 'Binary') {
      const message = `cannot index a value of type ${format_type(object_type)}`
      throw new CompileError(message, index.object.line, index.object.column)
    }
    this.expressions.expect_type(index.index, int_type)
    return object_type.kind === 'Array' ? object_type.element : uint8_type
  }
}
