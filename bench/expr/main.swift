// Builds an expression tree of one variable picked by a pseudo-random generator, evaluates it
// modulo a prime for many values of the variable, and prints the sum of the values modulo the prime.
let depth = 22
let values = 150
let modulus = 1000003

indirect enum Expr {
  case num(Int)
  case variable(coefficient: Int)
  case add(Expr, Expr)
  case mul(Expr, Expr)
  case neg(Expr)
}

// MINSTD, whose products fit in the integers of every language compared.
var seed = 1
func nextRandom() -> Int {
  seed = seed * 48271 % 2147483647
  return seed
}

func make(_ depth: Int) -> Expr {
  if depth == 0 {
    let isNum = nextRandom() % 2 == 0
    let digit = nextRandom() % 10
    return isNum ? .num(digit) : .variable(coefficient: digit)
  }
  switch nextRandom() % 3 {
  case 0:
    let left = make(depth - 1)
    return .add(left, make(depth - 1))
  case 1:
    let left = make(depth - 1)
    return .mul(left, make(depth - 1))
  default:
    return .neg(make(depth - 1))
  }
}

func eval(_ expr: Expr, _ x: Int) -> Int {
  switch expr {
  case .num(let value): return value
  case .variable(let coefficient): return coefficient * x % modulus
  case .add(let left, let right): return (eval(left, x) + eval(right, x)) % modulus
  case .mul(let left, let right): return eval(left, x) * eval(right, x) % modulus
  case .neg(let operand): return (modulus - eval(operand, x)) % modulus
  }
}

let tree = make(depth)
var sum = 0
for x in 0..<values { sum = (sum + eval(tree, x)) % modulus }
print(sum)
