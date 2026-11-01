// lerta_string_hash of the bytes 0, 1, ... n - 1: under the zero key for n from 0 to 16, and under
// the key of the bytes 0 to 15 for n = 15, which the check compares with SipHash-1-3's; then, under
// the process's own key, of "a".
#include <stdio.h>

#include "internal.h"

static void print_hash(const uint8_t *bytes, int64_t length) {
  LertaString *s = lerta_string_from_bytes((const char *)bytes, length);
  printf("%016llx\n", (unsigned long long)lerta_string_hash(s));
  lerta_release(s);
}

void lerta_main(void) {
  uint64_t own_key[2] = {lerta_hash_key[0], lerta_hash_key[1]};
  uint8_t bytes[16];
  for (int i = 0; i < 16; i++) bytes[i] = (uint8_t)i;
  lerta_hash_key[0] = 0;
  lerta_hash_key[1] = 0;
  for (int64_t length = 0; length <= 16; length++) print_hash(bytes, length);
  lerta_hash_key[0] = 0x0706050403020100u;
  lerta_hash_key[1] = 0x0F0E0D0C0B0A0908u;
  print_hash(bytes, 15);
  lerta_hash_key[0] = own_key[0];
  lerta_hash_key[1] = own_key[1];
  print_hash((const uint8_t *)"a", 1);
  fflush(stdout);
}
