# Async

A program runs on one thread, with an event loop, as in Node.js: while it waits for a timer, a file, a socket or another program, it continues with other work. There are no threads to share data between, so there are no data races.

## await

```lerta
import sleep from 'std:time'

fetch := (name: String, seconds: Float) ->
  await sleep(seconds)
  print "#{name} done"
  name.count()

a := fetch('slow', 0.2)
b := fetch('fast', 0.1)
print await a + await b
```

```output
fast done
slow done
8
```

A function that awaits returns a `Promise` of its result, with no `async` to write. Calling it runs it up to its first wait: both fetches above wait at the same time, and the faster ends first.

## Several promises

```lerta
import all, timeout, TimeoutError from 'std:async'
import sleep from 'std:time'

square := (n: Int) ->
  await sleep(n.to_float() / 100)
  n * n

print await all([square(n) for n in 1..4])

try
  await timeout(square(100), 0.05)
catch error: TimeoutError
  print 'too slow'
```

```output
[1, 4, 9]
too slow
```

`all` waits for every promise. `timeout` waits for one promise, for at most the time given, and cancels the work that it gives up on.

## Files and programs

```lerta
import make_temp_dir, read_text, remove_tree, write_file from 'std:io'

dir := make_temp_dir()
await write_file("#{dir}/a.txt", 'hello')
print await read_text("#{dir}/a.txt") else 'not UTF-8'
await remove_tree(dir)
```

```output
hello
```

Input and output give promises too, as do `run` of [std:process](../reference/std.md#stdprocess) and the servers and clients of [std:http](../reference/std.md#stdhttp). A file read as text gives nil if it is not UTF-8.

For the rules, see [functions that await](../reference/functions.md#functions-that-await) and [std:async](../reference/std.md#stdasync).
