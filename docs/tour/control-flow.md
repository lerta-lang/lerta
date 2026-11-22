# Control flow

## if and while

```lerta
var n = 3
while n > 0
  if n == 1
    print 'one'
  else
    print n
  n -= 1
```

```output
3
2
one
```

A condition is a `Bool`, or an optional value, which holds when it is not nil; a `Bool?` is compared instead, `flag == true`. `0` and `''` are neither, so using one as a condition is a compile error; it is not treated as false.

## Postfix forms

```lerta
for n in 1..10
  continue if n % 2 == 0
  break unless n < 6
  print n
```

```output
1
3
5
```

A statement may end with `if`, `unless`, `while`, `until` or `for`, which applies to that statement alone. `unless` means `if not`. `1..10` counts from 1 up to, but not including, 10.

```lerta
print n * n for n in [1, 2, 3]
```

```output
1
4
9
```

## then and else

```lerta
for n in [4, 7]
  parity := n % 2 == 0 then 'even' else 'odd'
  print "#{n} is #{parity}"
```

```output
4 is even
7 is odd
```

`then` and `else` choose a value in an expression, where other languages write `? :`. For more than two values, write a `case`.

## case

```lerta
for word in ['if', 'x', '+']
  kind :=
    case word
      when 'if', 'else', 'for' then 'keyword'
      when '+', '-' then 'operator'
      else 'name'
  print "#{word}: #{kind}"

for i in 12..16
  print case
    when i % 15 == 0 then 'FizzBuzz'
    when i % 3 == 0 then 'Fizz'
    when i % 5 == 0 then 'Buzz'
    else i
```

```output
if: keyword
x: name
+: operator
Fizz
13
14
FizzBuzz
```

A `case` compares a subject with the values of each `when`, or, without a subject, takes the first `when` whose condition holds. It is an expression: its value is that of the arm taken. A `case` on a [union](enums-and-unions.md) chooses by type instead.

For the rules, see [control flow](../reference/control-flow.md).
