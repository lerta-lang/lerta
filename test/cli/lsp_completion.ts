// The completion of `lerta lsp`: what it offers where a name is being written (see cli/lsp.ts for
// how a check runs the server).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { root_dir } from '../lerta.ts'
import type { Check } from '../report.ts'
import { compare_text } from '../expect.ts'
import { after_initialize, change, open, session, type Message } from './lsp.ts'

type Item = { label: string; kind: number; detail: string | null }

const KEYWORD = 14

// The keywords of TokenKind in compiler/lexer/tokens.lerta, its members that are words in quotes.
const keywords = (() => {
  const source = readFileSync(join(root_dir, 'compiler/lexer/tokens.lerta'), 'utf8')
  const kinds = source.slice(source.indexOf('export enum TokenKind'))
  const members = kinds.slice(0, kinds.indexOf('\n\n'))
  return [...members.matchAll(/^  '([a-z]+)'$/gm)].map((match) => match[1])
})()

// The text of the document, with a line where completion is asked written in place of `HERE`.
const text = (here: string) =>
  [
    "import './m' as m",
    'struct Point(x: Int, y: Int)',
    'struct Named(m: Int, Color: Int)',
    'class Counter',
    '  count = 0',
    '  bump = -> @count += 1',
    '  same = <T>(v: T) -> v',
    'interface Shape',
    '  area: () -> Int',
    '  name: String',
    'enum Color',
    '  RED',
    'extend Point',
    '  sum = -> @x + @y',
    'const _hidden = 1',
    'const total = 1',
    'const f = (p: Point, shape: Shape, r: { a: Int }, c: Counter, count: Int, n: Named) ->',
    '  const local = 1',
    '  if true',
    "    const local = 'shadowing'",
    here,
    '  const later = 2',
    '  print local',
    '',
  ].join('\n')

const m_text = 'export const helper = -> 1\nexport enum Shade\n  DARK\nconst private_one = 2\n'

// One case: the line written where completion is asked, the character asked at, and what the
// labels must be, in their order, the keywords left out, or hold; and whether the keywords are
// offered, which they are only where names are.
type Case = {
  here: string
  character: number
  labels?: string[]
  holds?: string[]
  lacks?: string[]
  keywords?: boolean
}

const cases: Case[] = [
  // A struct's fields, its builtin methods and the method of an extend in effect, before a name too
  { here: '    print p.', character: 12, labels: ['x', 'y', 'equals', 'hash', 'sum'] },
  { here: '    print p.x', character: 12, labels: ['x', 'y', 'equals', 'hash', 'sum'] },
  // A class's fields and methods, its generic one among them
  { here: '    print c.', character: 12, holds: ['count', 'bump', 'same'] },
  // An interface value's members, and an anonymous struct's fields
  { here: '    print shape.', character: 16, labels: ['area', 'name'] },
  { here: '    print r.', character: 12, holds: ['a'] },
  // An enum's members, and the exports of a module, but no other name of it
  { here: '    print Color.', character: 16, labels: ['RED', 'parse'] },
  { here: '    print m.', character: 12, labels: ['helper', 'Shade'] },
  // An array's builtin members and the methods of the extends of arrays
  { here: '    print [1].', character: 14, holds: ['length', 'push', 'pop', 'first', 'contains'] },
  // The names that the code sees: the locals in scope, the innermost of a name and none declared
  // later, the module's names, with one starting with _, which is no less seen, but no interface,
  // which is no value, imports and std:builtins' exports
  {
    here: '    print lo',
    keywords: true,
    character: 12,
    holds: [
      '_hidden',
      'local',
      'p',
      'count',
      'total',
      'f',
      'Point',
      'Counter',
      'Color',
      'm',
      'print',
      'min',
    ],
    lacks: ['later', '__lerta_completion__', 'Point.sum', 'Shape', 'Stringable'],
  },
  // After a character above U+FFFF on the line, which takes two UTF-16 units
  { here: "    print '😀' + tot", character: 20, holds: ['total'], keywords: true },
  // An enum of a module
  { here: '    print m.Shade.', character: 18, labels: ['DARK', 'parse'] },
  // A field named as a module or an enum is a field
  { here: '    print n.m.', character: 14, holds: ['to_string', 'compare'], lacks: ['helper'] },
  { here: '    print n.Color.', character: 18, holds: ['to_string'], lacks: ['RED'] },
  { here: '    print 1 # m.', character: 16, labels: [] },
  // Nothing in a comment, which the checker does not meet
  { here: '    # tot', character: 9, labels: [] },
]

