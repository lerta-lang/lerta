// Makes lines of 8 words picked by a pseudo-random generator, splits each line back into its words
// and counts them, then prints the 5 most frequent words, by count and then by word, and how many
// words there are.
let lines = 1000000
let wordsPerLine = 8
let vocabulary = 5000

// MINSTD, whose products fit in the integers of every language compared.
var seed = 1
func nextWord() -> String {
  seed = seed * 48271 % 2147483647
  return "w\(seed % vocabulary)"
}

var counts: [String: Int] = [:]
for _ in 0..<lines {
  var words: [String] = []
  for _ in 0..<wordsPerLine { words.append(nextWord()) }
  let line = words.joined(separator: " ")
  for word in line.split(separator: " ") { counts[String(word), default: 0] += 1 }
}

let ranked = counts.sorted { a, b in a.value != b.value ? a.value > b.value : a.key < b.key }
for (word, count) in ranked.prefix(5) { print("\(word) \(count)") }
print(counts.count)
