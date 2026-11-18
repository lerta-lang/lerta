// Makes a source of lines of tokens picked by a pseudo-random generator, lexes it 10 times into
// tokens that hold their kinds and positions, then prints how many tokens of each kind there are,
// the 5 names whose first positions are the latest, and how many distinct names there are.
let lines = 60000
let rounds = 10
let tokensPerLine = 8
let vocabulary = 5000
let symbols = ["+", "-", "*", "/", "=", "(", ")"]

enum Kind: CaseIterable { case NAME, NUMBER, SYMBOL }

struct Position {
  let line: Int32
  let column: Int32
}

struct Token {
  let kind: Kind
  let start: Int32
  let pos: Position
}

// MINSTD, whose products fit in the integers of every language compared.
var seed = 1
func nextRandom() -> Int {
  seed = seed * 48271 % 2147483647
  return seed
}

func nextText() -> String {
  switch nextRandom() % 3 {
  case 0: return "v\(nextRandom() % vocabulary)"
  case 1: return "\(nextRandom() % 100000)"
  default: return symbols[nextRandom() % symbols.count]
  }
}

func isSpace(_ b: UInt8) -> Bool { b == 32 || (b >= 9 && b <= 13) }
func isDigit(_ b: UInt8) -> Bool { b >= 48 && b <= 57 }
func isLetter(_ b: UInt8) -> Bool { (b >= 97 && b <= 122) || (b >= 65 && b <= 90) }

final class Lexer {
  let bytes: [UInt8]
  var at = 0
  var line = 1
  var lineStart = 0

  init(_ bytes: [UInt8]) { self.bytes = bytes }

  func skipSpaces() {
    while at < bytes.count && isSpace(bytes[at]) {
      if bytes[at] == 10 {
        line += 1
        lineStart = at + 1
      }
      at += 1
    }
  }

  // The end of the name or number at start.
  func wordEnd(_ start: Int) -> Int {
    var end = start
    while end < bytes.count && (isLetter(bytes[end]) || isDigit(bytes[end])) { end += 1 }
    return end
  }

  func next() -> Token? {
    skipSpaces()
    if at == bytes.count { return nil }
    let start = at
    let first = bytes[start]
    let kind: Kind = isLetter(first) ? .NAME : isDigit(first) ? .NUMBER : .SYMBOL
    at = kind == .SYMBOL ? start + 1 : wordEnd(start)
    let pos = Position(line: Int32(line), column: Int32(start - lineStart + 1))
    return Token(kind: kind, start: Int32(start), pos: pos)
  }
}

var sourceLines: [String] = []
for _ in 0..<lines {
  var texts: [String] = []
  for _ in 0..<tokensPerLine { texts.append(nextText()) }
  sourceLines.append(texts.joined(separator: " "))
}
let source = Array(sourceLines.joined(separator: "\n").utf8)
var counts: [Kind: Int] = [:]
var firstPositions: [String: Position] = [:]
for _ in 0..<rounds {
  let lexer = Lexer(source)
  var tokens: [Token] = []
  while let token = lexer.next() { tokens.append(token) }
  for token in tokens {
    counts[token.kind, default: 0] += 1
    if token.kind == .NAME {
      let start = Int(token.start)
      let name = String(decoding: source[start..<lexer.wordEnd(start)], as: UTF8.self)
      if firstPositions[name] == nil { firstPositions[name] = token.pos }
    }
  }
}

for kind in Kind.allCases { print("\(kind) \(counts[kind]!)") }
let latest = firstPositions.sorted { a, b in
  a.value.line != b.value.line ? a.value.line > b.value.line : a.value.column > b.value.column
}
for (name, pos) in latest.prefix(5) { print("\(name) \(pos.line):\(pos.column)") }
print(firstPositions.count)
