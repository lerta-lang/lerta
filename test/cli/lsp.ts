// `lerta lsp`: each check sends messages on stdin, as an editor would, and checks the messages that
// the server writes back on stdout and how it exits.
import { closeSync, mkdirSync, mkdtempSync, openSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { compiler } from '../lerta.ts'
import { compare_text, expect_status } from '../expect.ts'
import type { Check } from '../report.ts'
import { run_command, work_dir } from './common.ts'

export type Message = Record<string, unknown>

const framed = (messages: Message[]): string =>
  messages
    .map((message) => {
      const body = JSON.stringify({ jsonrpc: '2.0', ...message })
      return `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`
    })
    .join('')

// The messages in the server's output, each after its header.
const unframed = (output: string): Message[] => {
  const messages: Message[] = []
  let rest = Buffer.from(output)
  while (rest.length > 0) {
    const header_end = rest.indexOf('\r\n\r\n')
    const length = Number(/Content-Length: (\d+)/.exec(rest.subarray(0, header_end).toString())![1])
    const start = header_end + 4
    messages.push(JSON.parse(rest.subarray(start, start + length).toString()))
    rest = rest.subarray(start + length)
  }
  return messages
}

// Runs the server on the messages, after an initialize of the client's capabilities and before
// a shutdown, unless `shuts_down` is false, and an exit, in a directory of the files given, by
// their paths in it; `messages` takes the URIs of the files. `raw` is input as it is, between
// those messages and the shutdown.
export const session = async (
  files: Record<string, string>,
  messages: (uri: (name: string) => string) => Message[],
  options: { capabilities?: Message; shuts_down?: boolean; raw?: string } = {},
) => {
  const dir = realpathSync(mkdtempSync(join(work_dir, 'lsp-')))
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), text)
  }
  const uri = (name: string) => pathToFileURL(join(dir, name)).href
  const shutdown = options.shuts_down === false ? [] : [{ id: 'end', method: 'shutdown' }]
  const input = join(dir, 'input')
  const before = framed([initialize(options.capabilities), ...messages(uri)])
  writeFileSync(input, before + (options.raw ?? '') + framed([...shutdown, { method: 'exit' }]))
  const stdin = openSync(input, 'r')
  const ran = await run_command(compiler, ['lsp'], { cwd: dir, stdio: [stdin, 'pipe', 'pipe'] })
  closeSync(stdin)
  return { ...ran, received: unframed(ran.stdout), uri }
}

const initialize = (capabilities: Message = {}): Message => ({
  id: 0,
  method: 'initialize',
  params: { capabilities },
})

export const open = (uri: string, text: string): Message => ({
  method: 'textDocument/didOpen',
  params: { textDocument: { uri, languageId: 'lerta', version: 1, text } },
})

export const change = (uri: string, text: string): Message => ({
  method: 'textDocument/didChange',
  params: { textDocument: { uri, version: 2 }, contentChanges: [{ text }] },
})

const point = (line: number, character: number) => {
  const at = { line, character }
  return { start: at, end: at }
}

const diagnostic = (line: number, character: number, severity: number, message: string) => ({
  range: point(line, character),
  severity,
  source: 'lerta',
  message,
})

const published = (uri: string, diagnostics: unknown[]): Message => ({
  jsonrpc: '2.0',
  method: 'textDocument/publishDiagnostics',
  params: { uri, diagnostics },
})

export const response = (id: unknown, result: unknown): Message => ({ jsonrpc: '2.0', id, result })

const capabilities = (encoding: string) => ({
  capabilities: {
    positionEncoding: encoding,
    textDocumentSync: 1,
    documentFormattingProvider: true,
    hoverProvider: true,
    definitionProvider: true,
    completionProvider: { triggerCharacters: ['.'] },
  },
  serverInfo: { name: 'lerta' },
})

// The messages received, as JSON lines, against those expected.
export const expect_received = (expected: Message[], received: Message[]): string[] => {
  const as_lines = (messages: Message[]) => messages.map((each) => `${JSON.stringify(each)}\n`)
  return compare_text('messages', as_lines(expected).join(''), as_lines(received).join(''))
}

