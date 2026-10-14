#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>

// Counts the primes below n.
static long sieve(long n) {
  bool *composite = calloc(n, sizeof(bool));
  long count = 0;
  for (long i = 2; i < n; i++) {
    if (composite[i]) continue;
    count++;
    for (long j = i * i; j < n; j += i) composite[j] = true;
  }
  free(composite);
  return count;
}

int main(void) {
  printf("%ld\n", sieve(50000000));
}
