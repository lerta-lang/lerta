# Errors

## Exceptions

```lerta
struct NotFound: Error

find := (ages: Map<String, Int>, name: String) -> ages[name] else throw NotFound("no #{name}")

ages := { 'ana': 31 }
for name in ['ana', 'bo']
  try
    print find(ages, name)
  catch error: NotFound
    print error.message
  finally
    print "looked up #{name}"
```

```output
31
looked up ana
no bo
looked up bo
```

An error is a value of a type that satisfies `Error`, whose one member is `message: String`: `struct NotFound: Error` declares one. A `catch` takes the errors of its type, and `finally` runs however the block ends.

## Errors of the runtime

```lerta
xs := [1, 2, 3]
try
  print xs[5]
catch error: IndexError
  print error.message
```

```output
index out of range
```

What other languages leave undefined throws in Lerta: an index out of range, an integer that overflows or is divided by zero. A program never goes on with a wrong value or corrupt memory.

## try as a value

```lerta
parse := (text: String) ->
  try
    text.parse_int() else throw ValueError("not a number: #{text}")
  catch error: ValueError
    print error.message
    0

print parse('42') + parse('x')
```

```output
not a number: x
42
```

A `try` is an expression: its value is that of the block, or of the `catch` taken.

Exceptions compile to ordinary return values, with no unwinding tables: a `throw` leaves a function as a `return` does, at the cost of a check after each call that may throw.

For the rules, see [errors](../reference/errors.md).
