// Builds an expression tree of one variable picked by a pseudo-random generator, evaluates it
// modulo a prime for many values of the variable, and prints the sum of the values modulo the prime.
package main

import "fmt"

const (
	depth   = 22
	values  = 150
	modulus = 1000003
)

type Expr interface{}

type Num struct{ value int }
type Var struct{ coefficient int }
type Add struct{ left, right Expr }
type Mul struct{ left, right Expr }
type Neg struct{ operand Expr }

// MINSTD, whose products fit in the integers of every language compared.
var seed = 1

func nextRandom() int {
	seed = seed * 48271 % 2147483647
	return seed
}

func makeExpr(depth int) Expr {
	if depth == 0 {
		isNum := nextRandom()%2 == 0
		digit := nextRandom() % 10
		if isNum {
			return &Num{digit}
		}
		return &Var{digit}
	}
	switch nextRandom() % 3 {
	case 0:
		left := makeExpr(depth - 1)
		return &Add{left, makeExpr(depth - 1)}
	case 1:
		left := makeExpr(depth - 1)
		return &Mul{left, makeExpr(depth - 1)}
	default:
		return &Neg{makeExpr(depth - 1)}
	}
}

func eval(expr Expr, x int) int {
	switch expr := expr.(type) {
	case *Num:
		return expr.value
	case *Var:
		return expr.coefficient * x % modulus
	case *Add:
		return (eval(expr.left, x) + eval(expr.right, x)) % modulus
	case *Mul:
		return eval(expr.left, x) * eval(expr.right, x) % modulus
	case *Neg:
		return (modulus - eval(expr.operand, x)) % modulus
	}
	panic("unknown expression")
}

func main() {
	tree := makeExpr(depth)
	sum := 0
	for x := 0; x < values; x++ {
		sum = (sum + eval(tree, x)) % modulus
	}
	fmt.Println(sum)
}
