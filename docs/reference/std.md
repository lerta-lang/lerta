# Standard modules

- `'std:<name>'` is the Lerta file `std/<name>.lerta` of the repository. The compiler carries it, and a program [imports](modules.md) it as any module.
- The standard modules so far: `'std:args'`, `'std:async'`, `'std:codable'`, `'std:enums'`, `'std:http'`, `'std:io'`, `'std:json'`, `'std:math'`, `'std:net'`, `'std:process'`, `'std:scanner'` and `'std:time'` (below), and `'std:builtins'`, the module of the [builtins](builtins.md).
- A standard module may import the files of `std/`'s directories, as `std/internal/`, by relative paths, as a file imports another: `import JsonWriter from './internal/json_writer'`.
  - Those files are not standard modules: a program cannot import them as `std:...`.
  - Their warnings show only when a standard module that imports them is built on its own.

## std:args

```lerta
import argv from 'std:process'
import parse_args from 'std:args'

struct Args
  lines: Bool
  jobs: Int = default 4
  files: String[]

SPEC :=
  lines: { short: 'l', help: 'count lines only' }
  jobs: { short: 'j', help: 'run this many at once' }
  files: { positional: true, value: 'file' }

args := parse_args<Args>(argv, SPEC)
```

| Name | |
|---|---|
| `parse_args<T: Codable, S: Codable>(args: String[], spec: S, command: String? = nil): T` | The arguments read into a `T`, as the spec says how (below), for the command of the name if given. For `-h` or `--help` where an option may be, not as an option's value nor after `--`, it prints the usage message and exits with 0, though other arguments do not fit; for arguments that do not fit, it prints `<program>: ` and the error to stderr, then the usage message, and exits with 2. |
| `decode_args<T: Codable, S: Codable>(args: String[], spec: S, command: String? = nil): T` | As `parse_args`, but throws an `ArgsError` for arguments that do not fit, and takes `-h` and `--help` as any other unknown option. |
| `usage<T: Codable, S: Codable>(spec: S, command: String? = nil): String` | The usage message that `parse_args` prints. |
| `wants_help<T: Codable, S: Codable>(args: String[], spec: S): Bool` | Whether `parse_args` would print the usage message for the arguments, for a program that prints it itself with `usage`, as one that cleans up before it exits; the command, which names it there, changes nothing here. |
| `parse_command<C: Enum, S: Codable>(args: String[], spec: S): (C, String[])` | The member of `C` that the first argument names, with `-` for `_`, and the arguments after it, for `parse_args` of that command's struct. Its spec gives the `help` of each member. It prints the usage message of the commands and exits as `parse_args` does, for `-h` or `--help` first, no argument or an unknown command. |
| `ArgsError` | An [error](errors.md) whose message tells what does not fit, as `--jobs takes an Int, not 'x'` or `missing <file>`. |

The fields of `T` are the options and the positional arguments:

- A field is an option, `--` and its name with `-` for `_`, or `-x` for a name of one letter.
  - A `Bool` is a switch, true if given and false if not, with no default written. Another field takes a value, the next argument even if it starts with `-`, or what follows `=` after a `--` option: `--jobs 4`, `--jobs=4`. A `String` takes it as it is, a number or a `Char` as its text, in the type's range, and an enum's member as its name with `-` for `_`, as a command.
  - A list takes one value each time it is given; another field given twice is an error.
  - A field with a [default](objects.md#members) or of an optional type may be left out; the others are required.
- `--` ends the options: the arguments after it are positional, or go to the field that is `after_dashes`.
- `-` alone is a positional argument; any other argument that starts with `-` is an option, so a positional argument such as `-5` goes after `--`.

The spec is an anonymous struct of a field of `T` each, `{}` if it says nothing, which gives some of these:

| Key | |
|---|---|
| `short: String` | A short option of one character: `short: 'j'` gives `-j`. |
| `help: String` | What the usage message says of it. |
| `value: String` | What the usage message calls its value, or the positional argument. |
| `positional: Bool` | It takes positional arguments, in the order of the fields: one, or the rest for a list. A required one cannot follow one that may be left out, nor anything follow a list. |
| `after_dashes: Bool` | It takes the arguments after `--`, a list, empty without `--`, with no default written. |

The usage message is made of them:

```
usage: wc [options] <file>...

options:
  -l, --lines       count lines only
  -j, --jobs <int>  run this many at once (default: 4)
  -h, --help        show this help
```

- `<program>` is std:process's [`program`](#stdprocess), and the command follows it if given.
- A positional argument is shown as `<name>`, with `...` for a list and in brackets if it may be left out; the field that is `after_dashes` as `[-- <name>...]`.
- An option's value is called after its type, as `<int>` or `<text>`, unless the spec says otherwise. Its default is the one that `T` gives, unless it is nil, false, blank or a list of nothing to show. To find them, std:args reads a `T` with a stand-in value for each required field, through a `Decoder` of its own, and writes it.
- A spec or a `T` that std:args cannot read arguments into throws a `ValueError` whatever the arguments are: a spec of a name or a key that is none, of a value of another type, or of two options of one name, or a field of a type that is no `Bool`, `String`, number, `Char` or enum, or an optional or a list of one; a list of optional values, a `Bool` of the default true or a list of them, or a required enum.

## std:async

| Name | |
|---|---|
| `Deferred<T>` | A class of a promise and what settles it, apart (below). |
| `Signal` | A `Deferred` of a promise of no value (below). |
| `spawn<T>(task: Promise<T>)` | Lets the work of a promise go on without awaiting it (below). |
| `all<T>(promises: Promise<T>[])` | A promise of the values of all the promises (below). |
| `race<T>(promises: Promise<T>[])` | A promise of the outcome of the first promise settled (below). |
| `timeout<T>(promise: Promise<T>, seconds: Float)` | A promise of the outcome of a promise settled in time (below). |
| `TimeoutError` | The error of `timeout`, a struct of one field, `message`. |

### Deferred

- `promise(): Promise<T>` gives a promise that waits until `resolve(value: T)` or `reject(error: Error)` is called.
- The first of them settles it; later ones change nothing.
- `promise()` gives the same promise each time. It is made when it is first asked for, so a Deferred that is never settled, or whose promise is never asked for, leaves nothing waiting.
- A promise rejected with nothing to await it ends the program, as any promise's does (see [functions that await](functions.md#functions-that-await)).
- One never settled keeps what awaits it waiting, which the debug runtime reports as a leak (see [build](compiler.md#build)).

### Signal

- `promise(): Promise`, `resolve()` and `reject(error: Error)`, as those of `Deferred<T>`.
- For a wait that only tells that something has happened.

### spawn

- `spawn serve(socket)` lets the work go on where a promise must otherwise be awaited (see [errors](errors.md#discarded-values)). It gives nothing.
- The work goes on as any started does, the call that made the promise having run up to its first `await`.
- An error it ends with, which nothing awaits, ends the program, as that of any promise dropped (see [functions that await](functions.md#functions-that-await)).

### all, race and timeout

| Call | Of `Promise<T>[]` or `Promise<T>` | Of `Promise[]` or `Promise` |
|---|---|---|
| `all(promises)` | A `Promise<T[]>` of the value of each promise, in their order, once all are resolved. | A `Promise` without a value, resolved once all are. |
| `race(promises)` | A `Promise<T>` of the value or the error of the first promise to be settled. | A `Promise` without a value. |
| `timeout(promise, seconds)` | A `Promise<T>` of its value or its error if it is settled within the seconds. | A `Promise` without a value. |

- **all.** The error of the first promise that is rejected rejects it at once. That error leaves the others going on.
- **race.** The others are then cancelled, and it is settled once they have ended. Of no promises, it is never settled.
- **timeout.** If the promise is not settled in time, it is cancelled and, once it has ended, a `TimeoutError` rejects it: `timed out after <seconds> seconds`. For seconds below 0, the error of `sleep` rejects it instead.
- A promise that goes on after `race` or `timeout` cancels it, as a write in progress does, delays them as long.
- They await each of the promises, so that the error of one that is rejected after the outcome is decided ends nothing.
- Cancelled, they cancel the promises they were given (see [cancellation](functions.md#cancellation)).
- Promises with a value and without one are not mixed, as an array holds items of one type.
- `all` of promises of a `T?` that no array holds is an error (see [optional values](types.md#optional-values)).
- **Extends.** They are generic functions that call the methods `gathered`, `first_settled` and `settled_within` of an extend of `Promise<T>[]` and one of `Promise[]`.
  - Those extends are in effect where `std:async` is imported (see [objects](objects.md#extend)), so those names are taken there.
  - `timeout` passes its promise in an array of one, as a `Promise` cannot be extended.

## std:codable

| Name | |
|---|---|
| `Codable` | The interface of the types that the compiler writes and reads by their parts (below). |
| `Encoder`, `Decoder` | The interfaces of what a format writes and reads a value through (below). |
| `encode<E: Encoder, T: Codable>(encoder: E, value: T)` | Writes the value through the encoder. |
| `decode<T: Codable, D: Decoder>(decoder: D): T` | The value of type `T` that the decoder reads, `T` written, as `decode<Config>(reader)`. |
| `KIND_BOOL`, `KIND_NUMBER`, `KIND_TEXT`, `KIND_RECORD`, `KIND_OTHER` | The kinds that a `Decoder`'s `peek_kind` gives (below). |

- A format is a class or struct with the members of `Encoder` or `Decoder`, as std:json's own `JsonWriter` and `JsonReader`; a union of such types is not one. The code that the compiler generates for each type calls its methods directly, with no interface value between.

### Codable

- It only bounds type parameters, as `<T: Codable>` of a function that passes its type on to `encode` and `decode`, or to std:json's `encode_json` and `decode_json`.
  - Why: a type of values would not tell which type to convert by.
- It has no members: the types that satisfy it are those of data, which the compiler tells by their parts, and it generates the code that converts each, so no type declares anything for it. It is the only interface without members.
- A type with a part that is not data does not satisfy it: a function, a `Promise`, an `Iter`, an interface or a `weak` field.
- That is an error at the call, which names the path of the part, as JsonError's messages write it, with `$[]` for an item of an array or a set, `$.*` for a value of a map of `String` keys, and `$[][0]` and `$[][1]` for a key and a value of another map: `Request does not satisfy Codable: $.handler is of type (Int) -> Int, which is not data`.
- So far, neither does a union that std:json's [unions](#types) leave out.

### Encoder

- A scalar is written by the method of its type: `write_nil`, `write_bool`, `write_int` (an integer of another type than `UInt64`, as an `Int`), `write_uint64`, `write_float`, `write_float32`, `write_string`, `write_binary` and `write_char`; an enum's member by `write_member(enum_name, member)`.
- The others are written between a `begin_` and an `end_`:
  - an array: `begin_array`, `next_item` before each item, the first too, `end_array`;
  - a tuple: `begin_tuple(count)`, `next_item` before each item, the first too, `end_tuple`;
  - a set: `begin_set`, `next_item` before each item, the first too, `end_set`;
  - a map of `String` keys: `begin_map`, `write_key(key)` before each value, `end_map`;
  - another map: `begin_entries`, then for each entry `next_entry`, its key, `entry_value`, its value and `end_entry`, then `end_entries`;
  - a class, a struct or an anonymous struct: `begin_record`, `write_field(name)` before each field's value, `end_record`.
- A class or struct whose type can hold itself is written between `enter(address)` and `leave`, around its record, so that a format that cannot hold a cycle can throw.

### Decoder

- Each method reads what its `Encoder` counterpart writes, and throws where it finds something else: `read_nil(): Bool`, which reads a nil if there is one, `read_bool`, `read_integer(expected, least, most)` (an integer of another type than `UInt64`, in its range, with `expected` naming it, as `an Int8`), `read_uint64`, `read_float`, `read_float32`, `read_string`, `read_binary`, `read_char` and `read_member(enum_name): String`.
- An array: `begin_array`, then `next_item(): Bool` before each item, false at the end.
- A tuple: `begin_tuple(count)`, `next_tuple_item(count)` before each item and `end_tuple(count)`, which throw if there are fewer or more.
- A set: `begin_set`, then `next_item(): Bool` before each item, as an array.
- A map of `String` keys: `begin_map`, then `read_key(): String?` before each value, nil at the end.
- Another map: `begin_entries`, then `next_entry(): Bool` before each entry, false at the end, its key, `entry_value`, its value and `end_entry`.
- `fail_duplicate()` throws for an item of a set, or a key of an entry, that came before, as a key of a map of `String` keys read twice throws.
- A record: `begin_record`, then `read_field(): String?`, as `read_key`. `is_field(key, name)` tells the field whose key it is, `skip_value` skips the value of a key that is none, and `fail_missing_field(name)` throws for a field that needs a key.
  - For each key, `is_field` is asked of the fields in their order until one has it, all of them for a key that none has; the value of a key read twice is that of the last. After the last key, `fail_missing_field` is called for each field in turn that has no default, is not optional and was not given, of which the first throws. [std:args](#stdargs) finds the fields of a struct by these.
- A union: `peek_kind(): Int` gives the kind of the value, without reading it: `KIND_BOOL`, `KIND_NUMBER`, `KIND_TEXT` (a `String`, a `Binary`, a `Char` or an enum's member), `KIND_RECORD` (a class or struct) or `KIND_OTHER`, and the member of that kind is read; `fail_expected(expected)` throws for one of no member's kind.
- `fail_member(enum_name, name)` throws for a name read that names no member.

## std:enums

| Name | |
|---|---|
| `Enum` | The interface of the [enums](types.md#enums), which only bounds type parameters, as `<E: Enum>`. |
| `parse<E: Enum>(text: String): E?` | The member of `E` whose text is the `String`, or `nil`: `parse<TokenKind>('(')`. |
| `members<E: Enum>(): E[]` | The members of `E`, in the order declared. |

- The type argument is written, as no argument tells it.
- `Enum` is satisfied by the enums only, which the compiler tells, as it does for [Codable](#codable). Its members, `to_string: () -> String` and `equals: (Self) -> Bool`, let an `E` give its text and be compared, as an enum is: `a == b`, `members<E>().index_of(e)`.

## std:http

An HTTP/1.1 server and client over [std:net](#stdnet). The server's handler takes a `Request` and gives a `Response`, and the client's `fetch` gives a `Response`, as in JavaScript.

```lerta
import fetch, Request, Response, serve from 'std:http'

handle := (request: Request) -> Response(body: "hello, #{request.url}")

server := serve(handle, port: 8080)
response := await fetch('http://127.0.0.1:8080/', method: 'POST', body: 'hi')
print (await response.text())!
```

### Messages

| Name | |
|---|---|
| `Request` | A struct of `method: String`, `url: String`, `headers: Headers` and `body: Body`, and the methods `text(): Promise<String?>` and `binary(): Promise<Binary>`, which read the body to its end; `text` gives nil if it is not valid UTF-8. |
| `Response` | A struct of `body: Body = ''`, `status = 200` and `headers = Headers()`, and `text()` and `binary()`, as those of `Request`. |
| `Body` | `String \| Binary \| Reader`, the `Reader` of [std:io](#stdio). |
| `Headers` | A class of `fields: (String, String)[]`, each name in lower case with its value, and the methods below. |

- **Request.**
  - Its `url` is the target in absolute form as it is, or else `http://` with the `Host` field and the target.
  - In place of a `Host` that an HTTP/1.0 request leaves out, it takes the host that `serve` was given and the port, an IPv6 address in brackets: `http://0.0.0.0:8080/` for a server that listens at every address.
  - Its `body` is a `Reader` in a request that the server gives the handler.
- **Response.** Its `body` is a `Reader` in a response that `fetch` gives.
- **Body.**
  - A body that comes is a `Reader`, read as it comes.
  - One that is sent as a `Reader` is sent as it comes, each read of it awaiting the write of the one before, so that it goes no faster than the peer takes it.
  - It is closed once sent, or once it is not to be, as for a response that has no body.

#### Headers

| Method | |
|---|---|
| `get(name): String?` | The values of the name joined by `, `, or nil. |
| `get_all(name): String[]` | The values apart, as those of `Set-Cookie`, which may hold `, `. |
| `contains(name)` | Whether the name has a value; `name in headers` calls it. |
| `set(name, value)` | Replaces the name's values. |
| `append(name, value)` | Adds a value. |
| `remove(name)` | Removes the name's values, and tells whether it had any. |

- Names are told apart regardless of case.
- `set` and `append` throw a `ValueError`:
  - `not a header name: <name>` for a name that is not a token of HTTP;
  - `a header value holds a control character: <name>` for a value that holds an ASCII control character other than a tab, or DEL.
  - Why: RFC 9110 allows none, and so a value taken from a request cannot add fields to a response.

### The server

| Name | |
|---|---|
| `serve(handler: (Request) -> Promise<Response>, options: ServerOptions): Server` | Listens at once, as `listen_tcp` does, and serves each connection until the server is closed. The options are named arguments: `serve(handle, port: 8080)`. |
| `ServerOptions` | A struct of the options below. |
| `Server` | A class of `port: Int`, the port it listens at, and `close(): Promise` (below). |

#### ServerOptions

| Option | |
|---|---|
| `host = '127.0.0.1'`, `port = 0` | Where the server listens; at a free port for 0. |
| `max_line = 8192` | The bytes of the request line and of each field, before its CR LF or its LF alone. It answers 414 for a longer request line and 431 for a longer field. |
| `max_fields = 100` | The fields of a request. Beyond them it answers 431. |
| `max_body = 10485760` | The length of a body (below). |
| `idle_timeout = 5.0` | Seconds until the request line of a request has come. After them, the connection is closed without a response. |
| `head_timeout = 30.0` | Seconds until the rest of its head has come. After them it answers 408. |
| `body_timeout = 30.0` | Seconds for each chunk of its body, which for a body in chunks includes the lines read before it, as the trailer. After them the handler's read fails with an `IOError`, `a body timed out`. |

- A body beyond `max_body` is answered 413 before the body is read.
- For a body in chunks, the handler's read fails with an `IOError`, `a body too large`, once its data goes beyond `max_body`, or once its lines go beyond it and 64 KiB more together: the sizes, the line end after each chunk and the trailer, each counted with CR LF.
- A negative option throws a `ValueError`, `a negative <name>: <value>`, as `serve` starts.

#### Server.close

- It stops listening and closes the connections that wait for their next request, before the whole of its request line has come.
- It also closes those that read and drop what the client still sends after their last response, even if what one leaves unread resets it.
- A request being served gets its response, with `connection: close`, and its connection ends then, as it ends after any response.
- It resolves once every connection has ended, as does a `close` of a closed server.

#### Connections

- A connection serves its requests one after another.
- It goes on after a response to HTTP/1.1 unless the request's `Connection` holds `close`, and after one to HTTP/1.0 only if it holds `keep-alive`.
- What the handler leaves unread of a body is read and dropped before the next request; if that read fails, the connection is closed.
- **100-continue.** To an HTTP/1.1 request with a body and `Expect: 100-continue`, the server sends `100 Continue` as the handler starts to read the body, or before the head of a response whose body is a `Reader`, which may read it.
  - If the handler answers without reading it, the client may not send it, so the connection is closed after the response.
- **Closing.** A connection is closed once what the client still sends, as a body that the server did not read, has been read and dropped, for up to 2 seconds and 64 KiB, after the server has ended its writing side.
  - Why: so that the client gets the response rather than a reset. Closing the server cuts this short.
- Each connection is served in a function of its own that catches what it throws.
- **A failed accept.** A failure of an accept while the server is open rejects a promise that nothing awaits, which ends the program (see [functions that await](functions.md#functions-that-await)).
  - This happens on Windows, where libuv stops listening once it cannot make a socket for the next connection, as when the system runs out of them.
  - Elsewhere libuv drops a connection it cannot take, and one that its peer resets is served (see [std:net](#stdnet)).

#### Reading a request

- A body is read by `Content-Length`, or by its last chunk for `Transfer-Encoding: chunked`, whose extensions and trailer fields are dropped.
- A read of a body fails with an `IOError`:
  - `a body ended early` once the connection ends before it;
  - `a malformed body` for a chunk that is malformed, as a size that is not hexadecimal, which only spaces and tabs may follow, and only before its extensions, or a line longer than 64 KiB.
- After a read that fails, every later one fails so too, and the response gives `Connection: close` and closes the connection.

#### Requests answered without the handler

The server answers these without calling the handler, and closes the connection after each:

| Status | Request |
|---|---|
| 400 | A request line that is not three words. |
| | A method that is not a token. |
| | A target that holds a character that is not printable ASCII, or that neither starts with `/` nor is a URL of `http` or `https`, as `*`. |
| | A field that `Headers` does not take, or that has no `:`. |
| | A line that is not UTF-8. |
| | A `Content-Length` that is not digits alone. |
| | A `Host` that is empty, holds a character that is not printable ASCII, or holds `/`, `\`, `?`, `#` or `@`, as it would change the path of the URL; a second `Host`; an HTTP/1.1 request without one. |
| | An HTTP/1.0 request with `Transfer-Encoding`; one whose `Transfer-Encoding` names no coding, its empty elements dropped, or `chunked` more than once; one with both `Transfer-Encoding` and `Content-Length`, which could tell another end of the body to a proxy before the server. |
| 505 | A version other than HTTP/1.1 and HTTP/1.0. |
| 501 | A `Transfer-Encoding` other than `chunked`. |

These responses, and the 500 below, have an empty body.

#### Errors of the handler

- A handler that throws is answered 500, as one does that reads a body that ends before its `Content-Length`.
- So is a `Response` of a status outside 200 to 599, of a `Reader` as its body, or of fields that `Headers` would not take, put in `fields` directly.
- The connection is closed then.

#### Writing a response

- The server writes `Content-Length` and `Connection` itself, in place of those the handler gives, and leaves out its `Transfer-Encoding`.
- It writes `Date`, the time of the response in the form of RFC 9110, `Thu, 29 Oct 2026 08:00:00 GMT`, unless the handler gives one.
- **A `Reader` body** has no `Content-Length`. It is sent with `Transfer-Encoding: chunked`, or to an HTTP/1.0 request as it is, ended by closing the connection.
  - What its reads give at once, without waiting, is joined, up to 64 KiB, into one chunk and one write, the last chunk with it once they give the end, so that a `Reader` of small pieces takes few writes.
  - What comes after a read that waits goes in the next, so it is not held back.
  - A read of it that fails closes the connection. That leaves its last chunk unsent, or, for HTTP/1.0, the body cut short, which the client cannot tell from a whole one.
- A response to `HEAD` has no body but its `Content-Length` or `Transfer-Encoding`; one of 204 or 304 has neither.

### The client

| Name | |
|---|---|
| `fetch(url: String, options: FetchOptions): Promise<Response>` | Sends a request with a client that the program shares, as `Client().fetch` does. |
| `FetchOptions` | A struct of `method = 'GET'`, `headers = Headers()`, `body: Body = ''` and `follow_redirects = true`, given as named arguments: `fetch(url, method: 'POST', body: 'hi')`. |
| `Client` | A class of `idle_timeout = 4.0`, the seconds it keeps a connection, and `max_idle = 8`, the connections it keeps to each host and port, and the methods below. |

- `Client.fetch(url: String, options: FetchOptions): Promise<Response>` is resolved once the head of the response has come.
- `Client.close()` closes the connections kept; the client keeps those it uses after.
- Cookies are not stored or sent by the client: a program reads `Set-Cookie` with `get_all` and writes `Cookie` itself.

#### URLs

- A URL is `http://`, of a host, an IPv6 address in brackets, a port, 80 if none, a path and a query, which the request line takes.
- The scheme is told regardless of case, and the fragment is left out.
- `fetch` throws a `ValueError`, `not an http URL: <url>`, for another scheme, a URL without a host, with a user, a host with a space, a control character or one that is not ASCII, or a port that is not digits or is past 65535.
- In the path and the query, these are sent as `%XX` of each byte of their UTF-8, as the WHATWG URL Standard has them: a space, a control character, one that is not ASCII, `"`, `<` and `>`; `^`, `` ` ``, `{` and `}` in the path; `'` in the query. A `%` is sent as it is.
- An `https` URL, which needs TLS, is rejected with an `IOError`, `https is not supported so far: <url>`.

#### Sending a request

- Before it connects, it throws a `ValueError`, `not a method: <method>`, for a method that is not a token, and for fields that `Headers` would not take, put in `fields` directly.
- The client writes `Host` and `Content-Length` itself, in place of those it is given in any case.
- It leaves out `Connection`, as connections are kept alive by default in HTTP/1.1, and `Transfer-Encoding`.
- It writes a `Content-Length` for a body that is not empty, and for an empty one of `POST`, `PUT` and `PATCH`.
- **A `Reader` body** is sent with `Transfer-Encoding: chunked`, its chunks joined as the server's are.
  - It is sent on a new connection, as it cannot be sent again on one that the server has closed meanwhile.
  - The client reads the response while it sends it, as a server may answer before it has read the body. What is left of the body is then not sent, and the connection is not kept.
  - The `Reader` is closed once the final response has come, past those of redirects, or the request has failed.
  - A read of it that fails fails the request with its error.

#### Reading a response

- A response's body ends by its `Content-Length`; by its last chunk for `Transfer-Encoding: chunked`, whose extensions and trailer fields are dropped, and which goes before a `Content-Length`; or else with the connection.
- A `Content-Length` written twice is malformed, even with one value.
- A response to `HEAD`, and one of 204 or 304, has no body.
- A response of 100 to 199 is passed over for the one that follows it. A 101, which switches to another protocol, is rejected with an `IOError`, `switching protocols not supported`.
- It is rejected with an `IOError`:
  - `a malformed response` for a malformed response;
  - `a transfer coding not supported: <coding>` for another transfer coding;
  - `a response ended early` for a body read past where the connection ended;
  - `the connection closed before a response` for a connection that ends before the response.
- Malformed are: a line longer than 64 KiB, more than 256 lines of fields, and the size of a chunk that the server would take as malformed.
- A field folded onto lines that start with a space or a tab is read as one, its lines joined by a space. It is malformed if longer than 64 KiB so joined; such a line before any field is malformed.

#### Kept connections

- A connection is kept alive once the body of its response has been read to its end, or at once for a response without a body by its framing.
- It is not if the response ends with the connection, holds `close` in its `Connection` field, or is HTTP/1.0 without `keep-alive` there.
- The next request to the same host and port, as the URL writes them, is sent on the latest kept.
- One kept for `idle_timeout` seconds is closed instead, before the server, whose timeout may be about as long, closes it.
- A request of `GET`, `HEAD`, `PUT`, `DELETE`, `OPTIONS` or `TRACE` that fails on a kept connection before any of its response comes, as when the server has closed it meanwhile, is sent again on a new one.
- A connection that is not kept is closed once its body ends, and on a failure.
- A body left unread holds its connection, which closes once nothing holds it, or once the body, a `Reader`, is closed before its end.
- A read of a body that is cancelled, as by `timeout`, leaves its connection open, and the next read goes on from where it stopped.

#### Redirects

- A 301, 302, 303, 307 or 308 with a `Location` is followed to the URL it names, unless `follow_redirects` is false, up to 20 in a row.
  - The URL is relative to that of the request; an empty one or a fragment names that URL itself.
  - Its `.` and `..` segments are kept as they are, for the server to resolve.
- It is rejected with an `IOError`:
  - `too many redirects: <url>` for one more;
  - `a malformed redirect: <location>` for a `Location` that is not an http URL, as `fetch` would take it.
- A 303 to a method other than `HEAD`, and a 301 or a 302 to `POST`, is followed with a `GET` without the body or its `Content-Type`.
- Another is followed with the method and the body, unless the body is a `Reader`, which has been read: the response is then given as it is.
- A redirect to another host or port leaves out `Authorization`, `Cookie` and `Proxy-Authorization`.
- The body of each response redirected is read to its end and dropped, so that its connection is kept, unless it is longer than 1 MiB: its connection is then closed.

## std:io

### Files

| Name | |
|---|---|
| `read_file(path: String): Promise<Binary>` | The contents of a file. Rejected with `cannot read file: <path>` on failure, including for a path that holds a NUL byte and for a file that is not regular, such as a FIFO or a device. |
| `read_text(path: String): Promise<String?>` | The contents as a `String`, read as `read_file` reads them, or nil if they are not valid UTF-8. Rejected as `read_file` is. |
| `write_file(path: String, data: String \| Binary): Promise` | Replaces the contents of a file, creating it if needed, with the data: a Binary's bytes, or a String's UTF-8. Rejected with `cannot write file: <path>` on failure. |
| `copy_file(from: String, to: String): Promise` | Copies the contents of a file, replacing a file at `to` (below). |
| `remove_tree(path: String): Promise` | Removes a file, or a directory with everything in it (below). |
| `remove_file(path: String)` | Removes a file, or a symbolic link, not what it links to. Throws `cannot remove file: <path>` on failure, including for a directory, a path that names nothing, an empty path or one that holds a NUL byte. |
| `is_file(path: String): Bool` | Whether the path names a regular file, through symbolic links. False where `stat` gives nil, and for a directory. |
| `is_dir(path: String): Bool` | Whether the path names a directory, through symbolic links. False where `stat` gives nil, and for a file. |
| `stat(path: String): FileStatus?` | What the path names, through symbolic links, or nil if nothing is there or its status cannot be read, as for a dangling link, a loop of links or a path that holds a NUL byte. |
| `FileStatus` | A struct of `kind: FileKind`, `size: Int`, in bytes, and `modified_time: Float`, when it was last modified, in seconds since the Unix epoch, as `time` of [std:time](#stdtime) tells them. |
| `FileKind` | An enum of `FILE`, `DIR` and `OTHER`, as a device. |
| `list_dir(path: String): String[]` | The names of the entries of a directory (below). |
| `make_dir(path: String)` | Makes a directory and any of its parents that are missing; a directory that is there already is no failure. Throws `cannot make directory: <path>` on failure, including for an empty path or one that holds a NUL byte. |
| `make_temp_dir(): Binary` | Makes a new, empty directory for temporary files, and gives its path (below). |
| `rename(from: String, to: String)` | Moves a file or a directory (below). |
| `make_link(target: String, path: String)` | Makes a symbolic link at `path` to `target` (below). |
| `real_path(path: String): Binary` | The absolute path of what the path names, without `.`, `..` or symbolic links (below). |

- `open` is under [open and File](#open-and-file).
- `read_file`, `write_file`, `remove_tree` and `copy_file` run on the event loop, at the same time as each other and as the program. So one that depends on another, as a read of a file that a write makes, awaits it first.

#### copy_file

- On POSIX systems, a new copy takes the permissions of the file, less the umask and without the setuid, setgid and sticky bits.
- A file replaced keeps those of its own permissions that the file has too, so that the copy of a private file is not readable by others.
- Rejected with `cannot copy file: <from>` on failure, including:
  - for a path that holds a NUL byte;
  - for a directory;
  - for a copy onto the file itself, which is left as it was;
  - on POSIX systems, for a copy onto a file that the user does not own and that the copy would make private.

#### remove_tree

- A symbolic link is removed, not what it links to; on POSIX systems, even when a `/` follows its name.
- Rejected with `cannot remove: <path>` on failure, including for a path that names nothing or holds a NUL byte, and, before anything is removed, for one whose last part is `.` or `..`.
- On Windows, a read-only file is removed too.

#### list_dir

- The names are without `.` and `..`, in the order of their bytes.
- Throws `cannot list directory: <path>` if the path does not name a directory that can be read, is empty or holds a NUL byte.
- Throws a `ValueError`, `a name is not valid UTF-8 in the directory: <path>`, if a name is not valid UTF-8.
- On Windows, whose names are UTF-16, a name that is not valid UTF-16 is read with U+FFFD in place of what is not, as the other paths that Windows gives are.

#### make_temp_dir

- The directory is made in the system's directory for temporary files:
  - on POSIX systems, the first of `TMPDIR`, `TMP`, `TEMP` and `TEMPDIR` that is set, or else `/tmp`, also if that is set empty;
  - on Windows, `GetTempPathW`.
- Its path is a `Binary`, as `real_path` gives.
- Throws `cannot make a temporary directory` on failure.

#### rename

- It replaces a file at `to`; on POSIX systems, the replacement is atomic.
- A directory also replaces an empty directory at `to` on POSIX systems, but not on Windows.
- Throws `cannot rename: <from>` on failure, including when `to` is a directory that is not empty, or a path holds a NUL byte.

#### make_link

- `target` is written as it is, relative to the link's directory unless it is absolute, and need not be there.
- On Windows, `/` in either is written `\`, and the link is to a directory if the target is one when it is made. Making it needs developer mode or the privilege to make links.
- Throws `cannot make link: <path>` on failure, as when something is at `path`.

#### real_path

- It is a `Binary`, as nothing makes it UTF-8.
- Throws `cannot resolve path: <path>` if it names nothing, or holds a NUL byte.
- On POSIX systems, the system works a path out as it reads it. So a `..` names the directory above the one that a symbolic link before it points into, and a path through a name that is not there names nothing.
- On Windows, it works `.` and `..` out as text first. So a `..` cancels the name before it, a link or not, there or not.

### open and File

| Name | |
|---|---|
| `open(path: String, mode: OpenMode): File` | Opens a file, at once, as it is one system call. Throws `cannot open file: <path>` on failure, including for a path that holds a NUL byte. |
| `OpenMode` | An enum of how `open` opens a file: so far only `WRITE`, for writing, which empties the file or makes it. |
| `File` | A struct of a file that `open` has opened, whose `writer` is a `Writer` of it. |

The `writer`:

- It gathers what is written in a buffer, which it writes out on the event loop once it holds 64 KiB.
- A write that fills the buffer is resolved once the bytes are written out, as for `stdout`.
- `flush(): Promise` is resolved once all that was written before it is in the file.
- A write out that fails rejects the write, the flush or the end that waits for it, and every later one, with `cannot write file: <path>`.
- `end(): Promise` writes out the rest, as a flush does, and closes the file, even if that write out fails; it is resolved once the file is closed. A write or a flush after it is rejected with `cannot write to a file that has ended`, and a later end is settled as the first.
- A writer that nothing holds any more writes out the rest at once, unless it has ended, and closes the file.
  - A failure then has no one to tell, so a program that needs to know, or that reads the file next, ends it first.

### Reader

A class, exported, that reads a stream in chunks through a buffer.

| Member | |
|---|---|
| `read_chunk: () -> Promise<Binary?>` | A field: gives the next chunk, or nil at the end. |
| `on_close: (() -> void)?` | A field: what `close` calls. |
| `read_line(max = INT_MAX): Promise<String?>` | The next line, without its `\n` and a `\r` before it, or nil at the end. |
| `read(max: Int): Promise<Binary?>` | The bytes there are to read, at most `max`, or nil at the end. |
| `read_exactly(count: Int): Promise<Binary?>` | `count` bytes, or nil at the end. |
| `read_all(): Promise<Binary>` | All that is left. |
| `close()` | Tells the source that nothing reads it any more. |

- **read_line** throws:
  - a `ValueError` for a negative `max`;
  - a `ValueError`, `a line is not valid UTF-8`, for a line that is not;
  - a `LineTooLongError`, exported too, `a line is longer than <max> bytes`, once more than `max` bytes, a `\r` among them, have come before its `\n`.
- **read** waits for bytes only if there are none. So `read(0)` takes none and tells whether the end has come.
- **read_exactly** throws an `IOError`, `the end came after <n> of <count> bytes`, once the end comes after some of them.
- `read` and `read_exactly` throw a `ValueError` for a negative `max` or `count`.
- **One read at a time.** A read must end before the next one starts: one that starts while another is pending throws a `ValueError`, `a Reader is read by another read that has not ended`.
- **A read that throws or is cancelled** leaves what it has taken from the chunks for the next.
  - A cancel cancels the chunk it waits for, if it waits for one (see [cancellation](functions.md#cancellation)).
  - A chunk that `read_chunk` has given but the read has not taken yet is lost, unless `read_chunk` keeps it for the next call itself, as that of `stdin` does.
- A read of `stdin` keeps the program running until it ends, as a timer does, even if nothing awaits it.
- **close** calls `on_close`, if the `Reader` is made with it; it does nothing else.

### Writer

An interface, exported, of what data is written to, as a stream.

| Member | |
|---|---|
| `write(data: String \| Binary): Promise` | Writes the data. |
| `end(): Promise` | Closes it, so that its reader reads its end. Resolved once at least what it holds of the writes before it is written, or rejected if that failed; a write under way is settled on its own, which an end may not wait for, as those of a `Socket` and a `Pipe` do not. |

- A write after the end is rejected, but by `stdout` and `stderr`, whose `end` only flushes (see [stdout and stderr](#stdout-and-stderr)).
- `stdout`, `stderr`, a `Buffer`, the `writer` of a `File` and of a `Pipe`, and a `Socket` of [std:net](#stdnet) are `Writer`s.

### Buffer

A class, exported, of a `Writer` that keeps what is written, as `run` of [std:process](#stdprocess) keeps a program's output: `output := Buffer()`, then `run('tool', stdout: output)` and `output.text()`.

| Member | |
|---|---|
| `limit: Int?` | The most bytes that it keeps; else no limit. A negative one throws a `ValueError` at construction. |
| `binary: Binary` | What has been written. |
| `text(): String?` | That as text, or nil if it is not valid UTF-8. |

- A write is resolved at once. One that would take it past `limit` is rejected with an `IOError`, `more than <limit> bytes written to a buffer`, and adds nothing; given to `run`, that stops the program (see [RunOptions](#runoptions)).
- After the end, `binary` and `text` still read what it holds, and a write is rejected with an `IOError`, `cannot write to a buffer that has ended`.

### Pipe

A struct, exported, of a `writer` and a `reader`, a `Reader` that reads what the `writer` writes, in its order.

- Why: so that one program that `run` of [std:process](#stdprocess) starts may read what another writes: `run('a', stdout: pipe.writer)` beside `run('b', stdin: pipe.reader)`.
- **Writes.** A write is resolved once the reader has taken its chunk, so that a writer waits for its reader.
  - An empty one is resolved at once.
  - One that is cancelled before its chunk is taken writes nothing; one cancelled after is resolved, as its data has gone to the reader.
- **End.** Once the `writer` has ended, the reader reads nil after the rest, an `end` after it does nothing, and a write is rejected with an `IOError`, `cannot write to a pipe that has ended`.
- **fail.** The `writer` also has `fail(error: Error)`, which ends it so that the reader, after the rest, throws the error in place of reading nil, at every read.
  - Why: so that its reader can tell a stream cut short from one that ended.
  - A `fail` or an `end` after the end does nothing, and a `fail` once the reader has closed leaves it reading nil.
  - A program that reads a system pipe (below) reads its end.
- **A closed reader.** Once the `reader` of a pipe that is not a system pipe is closed, it reads nil after what its buffer still holds, and the chunks not taken yet are dropped.
  - Their writes and every later one are rejected with an `IOError`, `cannot write to a pipe whose reader has closed`, as a write to a system pipe whose reader has gone fails.

#### System pipes

- A `Pipe` that `run` is given itself, before anything has used it, becomes a pipe of the system, which the programs share, so that their data does not go through this program: `run('a', stdout: pipe)` beside `run('b', stdin: pipe)`.
- A program that takes an end holds it, and this program no longer does. So the program that reads reads the end once the program that writes has ended, and the program that writes fails, once the program that reads has ended, as a write to such a pipe does: by SIGPIPE on POSIX systems.
- An end is taken by one program, as a `writer` is ended by the first `run` it is given, but by both outputs of one.
- The `reader` and the `writer` read and write the ends that no program has taken, through the system; a write is resolved once the system has taken it.
- At an end that a program has taken, the `reader` reads nil, a write is rejected as after an end, and a `fail` does nothing, as after an end. A `run` given that end again reads nothing or fails so.
- The `reader`'s `close` and the `writer`'s `end` close this program's end. A write fails then with an `IOError` of the system, `cannot write to a pipe`, once no end that reads is left.
- A `Pipe` that `run` is given once it has been used is read or written as its `reader` and `writer` are.

### stdout and stderr

`Writer`s of the standard output and error, which also have:

| Method | |
|---|---|
| `flush(): Promise` | Resolved once all that was written before it is written out. |
| `is_terminal(): Bool` | Whether the stream goes to a terminal; a console on Windows, where the terminals of MSYS2 and Cygwin are pipes. |
| `uses_color(): Bool` | Whether to color what is written to it, as tools do: false if `NO_COLOR` is set and not empty, else true if `FORCE_COLOR` is set and not empty, else false if `TERM` is `dumb`, else `is_terminal()`. |

- **One buffer.** They write through one buffer for both, to a terminal or not, in the order of the writes, so that the output keeps its order where the two go to the same place.
- The buffer is written out on the event loop when it holds 64 KiB or more, on `flush`, before each `print` and `print_error` (see [builtins](builtins.md)), before `run` starts a program, and at exit.
- **Writes.** A write that leaves the buffer under 64 KiB is resolved at once. One that fills it is resolved once its bytes are written out, so that a program that writes faster than its reader reads waits for it.
- **Failures.** Once the bytes of a stream fail to be written out, the writes and flushes that wait for them, and every later write and flush of the stream, are rejected with an `IOError`, `cannot write to stdout` or `cannot write to stderr`. A write resolved at once is not.
  - Once a write to `stdout` or `stderr` fails, its later output is dropped.
  - Once one to `stdout` fails, the program exits with code 1 if it would exit with 0.
- **SIGPIPE.** A write to a pipe whose reader has closed it, as in `program | head -1`, ends the program on POSIX systems by the signal SIGPIPE, which shells report as status 141, as it does C programs, even if the program was started with SIGPIPE ignored.
  - Why: so that a program that writes on and on stops with its reader.
  - On Windows, which has no such signal, the write fails as any other.
- **Windows.** A write to a console is written as UTF-16, so it shows whatever the console's code page. No newline becomes CRLF.
- **Closed streams.** On POSIX systems, a stdout or stderr closed when the program starts is opened read-only on `/dev/null`, so writes to it fail.
- **end** only flushes, and so is rejected as a flush is, and leaves the stream open: the program writes on to them after a `run` that is given one, which ends it, and their reader does not read its end.
- On Windows, a console is set at start to show the escape sequences of colors, and left so at exit.
- Their type, `StandardOutput`, is not exported, so that no other is made: code that flushes names `stdout` or `stderr` itself.

### stdin

- A `Reader` of the standard input, which reads it on the event loop in chunks of up to 64 KiB, through a buffer that its methods share.
- A closed stdin reads as empty.
- On Windows, a console is read as UTF-16 and given as UTF-8, and a line that begins with Ctrl-Z ends the input.
- A read that fails is rejected with an `IOError`, `cannot read stdin`.
- A program that `run` of [std:process](#stdprocess) starts may share it (see [RunOptions](#runoptions)).

## std:json

```lerta
import decode_json, encode_json from 'std:json'

text := encode_json([1, 2])  # '[1,2]'
xs := decode_json<Int[]>(text)
```

| Name | |
|---|---|
| `encode_json<T: Codable>(value: T, keys: JsonKeys = JsonKeys.AS_WRITTEN): String` | The value as JSON, with no whitespace, a value of any [Codable](#codable) type. |
| `decode_json<T: Codable>(text: String, keys: JsonKeys = JsonKeys.AS_WRITTEN): T` | The value of type `T` that the text holds, with whitespace around its parts and nothing but whitespace after it. Throws a `JsonError` for text that is not JSON, does not fit `T` or nests arrays and objects more than 128 deep. |
| `JsonKeys` | How the keys of the fields of objects are written (below). |
| `JsonError` | The error of `decode_json`, and of `encode_json` for a value that holds itself or that camel case cannot write (below), a struct of a `message`. |

### JsonKeys

- `AS_WRITTEN`: the fields' names.
- `CAMEL_CASE`: each `_` between another character and a lowercase ASCII letter left out, and the letter in uppercase, as `textDocument` for `text_document`, for formats such as the LSP's.
  - A leading `_`, one after another, and one before anything else, stay.
- The `String` keys of maps, which are data, stay as they are; keys of other types are written as any other value.
- `encode_json` throws a `JsonError` for an object with two fields that camel case writes as one key, as `ab_c` and `abC`, which would give it two values of the key: `$.pair: two fields of the key "abC"`. `decode_json` reads the key into the first of them.

### Types

| Lerta | JSON |
|---|---|
| `Int` and the other integer types | A number written as an integer, without a fraction or an exponent, in the range of the type: `$.size: expected a Byte, found 256`. |
| `Float`, `Float32` | A number, written as the type's `to_string` writes it. One that is not finite as one of the type, as `1e400`, is none, and an infinity cannot be written: `$.x: inf, which JSON cannot hold`. |
| `Bool` | `true` or `false`. |
| `String` | A string. `encode_json` escapes `"`, `\` and the control characters. `decode_json` reads every escape of JSON, a surrogate pair as one code point, but no lone surrogate. |
| `Binary` | A string of its bytes in base64 (RFC 4648), with its `=` padding. `decode_json` takes only that, with the bits that the padding leaves over zero, so that each `Binary` has one text. |
| `T?` | `null` for nil, otherwise as `T`. |
| `T[]` | An array. |
| tuples | An array of as many items. |
| `Char` | A string of it alone. |
| `Set<T>` | An array of its items, in their order; `decode_json` takes no item twice: `$[2]: the same as one before`. |
| `Map<String, V>` | An object, of the entries in their order. |
| `Map<K, V>` of other keys | An array of the entries in their order, each an array of its key and its value: `[[1,"one"]]`; `decode_json` takes no key twice. |
| classes, structs, anonymous structs | An object, of a key for each field, as `JsonKeys` writes its name, in the order of the fields (below). |
| enums | The member's text, as `to_string` gives it, as a string. |
| unions | The member, as it is written alone (below). |

- **Objects.** `decode_json` reads the fields that the constructor takes, and constructs the object as a call does, running its `init`.
  - A field with a default, or of an optional type, may be left out, and is then its default, or nil.
  - A key that is no such field, as one of a field given by an initializer alone, is skipped.
  - A key may not be given twice.
- **Unions.** `decode_json` takes the member that the kind of the JSON value tells: a number, `true` or `false`, a string or an object.
  - So the members must be of different kinds. A union of two number types, as `Int` and `Float`, of two that are strings, as `String` and `Binary`, a `Char` or an enum, or of two classes or structs, does not satisfy `Codable`.
  - Nor does a union with an array, a set, a map, a tuple or an anonymous struct as a member, so far.
  - A value of no member's kind is an error: `$.id: expected Int | String, found an array`.

### JsonError

- Its message gives the path to the value it is about: `$` for the whole value, `[i]` for an item of an array and `.name` for the value of a key.
- Then what was expected and found: `$.items[1]: expected an Int, found 2.5`.
- For an object: `$.position: missing the key "line"` and `$.kind: the key "kind" twice`. For an enum: `$.color: expected a member of Color, found "BLUE"`.
- What is found is written as one of: a number as it is written, `null`, `true`, `false`, `a string`, `an array`, `an object`, `a number that is not JSON`, a character in quotes, or `the end of the text`.
- A string that does not end, an escape that is not JSON, a lone surrogate and a control character in a string give messages of their own.
- **Cycles.** `encode_json` throws a `JsonError` for a value that holds itself, through any of its parts, naming the path to where it does and the path it comes back to: `$.children[0].parent: a cycle back to $`.
  - An object reached twice otherwise is written twice.
  - Only the classes and structs whose types can hold themselves are looked for.

## std:math

- Functions of `Float`s, and constants.
- The functions throw an `ArithmeticError` where the result would be NaN, as `Float`'s operators do (see [Float](types.md#float)).
- `min` and `max` are [builtins](builtins.md#functions).

| Name | |
|---|---|
| `INFINITY: Float` | The positive infinity; `-INFINITY` is the negative one. |
| `PI: Float`, `E: Float` | The nearest `Float`s to π and e. |
| `abs(x: Float): Float` | The value without its sign. |
| `floor(x: Float): Float`, `ceil(x: Float): Float` | The greatest integer not above `x`, and the least not below it, as `Float`s. `.to_int()` makes an `Int?` of one, nil beyond an `Int`. |
| `round(x: Float): Float` | The nearest integer, half way between two away from zero: `round(2.5)` is `3.0`, `round(-2.5)` is `-3.0`. |
| `sqrt(x: Float): Float` | The square root. Throws `square root of a negative number` for one below 0. |
| `pow(x: Float, y: Float): Float` | `x` to the power `y`, as C's `pow` gives it: an infinity where the result is too large, or for 0 to a negative power. A result below the normal range may be one ulp off, as on 64-bit Windows. Throws `a negative number to a fractional power` for a finite negative `x` and a `y` that is no integer. |
| `remainder(x: Float, y: Float): Float` | The remainder of `x` divided by `y` (below). |
| `sin(x: Float): Float`, `cos(x: Float): Float`, `tan(x: Float): Float` | Of an angle in radians. Throw `not a number` for an infinite one. |
| `asin(x: Float): Float`, `acos(x: Float): Float` | The angle whose sine or cosine `x` is, in `-PI / 2.0..=PI / 2.0` and `0.0..=PI`. Throw `a sine or cosine out of -1.0..=1.0` for an `x` out of it. |
| `atan(x: Float): Float` | The angle whose tangent `x` is, in `-PI / 2.0..=PI / 2.0`. |
| `atan2(y: Float, x: Float): Float` | The angle of the point (`x`, `y`), in `-PI..=PI`. Its sign is that of `y`, so a `y` of `-0.0` and a negative `x` give `-PI`. |
| `exp(x: Float): Float` | e to the power `x`: an infinity where the result is too large, 0 where it is too small. |
| `log(x: Float): Float`, `log2(x: Float): Float`, `log10(x: Float): Float` | The logarithm to the base e, 2 or 10; `-INFINITY` for 0. Throw `logarithm of a negative number` for one below 0. |
| `hypot(x: Float, y: Float): Float` | `sqrt(x * x + y * y)`, without overflowing where the result does not. |

`remainder`:

- It is `x - n * y`, for `n` the integer of `x / y` truncated toward zero, as `%` of `Int`s takes it. So it has the sign of `x`: `remainder(-7.5, 2.0)` is `-1.5`.
- It is C's `fmod`, not its `remainder`, which rounds `n` to the nearest.
- Throws `division by zero` for a `y` of 0, and `not a number` for an infinite `x`. An infinite `y` gives `x`.

## std:net

TCP and UDP over IPv4 and IPv6, on the [event loop](functions.md#functions-that-await).

| Name | |
|---|---|
| `listen_tcp(host: String, port = 0): Listener` | Listens, at once, at the first address that the host resolves to, and at a free port if `port` is 0. Throws `cannot listen at <host>:<port>` on failure, including for a host that holds a NUL byte. |
| `connect_tcp(host: String, port: Int): Promise<Socket>` | Resolves the host and connects to each of its addresses in turn until one connects. Rejected with `cannot connect to <host>:<port>` if none does, including for a host that holds a NUL byte. A cancel gives up the connect. |
| `Listener` | A struct of `port: Int`, the port it listens at, and the methods `accept(): Promise<Socket>` and `close()`. |
| `Socket` | A struct of `reader: Reader`, of [std:io](#stdio), and the methods `write(data: String \| Binary): Promise`, `end(): Promise` and `close()`. |
| `bind_udp(host: String, port = 0): UdpSocket` | Binds, at once, at the first address that the host resolves to, and at a free port if `port` is 0. Throws `cannot bind at <host>:<port>` on failure, including for a host that holds a NUL byte. |
| `UdpSocket` | A struct of `port: Int`, the port it is bound at, and the methods `send(data: String \| Binary, host: String, port: Int): Promise`, `receive(): Promise<Datagram>` and `close()` (see [UDP](#udp)). |
| `Datagram` | A struct of `data: Binary`, and `host: String` and `port: Int`, where it came from, `host` a numeric address without brackets. |

- **accept** gives the next connection. It is rejected with `cannot accept at <host>:<port>` on failure.
  - It throws a `ValueError`, `a Listener is accepted by another accept that has not ended`, while another accept is pending, as a `Reader` does.
- **A Socket.**
  - Its `reader` reads what comes in chunks, nil at the peer's end.
  - `write` is resolved once the data has been handed to the system, so that a writer faster than the network waits.
  - `end()` closes the writing side, read by the peer as its end once what was written has gone.
  - `close()` closes both.
  - A failure of a read or a write is rejected with `cannot read from <address>` or `cannot write to <address>`, the address that of the peer.
  - A write to a peer that has gone fails so, rather than ending the program by SIGPIPE.
- A port outside 0 to 65535 throws a `ValueError`.
- An address is written `<host>:<port>`, with an IPv6 address in brackets, as `[::1]:80`.
- **Lifetime.** A socket or a listener closes once nothing holds it.
  - It keeps the program running only while a read or an accept of it waits, so that one left open does not keep the program from ending; a write that is under way does.
- **close** fails what waits for the socket or the listener, a read or an accept, and what is asked of it after the close, but `close` itself, which does nothing then. A write that is under way may still go out.
- **Cancels.** A cancelled read loses nothing, as the next read gets what comes. A cancelled accept leaves the connection for the next. A cancelled write goes on, which cannot be stopped.
- **A peer that has gone.** A connection whose peer's address cannot be read, as one that its peer resets before an accept takes it, is given all the same, its address `a peer that has gone`. Its reads fail or end, so that a server goes on accepting.
- **Serving.** A server serves each connection in a function of its own that it does not await, `spawn serve(await listener.accept())`. That function must catch what it throws, since a rejected promise that nothing awaits ends the program (see [functions that await](functions.md#functions-that-await)).

### UDP

```lerta
import bind_udp from 'std:net'

socket := bind_udp('127.0.0.1')
await socket.send('ping', '127.0.0.1', socket.port)
datagram := await socket.receive()
print datagram.data.text()!
```

- **send** sends the data as one datagram to the first address of the socket's family, IPv4 or IPv6, that the host resolves to. It is resolved once the datagram has been handed to the system, and rejected with `cannot send to <host>:<port>` on failure, as for a datagram too large or a host of the other family.
  - A numeric host is not resolved. A name is resolved on the thread pool, and the socket keeps the address of the name that it resolved last, with its port, for a second, so that the sends that follow to it are not resolved again.
- **receive** gives the next datagram, whole, an empty one too. It is rejected with `cannot receive at <host>:<port>`, where the socket is bound, on failure.
  - It throws a `ValueError`, `a UdpSocket is received by another receive that has not ended`, while another receive is pending, as a `Reader` does.
- **Lifetime, close and cancels** are as of a `Socket`, a receive for a read and a send for a write, but a cancelled send to a name that is still being resolved is given up.

## std:process

| Name | |
|---|---|
| `argv: String[]` | The command-line arguments, without the program name, read when the module runs. A program that imports `std:process` throws at its start if an argument is not valid UTF-8. |
| `program: String` | The last name of the path that the program was started by, as a usage message names the program: `tool` for `/usr/bin/tool`, and on Windows, where `\` separates names too, without `.exe`. Empty if the program was started without one. It throws at the start as `argv` does if not valid UTF-8. |
| `exit(code: Int): never` | Writes out the buffer of `stdout` and `stderr` and ends the program with the exit code, from 0 to 255; another code throws a `ValueError`. A failed write to `stdout` turns 0 into 1 (see [stdout and stderr](#stdout-and-stderr)). |
| `run(command: String, args: String..., options: RunOptions): Promise<Exit>` | Runs a program with the arguments (below). |
| `RunOptions` | A struct of the options of `run` (below). |
| `Output` | An enum of where `run` sends a program's output or errors besides a `Writer` or a `Pipe`: `DISCARD` and `STDOUT` (see [RunOptions](#runoptions)). |
| `Exit` | A struct of how a program ended (below). |
| `env(name: String): String?` | The value of an environment variable, or nil if it is not set, including for a name that holds `=` or a NUL byte. Throws a `ValueError`, `the environment variable <name> is not valid UTF-8`, if the value is not. |
| `Platform` | `enum Platform`: `'macos'`, `'linux'` and `'windows'`, the systems that a program may be built for. |
| `platform: Platform` | The system the program is built for, which the compiler writes in the code: a member of `enum Platform`, `'macos'`, `'linux'` or `'windows'`. |
| `optimized: Bool` | Whether the program is built optimized, as by `-O`, which the compiler writes in the code. |
| `cpu_count: Int` | The number of CPUs that the program may run on when the module runs, at least 1. |
| `process_id: Int` | The ID of the program's process. |
| `is_running(id: Int): Bool` | Whether a process with the ID is running, including one that the program may not signal. An ID of 0 or below, or beyond those the system gives, is not. |

### run

- **Finding the program.** It is found on `PATH` on every platform, unless the command holds a directory.
  - On Windows, `<command>.exe` is tried before `<command>` on `PATH`; with a directory, the name as it is, after it with `.com` and then `.exe` added.
  - On POSIX systems, the `PATH` is the one that the program is given, as `env` may change it; on Windows, this program's.
- It runs in the [event loop](functions.md#functions-that-await): programs run at the same time.
- The options are named arguments (see [functions](functions.md)).
- `stdout` is flushed first, so that output keeps its order.
- On Windows, the arguments reach the program as they were given, and so do the variables, even those that are not valid UTF-16.
- The `Promise` is resolved with how the program ended, an `Exit`, once it ends.
- **A cancel** stops the program: on POSIX systems, it is sent SIGTERM, then SIGKILL if it has not ended after `kill_after` seconds; on Windows, it is terminated at once.
  - The `Promise` is then rejected with the `CancelledError` once the program has ended, its output dropped.
  - A program that it started goes on.
- **Failures.** The `Promise` is rejected with:
  - `cannot run: <command>` if the program cannot start, including when the command, an argument, the directory or a variable's value holds a NUL byte, and on Windows when the file is a `.bat` or `.cmd` batch file, whose arguments `cmd.exe` would parse again;
  - `cannot read the output of: <command>` if its output or errors cannot be read;
  - the error of a `Reader` or a `Writer` (see stream errors below), as of a [Buffer](#buffer) past its limit.
  - Of several such failures, the first rejects it.
- It throws a `ValueError` for options that are not valid (below).

### RunOptions

Each option may be left out.

| Option | |
|---|---|
| `stdin: Binary \| Reader \| Pipe?` | What the program reads as its standard input, through a pipe that is closed after it: the bytes, or what a `Reader` of [std:io](#stdio) gives until its end, or a `Pipe` of std:io. Else this program's standard input, which the two share. |
| `stdout: Output \| Writer \| Pipe?`, `stderr: Output \| Writer \| Pipe?` | Where the program's standard output or error goes: `DISCARD`, dropped; for `stderr` alone, `STDOUT`, where the output goes; a `Writer` that it is written to as it comes, such as a [Buffer](#buffer) that keeps it; or a `Pipe` of std:io. Else it is shared with this program. |
| `cwd: String?` | The directory the program runs in; else this program's. |
| `env: Map<String, String>` | Variables set for the program, besides this program's, replacing those of the same names. |
| `unset_env: String[]` | This program's variables that the program is not given. |
| `kill_after = 5.0` | The seconds that a cancel waits for the program to end before it kills it. |

- **A shared stdin.** While a read of `stdin` of std:io waits for input, as one that was cancelled still does until input comes, the read and the program each take a part of what comes.
- **Input.** A program that ends without reading all of its input is no failure, and a write to it that fails ends the input so, whatever the failure.
  - Once the program has started, `run` closes a `Reader` when it reads it no more, so that a `Pipe`'s writer fails then.
  - A program that cannot start leaves the `Reader` as it was, as it does a `Writer`.
- **Output.** `run` ends a `Writer` after the program, however the run ends once the program has started, and returns once the end has finished, so that a file's `writer` holds all of the output then; an end that is rejected fails the run with its error. A cancelled run waits for the ends too. So a run given `stdout` waits for its flush. A `Pipe`'s reader reads its end so too.
  - What reads the output reads its end alike whether the program ended well, failed, was killed or was cancelled; only the `Promise` of `run` tells which.
  - A program that cannot start leaves the `Writer` as it was.
- **Stream errors.** The error of the `Reader` or of a `Writer`, as a read of the program's output that fails, stops the program, and rejects the `Promise` once the program has ended.
  - Why: the program would otherwise go on with an input cut short, or wait for an output read no more.
- **Errors as output.** `stderr: STDOUT` gives the program's errors the very file of its output, as `2>&1` does, so the two are in the order the program writes them: with a `Buffer` as `stdout`, both are in it, and count together toward its `limit`.
- **Both outputs.** One `Writer` may take both outputs, as `2>&1` does. `run` ends the `Writer`s once both outputs have ended, so such a `Writer` is ended twice.
- **A waiting Writer.** A `run` given a `Writer` that waits for its reader, as a socket's does, must not be awaited before that reader reads, or a program that writes more than its pipe holds waits for ever.
- On Windows, the names of variables are compared without case.
- **Invalid options** throw a `ValueError`: `stdout: STDOUT` (`stdout cannot be Output.STDOUT`), a name that is empty or holds `=` or a NUL byte, a name set twice (on Windows, in another case) or both set and removed, and a negative `kill_after`.

### Exit

- `code: Int`: the exit code, which a signal makes 128 plus its number, as shells do.
- `signal: Int?`: that signal, on POSIX systems.
- On Windows, the code of a program that an exception or `TerminateProcess` ended is a non-negative 32-bit value, such as 3221225477 (0xC0000005) for an access violation.

## std:scanner

- A `Scanner` reads a `String` by code points, as a lexer does: it looks at the next one before passing over it, and takes the text of what it has passed over.
- It has no byte offsets, which only `Binary` has (see [String](types.md#string)).
- One that `scan` makes only ever stands at the start of a code point, so what it gives is a `String` without a check.
- `Scanner` is an interface to an object that `scan` makes, whose methods alone see and move where it stands. They are called, not taken as values.

```lerta
import scan from 'std:scanner'

scanner := scan('width = 42')
name := scanner.take_while((c) -> c != ' ')
scanner.take ' = '
print "#{name}: #{scanner.rest()}"
```

| Name | |
|---|---|
| `scan(text: String): Scanner` | A Scanner at the start of the text. |
| `s.done(): Bool` | Whether it has passed over the whole text. |
| `s.peek(): Char?` | The next code point, which it stays before, or nil at the end. |
| `s.next(): Char?` | The next code point, which it passes over, or nil at the end. |
| `s.take(prefix: String): Bool` | Whether what follows starts with `prefix`, which it passes over if it does. Every text starts with `''`. |
| `s.skip_while(test: (Char) -> Bool)` | Passes over the code points that `test` holds for, up to the first that it does not, or to the end. |
| `s.take_while(test: (Char) -> Bool): String` | Likewise, and gives what it passed over, `''` if nothing. |
| `s.mark(): () -> String` | A function that gives what it has passed over since the mark, up to where it stands each time the function is called, so after `rest()` up to the end. |
| `s.rest(): String` | What is left, which it passes over, `''` at the end. |

## std:time

| Name | |
|---|---|
| `sleep(seconds: Float): Promise` | A promise that is resolved once at least the seconds have passed, for a [function that awaits](functions.md#functions-that-await) to wait for. A time of zero only lets other work run first. Throws a `ValueError`, `sleep for a negative time`, for a negative time. |
| `time(): Float` | The seconds since the Unix epoch, 1970-01-01T00:00:00Z, with their fraction, as the system's clock tells them. It may go back if the clock is set back. |
| `monotonic(): Float` | The seconds, with their fraction, since a time that is not specified, as a clock that only goes forward tells them, which a setting of the system's clock does not move: what a time that has passed is measured by. |
| `utc_offset(at: Float = time()): Int` | The seconds that local time is ahead of UTC at a time, given as `time` gives it (below). |

### utc_offset

- Local time is as the `TZ` environment variable sets it, or else as the system does. It is read at each call.
  - A zone by its offset and the name of its summer time, as `JST-9` or `EST5EDT`, is read on every system.
  - A zone by its name, as `America/New_York`, only on POSIX systems; Windows reads only the form above.
- The offset is that of the time: one of summer time where it is in use, as New York's `-14400` in July and `-18000` in January.
- The time is taken to the whole second that holds it, rounded down.
- Throws a `ValueError`, `no UTC offset for the time <at>`, for a time that the system cannot convert: an infinity, or one too far from the epoch. On Windows, that is any time before 1970 or after 3000.