const ask = (id: number, uri: string, character: number, here: string): Message[] => [
  change(uri, text(here)),
  {
    id,
    method: 'textDocument/completion',
    params: { textDocument: { uri }, position: { line: 20, character } },
  },
]

const why = (each: Case, items: Item[]): string[] => {
  const words = items.filter((item) => item.kind === KEYWORD)
  // The keywords where names are offered, all of TokenKind's, and none where members are.
  const expected_words = each.keywords ? keywords : []
  if (
    words.map((item) => `${item.label} ${item.detail}`).join(' ') !==
    expected_words.map((word) => `${word} null`).join(' ')
  ) {
    return [
      `keywords of ${JSON.stringify(each.here)}: ${words.map((item) => item.label).join(' ')}`,
    ]
  }
  const labels = items.filter((item) => item.kind !== KEYWORD).map((item) => item.label)
  const shown = `${JSON.stringify(each.here)}: ${labels.join(' ')}`
  const reasons: string[] = []
  if (each.labels && each.labels.join(' ') !== labels.join(' ')) reasons.push(`labels of ${shown}`)
  for (const label of each.holds ?? []) {
    if (!labels.includes(label)) reasons.push(`no ${label} in ${shown}`)
  }
  for (const label of each.lacks ?? []) {
    if (labels.includes(label)) reasons.push(`${label} in ${shown}`)
  }
  if (new Set(labels).size !== labels.length) reasons.push(`a label twice in ${shown}`)
  return reasons
}

