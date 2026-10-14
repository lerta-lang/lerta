// Gives the n-th Fibonacci number, by naive recursion.
func fib(_ n: Int) -> Int {
  n < 2 ? n : fib(n - 1) + fib(n - 2)
}

print(fib(40))
