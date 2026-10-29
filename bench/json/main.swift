// Makes the JSON text of an array of objects picked by a pseudo-random generator, parses it a
// number of times into values of arrays, objects, integers, strings and booleans, and prints a sum
// over each value parsed. The parser takes only what the text holds: no floats, escapes, nulls or
// errors.
let objects = 200000
let parses = 5

indirect enum Json {
  case int(Int)
  case string(String)
  case bool(Bool)
  case array([Json])
  case object([String: Json])
}

// MINSTD, whose products fit in the integers of every language compared.
var seed = 1
func nextRandom() -> Int {
  seed = seed * 48271 % 2147483647
  return seed
}

func makeText() -> String {
  var text = "["
  for i in 0..<objects {
    if i > 0 { text += ", " }
    let id = nextRandom() % 1000000
    let name = nextRandom() % 5000
    text += "{\"id\": \(id), \"name\": \"w\(name)\", \"tags\": ["
    let tags = nextRandom() % 4
    for t in 0..<tags {
      if t > 0 { text += ", " }
      text += "\"t\(nextRandom() % 100)\""
    }
    let active = nextRandom() % 2 == 0
    text += "], \"active\": \(active)}"
  }
  return text + "]"
}

// Each part read skips the spaces after it, so that the next starts at its first byte.
struct Parser {
  let bytes: [UInt8]
  var position = 0

  init(_ bytes: [UInt8]) { self.bytes = bytes }

  mutating func skipSpaces() {
    while position < bytes.count && bytes[position] == UInt8(ascii: " ") { position += 1 }
  }

  // Skips a punctuation byte, as `[` or `,`, which the text has at the position.
  mutating func skipByte() {
    position += 1
    skipSpaces()
  }

  mutating func parseValue() -> Json {
    switch bytes[position] {
    case UInt8(ascii: "["): return parseArray()
    case UInt8(ascii: "{"): return parseObject()
    case UInt8(ascii: "\""): return .string(parseString())
    case UInt8(ascii: "t"): return parseWord(4, true)
    case UInt8(ascii: "f"): return parseWord(5, false)
    default: return parseInt()
    }
  }

  mutating func parseWord(_ length: Int, _ value: Bool) -> Json {
    position += length
    skipSpaces()
    return .bool(value)
  }

  mutating func parseArray() -> Json {
    skipByte()
    var items: [Json] = []
    if bytes[position] != UInt8(ascii: "]") {
      items.append(parseValue())
      while bytes[position] == UInt8(ascii: ",") {
        skipByte()
        items.append(parseValue())
      }
    }
    skipByte()
    return .array(items)
  }

  mutating func parseObject() -> Json {
    skipByte()
    var fields: [String: Json] = [:]
    if bytes[position] != UInt8(ascii: "}") {
      parseField(&fields)
      while bytes[position] == UInt8(ascii: ",") {
        skipByte()
        parseField(&fields)
      }
    }
    skipByte()
    return .object(fields)
  }

  mutating func parseField(_ fields: inout [String: Json]) {
    let key = parseString()
    skipByte()
    fields[key] = parseValue()
  }

  mutating func parseString() -> String {
    let start = position + 1
    position = start
    while bytes[position] != UInt8(ascii: "\"") { position += 1 }
    let text = String(decoding: bytes[start..<position], as: UTF8.self)
    skipByte()
    return text
  }

  mutating func parseInt() -> Json {
    var value = 0
    while bytes[position] >= UInt8(ascii: "0") && bytes[position] <= UInt8(ascii: "9") {
      value = value * 10 + Int(bytes[position] - UInt8(ascii: "0"))
      position += 1
    }
    skipSpaces()
    return .int(value)
  }
}

// The integers, the lengths of the strings, the true booleans and the items and fields, added up.
func sum(_ value: Json) -> Int {
  switch value {
  case .int(let value): return value
  case .string(let value): return value.utf8.count
  case .bool(let value): return value ? 1 : 0
  case .array(let items): return items.count + items.reduce(0) { $0 + sum($1) }
  case .object(let fields): return fields.count + fields.values.reduce(0) { $0 + sum($1) }
  }
}

let text = Array(makeText().utf8)
var total = 0
for _ in 0..<parses {
  var parser = Parser(text)
  total += sum(parser.parseValue())
}
print(total)
