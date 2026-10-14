// Counts the primes below n.
func sieve(_ n: Int) -> Int {
  var composite = [Bool](repeating: false, count: n)
  var count = 0
  for i in 2..<n {
    if composite[i] { continue }
    count += 1
    var j = i * i
    while j < n {
      composite[j] = true
      j += i
    }
  }
  return count
}

print(sieve(50000000))
