// Builds an expression tree of one variable picked by a pseudo-random generator, evaluates it
// modulo a prime for many values of the variable, and prints the sum of the values modulo the prime.
const DEPTH = 22;
const VALUES = 150;
const MODULUS = 1000003;

// The kinds of the nodes, which evaluate switches on, as the other languages do.
const NUM = 0, VAR = 1, ADD = 2, MUL = 3, NEG = 4;

class Num { constructor(value) { this.kind = NUM; this.value = value; } }
class Var { constructor(coefficient) { this.kind = VAR; this.coefficient = coefficient; } }
class Add { constructor(left, right) { this.kind = ADD; this.left = left; this.right = right; } }
class Mul { constructor(left, right) { this.kind = MUL; this.left = left; this.right = right; } }
class Neg { constructor(operand) { this.kind = NEG; this.operand = operand; } }

// MINSTD, whose products fit in the integers of every language compared.
let seed = 1;
function nextRandom() {
  seed = seed * 48271 % 2147483647;
  return seed;
}

function make(depth) {
  if (depth === 0) {
    const isNum = nextRandom() % 2 === 0;
    const digit = nextRandom() % 10;
    return isNum ? new Num(digit) : new Var(digit);
  }
  switch (nextRandom() % 3) {
    case 0: {
      const left = make(depth - 1);
      return new Add(left, make(depth - 1));
    }
    case 1: {
      const left = make(depth - 1);
      return new Mul(left, make(depth - 1));
    }
    default:
      return new Neg(make(depth - 1));
  }
}

function evaluate(expr, x) {
  switch (expr.kind) {
    case NUM: return expr.value;
    case VAR: return expr.coefficient * x % MODULUS;
    case ADD: return (evaluate(expr.left, x) + evaluate(expr.right, x)) % MODULUS;
    case MUL: return evaluate(expr.left, x) * evaluate(expr.right, x) % MODULUS;
    case NEG: return (MODULUS - evaluate(expr.operand, x)) % MODULUS;
  }
}

const tree = make(DEPTH);
let sum = 0;
for (let x = 0; x < VALUES; x++) sum = (sum + evaluate(tree, x)) % MODULUS;
console.log(sum);
