// `lerta lsp`: each check sends messages on stdin, as an editor would, and checks the messages that
// the server writes back on stdout and how it exits.
import { closeSync, mkdirSync, mkdtempSync, openSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { compiler } from '../lerta.ts'
import { compare_text, expect_status } from '../expect.ts'
import type { Check } from '../report.ts'
import { run_command, work_dir } from './common.ts'

type Message = Record<string, unknown>

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
const session = async (
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

const open = (uri: string, text: string): Message => ({
  method: 'textDocument/didOpen',
  params: { textDocument: { uri, languageId: 'lerta', version: 1, text } },
})

const change = (uri: string, text: string): Message => ({
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

const response = (id: unknown, result: unknown): Message => ({ jsonrpc: '2.0', id, result })

const capabilities = (encoding: string) => ({
  capabilities: {
    positionEncoding: encoding,
    textDocumentSync: 1,
    documentFormattingProvider: true,
  },
  serverInfo: { name: 'lerta' },
})

// The messages received, as JSON lines, against those expected.
const expect_received = (expected: Message[], received: Message[]): string[] => {
  const as_lines = (messages: Message[]) => messages.map((each) => `${JSON.stringify(each)}\n`)
  return compare_text('messages', as_lines(expected).join(''), as_lines(received).join(''))
}

// Those after the response to initialize.
const after_initialize = (received: Message[]): Message[] =>
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
        { id: 1, method: 'textDocument/hover', params: {} },
        { method: '$/setTrace', params: { value: 'off' } },
        { id: 2, method: 'textDocument/formatting', params: {} },
      ])
      const expected = [
        { jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'no method textDocument/hover' } },
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
]
