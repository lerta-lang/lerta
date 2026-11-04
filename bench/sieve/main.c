#include <inttypes.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>

// Counts the primes below n.
static int64_t sieve(int64_t n) {
  bool *composite = calloc(n, sizeof(bool));
  int64_t count = 0;
  for (int64_t i = 2; i < n; i++) {
    if (composite[i]) continue;
    count++;
    for (int64_t j = i * i; j < n; j += i) composite[j] = true;
  }
  free(composite);
  return count;
}

int main(void) {
  printf("%" PRId64 "\n", sieve(50000000));
}
