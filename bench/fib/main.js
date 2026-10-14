// Gives the n-th Fibonacci number, by naive recursion.
const fib = (n) => (n < 2 ? n : fib(n - 1) + fib(n - 2));

console.log(fib(40));