export const lsp_completion_checks: Check[] = [
  {
    name: 'lerta lsp completes the members of a value, an enum and a module, and the names that code sees',
    run: async () => {
      const files = { 'a.lerta': text('    print local'), 'm.lerta': m_text }
      const ran = await session(files, (uri) => [
        open(uri('a.lerta'), text('    print local')),
        ...cases.flatMap((each, i) => ask(10 + i, uri('a.lerta'), each.character, each.here)),
      ])
      const answers = after_initialize(ran.received).filter(
        (message) => typeof message.id === 'number',
      )
      return cases.flatMap((each, i) => {
        const answer = answers.find((message) => message.id === 10 + i)
        return answer ? why(each, answer.result as Item[]) : [`no answer to ${each.here}`]
      })
    },
  },
  {
    name: 'lerta lsp gives completion items their kinds and types, and leaves the open text as it was, which formatting then reads',
    run: async () => {
      const ran = await session(
        { 'a.lerta': text('    print local'), 'm.lerta': m_text },
        (uri) => [
          open(uri('a.lerta'), text('    print local')),
          ...ask(10, uri('a.lerta'), 12, '    print p.'),
          // Two spaces, which formatting then takes out
          ...ask(11, uri('a.lerta'), 13, '    print  lo'),
          // A completion of a document that is not open gives nothing.
          {
            id: 12,
            method: 'textDocument/completion',
            params: {
              textDocument: { uri: uri('other.lerta') },
              position: { line: 0, character: 0 },
            },
          },
          // A formatting after the completions writes the document's own text, not the probe's.
          {
            id: 13,
            method: 'textDocument/formatting',
            params: { textDocument: { uri: uri('a.lerta') } },
          },
        ],
      )
      const answers = after_initialize(ran.received)
      const result = (id: number) => answers.find((message) => message.id === id)?.result
      const members = result(10) as Item[]
      const names = result(11) as Item[]
      const kinds = (labels: string[], items: Item[]) =>
        labels.map((label) => {
          const item = items.find((each) => each.label === label)
          return `${label} ${item?.kind} ${item?.detail}`
        })
      const published = answers.filter(
        (message) => message.method === 'textDocument/publishDiagnostics',
      )
      const leaked = published.some((message) =>
        JSON.stringify(message).includes('__lerta_completion__'),
      )
      return [
        ...compare_text(
          'member kinds',
          ['x 5 Int', 'equals 2 (Point) -> Bool', 'sum 2 null'].join('\n'),
          kinds(['x', 'equals', 'sum'], members).join('\n'),
        ),
        ...compare_text(
          'name kinds',
          [
            'local 6 String',
            // Its type is unknown, as its body is not checked past the probe.
            'f 3 null',
            'Point 22 null',
            'Counter 7 null',
            'Color 13 null',
            'const 14 null',
          ].join('\n'),
          kinds(['local', 'f', 'Point', 'Counter', 'Color', 'const'], names).join('\n'),
        ),
        ...compare_text('not open', '[]', JSON.stringify(result(12))),
        ...(JSON.stringify(result(13)).includes('print lo\\n') &&
        !JSON.stringify(result(13)).includes('__lerta_completion__')
          ? []
          : [`formatting after: ${JSON.stringify(result(13))}`]),
        ...(leaked ? ['the probe name in published diagnostics'] : []),
      ]
    },
  },
  {
    name: 'lerta lsp completes a called method, the members of @ and of an optional, and a local over a module name',
    run: async () => {
      const lines = (here: string) =>
        [
          'struct Point(x: Int, y: Int)',
          'const p = 3',
          'class Box',
          '  count = 0',
          '  bump = ->',
          '    @count += 1',
          here,
          'const f = (p: Point, q: Point?) ->',
          '  print p.x',
          '',
        ].join('\n')
      const asks: [string, number, number][] = [
        // A method being called, the cursor in its name
        ['  print p.eq()', 8, 11],
        // A name after @ is a member of the object
        ['    print @co', 6, 13],
        // After ?. of an optional value
        ['  print q?.', 8, 11],
        // The parameter p, of Point, not the top-level p, once
        ['  print p', 8, 9],
        // A line past the end
        ['  print p.x', 40, 0],
        // A name after the dots of a range, which is no member
        ['  print [i for i in 0...p]', 8, 24],
        // @ with no name after it yet
        ['    print @', 6, 11],
      ]
      const ran = await session({ 'a.lerta': lines('') }, (uri) => [
        open(uri('a.lerta'), lines('')),
        ...asks.flatMap(([here, line, character], i) => {
          const text = line === 6 ? lines(here) : lines('').replace('  print p.x', here)
          return [
            change(uri('a.lerta'), text),
            {
              id: 10 + i,
              method: 'textDocument/completion',
              params: { textDocument: { uri: uri('a.lerta') }, position: { line, character } },
            },
          ]
        }),
      ])
      const result = (id: number) =>
        (after_initialize(ran.received).find((message) => message.id === id)?.result ??
          []) as Item[]
      const labels = (id: number) =>
        result(id)
          .filter((item) => item.kind !== KEYWORD)
          .map((item) => item.label)
      const ps = result(13).filter((item) => item.label === 'p')
      return [
        ...compare_text('called method', 'x y equals hash', labels(10).join(' ')),
        ...compare_text('members of @', 'count bump equals hash', labels(11).join(' ')),
        ...compare_text('after ?.', 'x y equals hash', labels(12).join(' ')),
        ...compare_text(
          'local over a module name',
          'p Point',
          ps.map((item) => `${item.label} ${item.detail}`).join(' '),
        ),
        ...compare_text('past the end', '', labels(14).join(' ')),
        ...compare_text('after a range', 'p q', labels(15).slice(0, 2).join(' ')),
        ...compare_text('@ alone', 'count bump equals hash', labels(16).join(' ')),
      ]
    },
  },
  {
    name: 'lerta lsp completes imported names and C functions as declared, a name over a builtin once, and top-level code',
    run: async () => {
      const lib = 'export const helper = -> 1\nexport struct Pair(a: Int)\n'
      const main = (here: string) =>
        [
          "import helper, Pair as Couple from './lib'",
          "import sqrt from 'std:math'",
          'const print = (n: Int) -> n',
          here,
          'const later_top = 1',
          'const f = -> later_top',
          '',
        ].join('\n')
      const ran = await session({ 'a.lerta': main('print 1'), 'lib.lerta': lib }, (uri) => [
        open(uri('a.lerta'), main('print 1')),
        change(uri('a.lerta'), main('const x = he')),
        {
          id: 10,
          method: 'textDocument/completion',
          params: { textDocument: { uri: uri('a.lerta') }, position: { line: 3, character: 12 } },
        },
      ])
      const items = (after_initialize(ran.received).find((message) => message.id === 10)?.result ??
        []) as Item[]
      const shown = (label: string) =>
        items
          .filter((item) => item.label === label)
          .map((item) => `${label} ${item.kind} ${item.detail}`)
          .join(', ')
      return [
        // An imported function and struct, the struct under the name it is imported by
        ...compare_text('helper', 'helper 3 () -> Int', shown('helper')),
        ...compare_text('Couple', 'Couple 22 null', shown('Couple')),
        ...compare_text('Pair', '', shown('Pair')),
        // C functions, imported and of std:builtins
        ...compare_text('sqrt', 'sqrt 3 (Float) -> Float', shown('sqrt')),
        ...compare_text('panic', 'panic 3 (String) -> never', shown('panic')),
        // The module's print, once, over std:builtins'
        ...compare_text('print', 'print 3 (Int) -> Int', shown('print')),
        // A top-level value declared after the place in top-level code, which it cannot read yet
        ...compare_text('later_top', '', shown('later_top')),
      ]
    },
  },
]
