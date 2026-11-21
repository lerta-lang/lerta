// lerta_string_hash of the bytes 0, 1, ... n - 1 under wyhash's default secret: under the seed 0
// for each n of LENGTHS, which take each way of wyhash's, and under the seed 0x0706050403020100 for
// n = 15; then the secrets that lerta_make_hash_secret makes from the seeds 0 and 1, and the hash
// for n = 15 under the seed 0 and the first of them, which the check compares with wyhash's; then,
// under the process's own seed and secret, of "a"; and last lerta_hash_word of 0 under the process's
// own keys.
#include <stdio.h>
#include <string.h>

#include "internal.h"

static const int64_t LENGTHS[] = {0,  1,  2,  3,  4,  5,  6,  7,  8,  9,  10, 11,
                                  12, 13, 14, 15, 16, 17, 32, 47, 48, 49, 96, 100};
static const uint64_t DEFAULT_SECRET[4] = {0x2d358dccaa6c78a5u, 0x8bb84b93962eacc9u,
                                           0x4b33a62ed433d4a3u, 0x4d5a2da51de1aa47u};

static void print_hash(const uint8_t *bytes, int64_t length) {
  LertaString *s = lerta_string_from_bytes((const char *)bytes, length);
  printf("%016llx\n", (unsigned long long)lerta_string_hash(s));
  lerta_release(s);
}

static void print_secret(uint64_t seed) {
  uint64_t secret[4];
  lerta_make_hash_secret(seed, secret);
  for (int i = 0; i < 4; i++) printf("%016llx\n", (unsigned long long)secret[i]);
}

void lerta_main(void) {
  uint64_t own_seed = lerta_hash_seed;
  uint64_t own_secret[4];
  memcpy(own_secret, lerta_hash_secret, sizeof own_secret);
  uint8_t bytes[100];
  for (int i = 0; i < 100; i++) bytes[i] = (uint8_t)i;
  memcpy(lerta_hash_secret, DEFAULT_SECRET, sizeof DEFAULT_SECRET);
  lerta_hash_seed = 0;
  for (size_t i = 0; i < sizeof LENGTHS / sizeof *LENGTHS; i++) print_hash(bytes, LENGTHS[i]);
  lerta_hash_seed = 0x0706050403020100u;
  print_hash(bytes, 15);
  print_secret(0);
  print_secret(1);
  lerta_make_hash_secret(0, lerta_hash_secret);
  lerta_hash_seed = 0;
  print_hash(bytes, 15);
  lerta_hash_seed = own_seed;
  memcpy(lerta_hash_secret, own_secret, sizeof own_secret);
  print_hash((const uint8_t *)"a", 1);
  printf("%016llx\n", (unsigned long long)lerta_hash_word(0));
  fflush(stdout);
}