// Those after the response to initialize.
export const after_initialize = (received: Message[]): Message[] =>
  received.filter((message) => message.id !== 0)

const end = response('end', null)

export const lsp_checks: Check[] = [
  {
    name: 'lerta lsp takes UTF-32 positions when the client does, and UTF-16 otherwise',
    run: async () => {
      const defaults = await session({}, () => [])
      const general = { general: { positionEncodings: ['utf-16', 'utf-32'] } }
      // An exit without a shutdown before it is an error.
      const utf32 = await session({}, () => [], { capabilities: general, shuts_down: false })
      return [
        ...expect_received([response(0, capabilities('utf-16'))], defaults.received.slice(0, 1)),
        ...expect_received([response(0, capabilities('utf-32'))], utf32.received),
        ...expect_status(0, defaults.status),
        ...expect_status(1, utf32.status),
      ]
    },
  },
  {
    name: 'lerta lsp publishes the errors and warnings of a document, and clears them when gone',
    run: async () => {
      const ran = await session({ 'a.lerta': '' }, (uri) => [
        open(uri('a.lerta'), 'print missing\n'),
        change(uri('a.lerta'), 'const unused = 1\n'),
        change(uri('a.lerta'), 'print 1\n'),
        { method: 'textDocument/didClose', params: { textDocument: { uri: uri('a.lerta') } } },
      ])
      const a = ran.uri('a.lerta')
      // Unused names are warned about only once the program has no errors.
      const expected = [
        published(a, [diagnostic(0, 6, 1, "undefined name 'missing'")]),
        published(a, [diagnostic(0, 6, 2, "'unused' is never used")]),
        published(a, []),
        published(a, []),
        end,
      ]
      return [
        ...expect_received(expected, after_initialize(ran.received)),
        ...expect_status(0, ran.status),
      ]
    },
  },
  {
    name: 'lerta lsp publishes the errors of an imported file for that file, in UTF-16 units',
    run: async () => {
      const files = { 'a.lerta': '', 'b.lerta': "export const b = '😀' + nothing\n" }
      const ran = await session(files, (uri) => [
        open(uri('a.lerta'), "import b from './b'\nprint b\n"),
      ])
      // `nothing` comes after 23 code points, the emoji among them, which takes two UTF-16 units.
      const expected = [
        published(ran.uri('a.lerta'), []),
        published(ran.uri('b.lerta'), [diagnostic(0, 24, 1, "undefined name 'nothing'")]),
        end,
      ]
      return expect_received(expected, after_initialize(ran.received))
    },
  },
  {
    name: 'lerta lsp formats a document as lerta fmt --fix writes it',
    run: async () => {
      const ran = await session({ 'a.lerta': '' }, (uri) => [
        open(uri('a.lerta'), 'const  x = 1\nprint x\n'),
        {
          id: 1,
          method: 'textDocument/formatting',
          params: { textDocument: { uri: uri('a.lerta') } },
        },
        change(uri('a.lerta'), 'const x = 1\nprint x\n'),
        {
          id: 2,
          method: 'textDocument/formatting',
          params: { textDocument: { uri: uri('a.lerta') } },
        },
        change(uri('a.lerta'), 'print (\n'),
        {
          id: 3,
          method: 'textDocument/formatting',
          params: { textDocument: { uri: uri('a.lerta') } },
        },
      ])
      // To the end of the last line, the empty one after the final newline.
      const whole = { start: { line: 0, character: 0 }, end: { line: 2, character: 0 } }
      const formatted = ran.received.filter((message) => [1, 2, 3].includes(message.id as number))
      const expected = [
        response(1, [{ range: whole, newText: 'const x = 1\nprint x\n' }]),
        response(2, []),
        response(3, null),
      ]
      return expect_received(expected, formatted)
    },
  },
  {
    name: 'lerta lsp answers a request of another method with an error, and ignores a notification',
    run: async () => {
      const ran = await session({}, () => [
        { id: 1, method: 'textDocument/references', params: {} },
        { method: '$/setTrace', params: { value: 'off' } },
        { id: 2, method: 'textDocument/formatting', params: {} },
      ])
      const expected = [
        {
          jsonrpc: '2.0',
          id: 1,
          error: { code: -32601, message: 'no method textDocument/references' },
        },
        {
          jsonrpc: '2.0',
          id: 2,
          error: { code: -32602, message: '$.params: missing the key "textDocument"' },
        },
        end,
      ]
      return expect_received(expected, after_initialize(ran.received))
    },
  },
  {
    name: 'lerta lsp answers a message that is not JSON as a parse error, and goes on',
    run: async () => {
      const body = '{bad}'
      const ran = await session({}, () => [], {
        raw: `Content-Length: ${body.length}\r\n\r\n${body}`,
      })
      const expected = [
        {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: "$: expected a key, found 'b'" },
        },
        end,
      ]
      return [
        ...expect_received(expected, after_initialize(ran.received)),
        ...expect_status(0, ran.status),
      ]
    },
  },
  {
    name: 'lerta lsp ends at a header that gives no length, as the next message cannot be found',
    run: async () => {
      const ran = await session({}, () => [], { raw: 'Content-Length: x\r\n\r\n{}' })
      return [
        ...compare_text('stderr', 'an LSP message without its Content-Length\n', ran.stderr),
        ...expect_status(1, ran.status),
      ]
    },
  },
  {
    name: 'lerta lsp publishes a file that open documents share by what all their checks find',
    run: async () => {
      const files = {
        'b.lerta': "export const b: Int = 'text'\n",
        'c.lerta': '',
        'd.lerta': '',
      }
      const imports = "import b from './b'\nprint b\n"
      const ran = await session(files, (uri) => [
        open(uri('c.lerta'), imports),
        open(uri('d.lerta'), imports),
        { method: 'textDocument/didClose', params: { textDocument: { uri: uri('c.lerta') } } },
      ])
      const b = published(ran.uri('b.lerta'), [diagnostic(0, 22, 1, 'expected Int, got String')])
      // Closing c leaves b's error, which d's check still finds; c itself is cleared.
      const expected = [
        published(ran.uri('c.lerta'), []),
        b,
        published(ran.uri('d.lerta'), []),
        b,
        published(ran.uri('c.lerta'), []),
        b,
        end,
      ]
      return expect_received(expected, after_initialize(ran.received))
    },
  },
  {
    name: 'lerta lsp checks again the open documents that import a document that changes',
    run: async () => {
      const files = { 'a.lerta': '', 'b.lerta': '' }
      const ran = await session(files, (uri) => [
        open(uri('b.lerta'), "export const b = 'text'\n"),
        open(uri('a.lerta'), "import b from './b'\nprint b\n"),
        change(uri('b.lerta'), 'export const c = 1\n'),
      ])
      const a = ran.uri('a.lerta')
      const b = ran.uri('b.lerta')
      const missing = diagnostic(0, 7, 1, "'./b' has no export 'b'")
      // b is checked on its own, then again as a's import, which a's check finds wrong now.
      const expected = [
        published(b, []),
        published(a, []),
        published(b, []),
        published(b, []),
        published(a, [missing]),
        published(b, []),
        end,
      ]
      return expect_received(expected, after_initialize(ran.received))
    },
  },
  {
    name: 'lerta lsp takes percent-encoded URIs and imports through ../, and ignores other URIs',
    run: async () => {
      const files = { 'a b/é.lerta': '', 'lib.lerta': 'export const x = missing\n' }
      const ran = await session(files, (uri) => [
        open(uri('a b/é.lerta'), "import x from '../lib'\nprint x\n"),
        open('untitled:Untitled-1', 'print 1\n'),
        {
          id: 1,
          method: 'textDocument/formatting',
          params: { textDocument: { uri: uri('lib.lerta') } },
        },
      ])
      const expected = [
        published(ran.uri('a b/é.lerta'), []),
        published(ran.uri('lib.lerta'), [diagnostic(0, 17, 1, "undefined name 'missing'")]),
        // A document that is not open is not formatted.
        response(1, null),
        end,
      ]
      return expect_received(expected, after_initialize(ran.received))
    },
  },
  {
    name: 'lerta lsp formats a document that is no file yet, to the end of its last line',
    run: async () => {
      const ran = await session({}, (uri) => [
        open(uri('new.lerta'), "print  '😀'"),
        {
          id: 1,
          method: 'textDocument/formatting',
          params: { textDocument: { uri: uri('new.lerta') } },
        },
      ])
      // Nothing is checked, as no program holds a file that is not there; the emoji takes two units.
      const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 11 } }
      const expected = [response(1, [{ range, newText: "print '😀'\n" }]), end]
      return expect_received(expected, after_initialize(ran.received))
    },
  },
  {
    name: 'lerta lsp checks again the importers of a document closed unsaved, from its file',
    run: async () => {
      const files = { 'a.lerta': '', 'b.lerta': 'export const f = -> 1\n' }
      const ran = await session(files, (uri) => [
        open(uri('a.lerta'), "import f from './b'\nprint f()\n"),
        open(uri('b.lerta'), 'export const f = -> 1\n'),
        change(uri('b.lerta'), 'export const f = -> zzz\n'),
        { method: 'textDocument/didClose', params: { textDocument: { uri: uri('b.lerta') } } },
      ])
      const b = ran.uri('b.lerta')
      const closed = after_initialize(ran.received).slice(-2)
      return expect_received([published(b, []), end], closed)
    },
  },
  {
    name: 'lerta lsp answers an empty body, as of a length of 0 or below, as a parse error, and ignores a notification it cannot read',
    run: async () => {
      const ran = await session(
        { 'a.lerta': '' },
        (uri) => [
          { method: 'textDocument/didOpen', params: { textDocument: { uri: 1 } } },
          {
            method: 'textDocument/didChange',
            params: { textDocument: { uri: uri('a.lerta') }, contentChanges: [] },
          },
        ],
        { raw: 'Content-Length: 0\r\n\r\nContent-Length: -1\r\n\r\n' },
      )
      const empty = {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: '$: expected an object, found the end of the text' },
      }
      // A length below 1 is an empty body too.
      const expected = [empty, empty, end]
      return expect_received(expected, after_initialize(ran.received))
    },
  },
  {
    name: 'lerta lsp takes no arguments',
    run: async () => {
      const ran = await run_command(compiler, ['lsp', 'extra'])
      return [
        ...compare_text('stderr', 'lerta lsp takes no arguments\n', ran.stderr),
        ...expect_status(1, ran.status),
      ]
    },
  },
  {
    name: 'lerta lsp gives the types of a name, one for each instance, and where it is declared',
    run: async () => {
      const files = {
        'lib.lerta':
          'export struct Point(x: Int, y: Int)\nexport const make = (x: Int) -> Point(x, y: 0)\n',
        'a.lerta': '',
      }
      const text = [
        "import make from './lib'",
        'const p = make(1)',
        'print p.x',
        'const id = <T>(v: T) -> v',
        'print id(1) + id(2)',
        "print id('a')",
        '',
      ].join('\n')
      const at = (line: number, character: number, id: number, method: string) => ({
        id,
        method: `textDocument/${method}`,
        params: { textDocument: { uri: '' }, position: { line, character } },
      })
      const asks: [number, number][] = [
        [1, 10],
        [2, 8],
        [3, 24],
        [4, 6],
        [5, 6],
        [0, 7],
        [1, 4],
      ]
      const ran = await session(files, (uri) => [
        open(uri('a.lerta'), text),
        ...asks.flatMap(([line, character], i) =>
          ['hover', 'definition'].map((method, j) => {
            const message = at(line, character, 10 + 2 * i + j, method)
            ;(message.params.textDocument as { uri: string }).uri = uri('a.lerta')
            return message
          }),
        ),
      ])
      const hover = (...lines: string[]) => ({
        contents: { kind: 'markdown', value: ['```lerta', ...lines, '```'].join('\n') },
      })
      const location = (name: string, line: number, start: number, end: number) => ({
        uri: ran.uri(name),
        range: { start: { line, character: start }, end: { line, character: end } },
      })
      const expected = [
        // make, a function of another module
        response(10, hover('make: (Int) -> Point')),
        response(11, location('lib.lerta', 1, 13, 17)),
        // x, a field
        response(12, hover('x: Int')),
        response(13, location('lib.lerta', 0, 20, 21)),
        // v, in a generic body, of each instance
        response(14, hover('v: Int', 'v: String')),
        response(15, location('a.lerta', 3, 15, 16)),
        // id, a generic function, as each call instantiates it
        response(16, hover('id: (Int) -> Int')),
        response(17, location('a.lerta', 3, 6, 8)),
        response(18, hover('id: (String) -> String')),
        response(19, location('a.lerta', 3, 6, 8)),
        // make, as imported, which only goes to its declaration
        response(20, null),
        response(21, location('lib.lerta', 1, 13, 17)),
        // no name
        response(22, null),
        response(23, null),
      ]
      const answers = ran.received.filter(
        (message) => typeof message.id === 'number' && message.id >= 10,
      )
      return expect_received(expected, answers)
    },
  },
  {
    name: 'lerta lsp finds locals, assigned ones, methods, types, values and generic classes, in UTF-16 units',
    run: async () => {
      const text = [
        "const s = '😀'",
        'struct Box<T>(value: T)',
        'extend Int',
        '  twice = -> @ * 2',
        'var n = 1',
        'n = Box(value: 2).value.twice()',
        'print s + n.to_string()',
        "print '😀' + s",
        '',
      ].join('\n')
      // [line, character], each asked for its hover and its definition.
      const asks: [number, number][] = [
        [6, 6],
        [5, 0],
        [5, 6],
        [5, 18],
        [5, 26],
        [7, 13],
        [7, 14],
        [6, 15],
      ]
      const ran = await session({ 'a.lerta': '' }, (uri) => [
        open(uri('a.lerta'), text),
        ...asks.flatMap(([line, character], i) =>
          ['hover', 'definition'].map((method, j) => ({
            id: 10 + 2 * i + j,
            method: `textDocument/${method}`,
            params: { textDocument: { uri: uri('a.lerta') }, position: { line, character } },
          })),
        ),
      ])
      const hover = (...lines: string[]) => ({
        contents: { kind: 'markdown', value: ['```lerta', ...lines, '```'].join('\n') },
      })
      const here = (line: number, start: number, end: number) => ({
        uri: ran.uri('a.lerta'),
        range: { start: { line, character: start }, end: { line, character: end } },
      })
      const expected = [
        // s, a top-level value
        response(10, hover('s: String')),
        response(11, here(0, 6, 7)),
        // n, as assigned
        response(12, hover('n: Int')),
        response(13, here(4, 4, 5)),
        // Box, a generic struct, as the construction that the call makes
        response(14, hover('Box: Box<Int>')),
        response(15, here(1, 7, 10)),
        // value, a field of an instance
        response(16, hover('value: Int')),
        response(17, here(1, 14, 19)),
        // twice, a method of an extend
        response(18, hover('twice: () -> Int')),
        response(19, here(3, 2, 7)),
        // s after an emoji, two UTF-16 units, and the column right after it
        response(20, hover('s: String')),
        response(21, here(0, 6, 7)),
        response(22, hover('s: String')),
        response(23, here(0, 6, 7)),
        // to_string, a method of std:builtins, whose declaration is in no file
        response(24, hover('to_string: () -> String')),
        response(25, null),
      ]
      const answers = ran.received.filter(
        (message) => typeof message.id === 'number' && message.id >= 10,
      )
      return expect_received(expected, answers)
    },
  },
  {
    name: 'lerta lsp answers about an open file from the program of an open document that imports it',
    run: async () => {
      const b_text = 'export const b = 1\n'
      const files = { 'a.lerta': '', 'b.lerta': b_text }
      const ran = await session(files, (uri) => [
        open(uri('a.lerta'), "import b from './b'\nprint b\n"),
        // b has a program of its own once it is opened, which is checked first; then a's is asked.
        {
          id: 10,
          method: 'textDocument/hover',
          params: { textDocument: { uri: uri('b.lerta') }, position: { line: 0, character: 13 } },
        },
        open(uri('b.lerta'), b_text),
        { method: 'textDocument/didClose', params: { textDocument: { uri: uri('a.lerta') } } },
        {
          id: 11,
          method: 'textDocument/hover',
          params: { textDocument: { uri: uri('a.lerta') }, position: { line: 1, character: 6 } },
        },
      ])
      const hover = { contents: { kind: 'markdown', value: '```lerta\nb: Int\n```' } }
      const expected = [response(10, hover), response(11, null)]
      const answers = ran.received.filter((message) => message.id === 10 || message.id === 11)
      return expect_received(expected, answers)
    },
  },
  {
    name: 'lerta lsp finds a field through ?., @ and an interpolation, and nothing past a line or in a document not open',
    run: async () => {
      const text = [
        'struct P(x: Int)',
        'const f = (p: P?) -> p?.x',
        'class C',
        '  x: Int = 1',
        '  get = -> @x',
        'print C().get()',
        'print f(nil) == nil',
        'print "#{C().x}"',
        'const g = (p: P?) -> p?.x.to_string()',
        'const to_string_value = 1',
        'print "#{to_string_value}"',
        '',
      ].join('\n')
      const asks: [string, number, number][] = [
        ['a.lerta', 7, 13],
        ['a.lerta', 7, 15],
        ['a.lerta', 8, 28],
        ['a.lerta', 10, 10],
        ['a.lerta', 1, 24],
        ['a.lerta', 4, 12],
        ['a.lerta', 5, 40],
        ['a.lerta', 30, 0],
        ['other.lerta', 0, 0],
      ]
      const ran = await session({ 'a.lerta': '' }, (uri) => [
        open(uri('a.lerta'), text),
        ...asks.flatMap(([file, line, character], i) =>
          ['hover', 'definition'].map((method, j) => ({
            id: 10 + 2 * i + j,
            method: `textDocument/${method}`,
            params: { textDocument: { uri: uri(file) }, position: { line, character } },
          })),
        ),
      ])
      const x = { contents: { kind: 'markdown', value: '```lerta\nx: Int\n```' } }
      const here = (line: number, start: number, end: number) => ({
        uri: ran.uri('a.lerta'),
        range: { start: { line, character: start }, end: { line, character: end } },
      })
      const to_string = {
        contents: { kind: 'markdown', value: '```lerta\nto_string: () -> String\n```' },
      }
      const expected = [
        // In an interpolation, only the field, not the to_string that it calls, there or after it
        response(10, x),
        response(11, here(3, 2, 3)),
        response(12, null),
        response(13, null),
        // A method through ?., which is in std:builtins
        response(14, to_string),
        response(15, null),
        // A name that the to_string of its interpolation's name starts as
        response(16, {
          contents: { kind: 'markdown', value: '```lerta\nto_string_value: Int\n```' },
        }),
        response(17, here(9, 6, 21)),
        // Only the field, not the name that the parser makes of `p?`
        response(18, x),
        response(19, here(0, 9, 10)),
        response(20, x),
        response(21, here(3, 2, 3)),
        ...[22, 23, 24, 25, 26, 27].map((id) => response(id, null)),
      ]
      const answers = ran.received.filter(
        (message) => typeof message.id === 'number' && message.id >= 10,
      )
      return expect_received(expected, answers)
    },
  },
  {
    name: 'lerta lsp goes to assigned fields, members of enums, catch variables and if const bindings',
    run: async () => {
      const text = [
        "import Shade from './shades'",
        'class K',
        '  v: Int = 1',
        '  inc = -> @v += 1',
        'const k = K()',
        'k.v = 3',
        'enum Color',
        '  RED',
        'const c = Color.RED',
        'const found: Int? = 1',
        'if const n = found',
        '  print n',
        'try',
        "  throw ValueError(message: 'x')",
        'catch error',
        '  print error.message',
        'k.inc()',
        'print c',
        'extend K',
        '  reset = -> @v = 0',
        'k.reset()',
        'print Shade.DARK',
        '',
      ].join('\n')
      const asks: [number, number][] = [
        [5, 2],
        [3, 12],
        [8, 16],
        [11, 8],
        [15, 8],
        [19, 15],
        [20, 2],
        [16, 2],
        [21, 12],
      ]
      const files = { 'a.lerta': '', 'shades.lerta': 'export enum Shade\n  LIGHT\n  DARK\n' }
      const ran = await session(files, (uri) => [
        open(uri('a.lerta'), text),
        ...asks.map(([line, character], i) => ({
          id: 10 + i,
          method: 'textDocument/definition',
          params: { textDocument: { uri: uri('a.lerta') }, position: { line, character } },
        })),
      ])
      const here = (line: number, start: number, end: number) => ({
        uri: ran.uri('a.lerta'),
        range: { start: { line, character: start }, end: { line, character: end } },
      })
      const expected = [
        // An assigned field, through an object and through @ in two ways
        response(10, here(2, 2, 3)),
        response(11, here(2, 2, 3)),
        // A member of an enum, of this module and of an imported one
        response(12, here(7, 2, 5)),
        // An if const binding and a catch variable
        response(13, here(10, 9, 10)),
        response(14, here(14, 6, 11)),
        response(15, here(2, 2, 3)),
        // A method of an extend and one of the class
        response(16, here(19, 2, 7)),
        response(17, here(3, 2, 5)),
        response(18, {
          uri: ran.uri('shades.lerta'),
          range: { start: { line: 2, character: 2 }, end: { line: 2, character: 6 } },
        }),
      ]
      const answers = ran.received.filter(
        (message) => typeof message.id === 'number' && message.id >= 10,
      )
      return expect_received(expected, answers)
    },
  },
  {
    name: 'lerta lsp finds names after an error, destructured, for and captured locals, and none where loading fails',
    run: async () => {
      const text = [
        'const n = [1].length',
        'print n + zz',
        'const q = 2',
        'print q',
        'const (a, b) = (1, 2)',
        'for item in [a]',
        '  print item + b',
        'const add = (x: Int) -> -> x + 1',
        'print add(1)()',
        '',
      ].join('\n')
      const asks: [number, number][] = [
        [3, 6],
        [6, 8],
        [6, 15],
        [7, 27],
      ]
      const ran = await session({ 'a.lerta': '' }, (uri) => [
        open(uri('a.lerta'), text),
        ...asks.map(([line, character], i) => ({
          id: 10 + i,
          method: 'textDocument/definition',
          params: { textDocument: { uri: uri('a.lerta') }, position: { line, character } },
        })),
        // The name of the last check's program at the same place, which a kept program would answer for
        change(uri('a.lerta'), "import x from './missing'\nprint n + zz\n"),
        {
          id: 20,
          method: 'textDocument/hover',
          params: { textDocument: { uri: uri('a.lerta') }, position: { line: 1, character: 6 } },
        },
      ])
      const here = (line: number, start: number, end: number) => ({
        uri: ran.uri('a.lerta'),
        range: { start: { line, character: start }, end: { line, character: end } },
      })
      const expected = [
        // q, after the error of zz
        response(10, here(2, 6, 7)),
        // item, of a for, and b, destructured
        response(11, here(5, 4, 8)),
        response(12, here(4, 10, 11)),
        // x, captured by the inner function
        response(13, here(7, 13, 14)),
        // No program, as its modules cannot be loaded (check), and none of the last check
        response(20, null),
      ]
      const answers = ran.received.filter(
        (message) => typeof message.id === 'number' && message.id >= 10,
      )
      return expect_received(expected, answers)
    },
  },
]
