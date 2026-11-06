# llit

llit (Lerta literals) is a text of data written as Lerta's literals, as a file of settings, whose name ends with `.llit`. `decode_llit` of `compiler/llit.lerta`, for the tools of the repository, reads it as std:json's `decode_json` reads JSON (see [std:codable](../reference/std.md#stdcodable)).

```lerta
# The hosts by their names.
hosts:
  'windows': { address: 'user@windows' }
  'linux':
    jobs: 2
```

| Name | |
|---|---|
| `decode_llit<T: Codable>(text: String, path: String): T` | The value of type `T` that the text holds. Throws an `LlitError` for text that is not llit or does not fit `T`. |
| `LlitError` | Its error, a struct of a `message`, `<path>:<line>:<column>: <message>`, of the first error found, the path as given. |

## Text

- The text is the lines of a [bracketless block](../reference/syntax.md#bracketless-blocks), without the line before it: fields, as `name: value`, map entries or array items, one or more to a line, as a block literal holds them, with comments and blank lines between.
- A text of nothing but comments and blank lines holds a struct without fields.
- A value is a literal of Lerta: `nil`, `true` or `false`, a number, decimal or hexadecimal, with a minus before it if negative, a string without interpolation, a Binary literal without interpolation, the name of an enum's member alone, as `RED`, or an array, a tuple, an anonymous struct or a map of such values, in brackets or as a block, and `Map()` for an empty map, which `{}` cannot write. Any other expression, as a name or a call, is an error.

## Types

The value is read as the type that the code gives, which takes the literal of its kind:

| Lerta | llit |
|---|---|
| integers, `Float`, `Float32` | A number literal in the type's range; an integer for an integer type. |
| `Bool`, `String`, `Binary` | Their literals. |
| `Char` | A string of one character. |
| enums | The name of a member alone. |
| `T?` | `nil`, or as `T`. |
| `T[]`, `Set<T>` | An array literal. A set's items are no two the same. |
| tuples | A tuple of as many items. |
| `Map<K, V>` | A map literal, its keys of `K`, no two the same: strings for `String`s. |
| classes, structs, anonymous structs | An anonymous struct, of a field for each one that the constructor takes, but those with a default or of an optional type, which may be left out. A field that the type has not is an error, as in Lerta, and so is a field written twice. |
| unions | The member that the kind of the literal tells, as std:json's [unions](../reference/std.md#types). |

- Errors name where in the text the value is that they are about: `settings.llit:3:9: expected an Int8, found 300`, `settings.llit:1:1: missing the field name`.
- A `UInt64` above the largest `Int` cannot be written, as no integer literal holds it, nor a `Float` of a hexadecimal integer beyond `Int`.
