#include <inttypes.h>
#include <stdio.h>

// Gives the n-th Fibonacci number, by naive recursion.
static int64_t fib(int64_t n) {
  return n < 2 ? n : fib(n - 1) + fib(n - 2);
}

int main(void) {
  printf("%" PRId64 "\n", fib(40));
}
