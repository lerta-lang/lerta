// Adds up, over a number of rounds, the items of lazy pipelines of filters and maps over a generator
// of pseudo-random numbers, with functions that capture the round, and prints the total.
let rounds = 20
let count = 1000000

// MINSTD from the seed, whose products fit in the integers of every language compared.
struct Randoms: Sequence, IteratorProtocol {
  var state: Int
  var left: Int

  init(_ seed: Int, _ count: Int) { (state, left) = (seed, count) }

  mutating func next() -> Int? {
    if left == 0 { return nil }
    left -= 1
    state = state * 48271 % 2147483647
    return state
  }
}

var total = 0
for k in 1...rounds {
  total += Randoms(k, count).lazy.filter { $0 % k != 0 }.map { $0 % 1000 + k }.reduce(0, +)
  total += Randoms(k, count).lazy.filter { $0 % 2 == 0 }.map { $0 % 1000 * 7 }
    .reduce(0) { $0 + $1 } // with a closure, as the others fold
}
print(total)
