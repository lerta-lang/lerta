// Makes log lines from a pseudo-random generator, with 0 to 2 more addresses and a tab now and
// then, then over all of them tests a pattern, sums a group's numbers, counts the matches of
// another, replaces the matches of a third and splits by a fourth, and prints the counts and sums.
let lines = 100000
let methods = ["GET", "POST", "PUT", "DELETE"]
let resources = ["items", "users", "orders"]
let statuses = [200, 404, 500]

// MINSTD, whose products fit in the integers of every language compared.
var seed = 1
func next(_ limit: Int) -> Int {
  seed = seed * 48271 % 2147483647
  return seed % limit
}

func twoDigits(_ n: Int) -> String {
  n < 10 ? "0\(n)" : "\(n)"
}

func lineOf() -> String {
  let day = twoDigits(next(28) + 1)
  let time = "\(twoDigits(next(24))):\(twoDigits(next(60))):\(twoDigits(next(60)))"
  let user = "user\(next(1000))@example.com"
  let method = methods[next(methods.count)]
  let path = "/\(resources[next(resources.count)])/\(next(10000))"
  let gap = next(4) == 0 ? "\t" : " "
  let status = statuses[next(statuses.count)]
  let ms = next(1000)
  var line = "2026-11-\(day) \(time) \(user) \(method) \(path)\(gap)\(status) \(ms)ms"
  let copies = next(3)
  for _ in 0..<copies { line += " cc\(next(1000))@example.com" }
  return line
}

var all: [String] = []
for _ in 0..<lines { all.append(lineOf()) }

// ASCII's \w, \d and word boundaries, as Lerta's are, where Swift's are Unicode's by default;
// \s stays Unicode's White_Space, as Lerta's is. It matches by Unicode scalars, as the others do,
// rather than by grapheme clusters, Swift's default.
func ascii(_ pattern: String) -> Regex<AnyRegexOutput> {
  try! Regex(pattern).asciiOnlyWordCharacters().asciiOnlyDigits().wordBoundaryKind(.simple)
    .matchingSemantics(.unicodeScalar)
}

let itemRead = ascii(#"\b(?:GET|POST) /items/\d+"#)
let duration = ascii(#"(\d+)ms"#)
let email = ascii(#"\w+@\w+\.com"#)
let number = ascii(#"\d+"#)
let spaces = ascii(#"\s+"#)

var itemReads = 0
var totalMs = 0
var emails = 0
var replacedLength = 0
var fields = 0
for line in all {
  if line.contains(itemRead) { itemReads += 1 }
  let match = try! duration.firstMatch(in: line)!
  totalMs += Int(match.output[1].substring!)!
  emails += line.matches(of: email).count
  replacedLength += line.replacing(number, with: "#").unicodeScalars.count
  fields += line.split(separator: spaces, omittingEmptySubsequences: false).count
}

print("item reads: \(itemReads)")
print("total ms: \(totalMs)")
print("emails: \(emails)")
print("replaced length: \(replacedLength)")
print("fields: \(fields)")
