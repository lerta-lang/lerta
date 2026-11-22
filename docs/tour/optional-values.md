# Optional values

No value can be nil unless its type says so. A value that may be missing has an optional type, `T?`, and the compiler makes the program handle nil before it uses the value.

## Narrowing

```lerta
find := (names: String[], prefix: String) ->
  for name in names
    return name if name.starts_with(prefix)
  nil

names := ['ana', 'bo']
for prefix in ['b', 'z']
  if name := find(names, prefix)
    print "found #{name.to_upper()}"
  else
    print "no #{prefix}"
```

```output
found BO
no z
```

`find` returns a `String?`. `if name := ...` holds when the value is not nil, and inside the block, `name` is a `String`. A test narrows in the same way:

```lerta
greet := (name: String?) ->
  return 'hello, stranger' if name == nil
  "hello, #{name}"

print greet('ana')
print greet(nil)
```

```output
hello, ana
hello, stranger
```

After the `return`, `name` cannot be nil, so it is a `String`.

## else, ?. and !

```lerta
struct User
  name: String
  manager: User?

bo := User(name: 'bo', manager: nil)
ana := User(name: 'ana', manager: bo)

print ana.manager?.name else 'nobody'
print bo.manager?.name else 'nobody'
print ana.manager!.name
```

```output
bo
nobody
bo
```

`else` gives a fallback value for nil. `?.` continues only if the value is not nil, and gives nil otherwise. `!` takes the value, and throws if it is nil: use it where you know the value cannot be nil.

`else` may also be followed by `return`, `break`, `continue` or `throw`, to leave when the value is missing:

```lerta
ages := { 'ana': 31 }
for name in ['ana', 'bo']
  age := ages[name] else continue
  print "#{name}: #{age}"
```

```output
ana: 31
```

For the rules, see [optional values](../reference/types.md#optional-values) and [narrowing](../reference/control-flow.md#narrowing).
