#include <math.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "internal.h"

int64_t lerta_format_int(int64_t n, uint8_t buffer[LERTA_INT_TEXT_MAX]) {
  int64_t start = LERTA_INT_TEXT_MAX;
  // Working with the negative value avoids overflow on INT64_MIN.
  int64_t negative = n < 0 ? n : -n;
  do {
    buffer[--start] = (uint8_t)('0' - negative % 10);
    negative /= 10;
  } while (negative != 0);
  if (n < 0) buffer[--start] = '-';
  return start;
}

LertaString *lerta_string_new(int64_t length) {
  LertaString *s = lerta_new((int64_t)sizeof(LertaString) + length, NULL);
  s->length = length;
  return s;
}

LertaString *lerta_string_from_bytes(const void *bytes, int64_t length) {
  LertaString *s = lerta_string_new(length);
  memcpy(s->bytes, bytes, (size_t)length);
  return s;
}

LertaString *lerta_string_from_c(const char *text) {
  return lerta_string_from_bytes(text, (int64_t)strlen(text));
}

LertaString *lerta_string_from_os(char *text) {
  if (text == NULL) return NULL;
  LertaString *string = lerta_string_from_c(text);
  free(text);
  return string;
}

void lerta_append_c_string(LertaArray *array, const char *text) {
  LertaString *string = lerta_string_from_c(text);
  lerta_array_append(array, &string);
  lerta_release(string);
}

static int64_t total_length(int64_t count, va_list args) {
  va_list parts;
  va_copy(parts, args);
  int64_t length = 0;
  for (int64_t i = 0; i < count; i++) length += va_arg(parts, const LertaString *)->length;
  va_end(parts);
  return length;
}

// A part of a concatenation, by its index, its length and where its bytes start in the result.
typedef struct {
  int64_t index;
  LertaString *part;
  int64_t length;
  int64_t start;
} PlacedPart;

// The longest of the parts that nothing else holds and whose place has room for `size` bytes; its
// index is -1 if there is none.
static PlacedPart longest_with_room(int64_t count, va_list args, int64_t size) {
  PlacedPart longest = {.index = -1};
  int64_t start = 0;
  va_list parts;
  va_copy(parts, args);
  for (int64_t i = 0; i < count; i++) {
    LertaString *part = va_arg(parts, LertaString *);
    bool fits = part->header.ref_count == 1 && lerta_has_room(part, size);
    if (fits && (longest.index < 0 || part->length > longest.length)) {
      longest = (PlacedPart){.index = i, .part = part, .length = part->length, .start = start};
    }
    start += part->length;
  }
  va_end(parts);
  return longest;
}

// The concatenation of the `count` parts that `args` holds, which it takes if `taken`: then the
// longest part that nothing else holds and whose place has room for the result is extended there,
// its bytes moved to their place, rather than all copied into a new String. One without the room
// is not grown, which would leave the result in a place of twice the size, as lerta_grow gives a
// String that `+=` extends.
static LertaString *concat(int64_t count, va_list args, bool taken) {
  int64_t length = total_length(count, args);
  int64_t size = (int64_t)sizeof(LertaString) + length;
  PlacedPart kept = taken ? longest_with_room(count, args, size) : (PlacedPart){.index = -1};
  LertaString *result;
  if (kept.index < 0) {
    result = lerta_string_new(length);
  } else {
    result = kept.part;
    memmove(result->bytes + kept.start, result->bytes, (size_t)kept.length);
    result->length = length;
  }
  int64_t offset = 0;
  va_list parts;
  va_copy(parts, args);
  for (int64_t i = 0; i < count; i++) {
    LertaString *part = va_arg(parts, LertaString *);
    if (i == kept.index) {
      // Its own length is the result's by now.
      offset += kept.length;
      continue;
    }
    memcpy(result->bytes + offset, part->bytes, (size_t)part->length);
    offset += part->length;
    if (taken) lerta_release(part);
  }
  va_end(parts);
  return result;
}

LertaString *lerta_string_concat(int64_t count, ...) {
  va_list args;
  va_start(args, count);
  LertaString *result = concat(count, args, false);
  va_end(args);
  return result;
}

LertaString *lerta_string_concat_taken(int64_t count, ...) {
  va_list args;
  va_start(args, count);
  LertaString *result = concat(count, args, true);
  va_end(args);
  return result;
}

// A copy of `s`, taken, `length` bytes long, of which `s`'s come first. Kept out of extended, so
// that it is short enough for LLVM to inline.
__attribute__((noinline)) static LertaString *copied(LertaString *s, int64_t length) {
  LertaString *result = lerta_string_new(length);
  memcpy(result->bytes, s->bytes, (size_t)s->length);
  lerta_release(s);
  return result;
}

// `s`, taken, with room for `extra` more bytes after its own, which the caller fills: in place
// when nothing else holds it, which a String or a Binary may move to, as none is held weakly nor
// thrown; else in a copy.
static LertaString *extended(LertaString *s, int64_t extra) {
  int64_t length = s->length + extra;
  LertaString *result;
  if (s->header.ref_count == 1) {
    result = lerta_grow(s, (int64_t)sizeof(LertaString) + length);
  } else {
    result = copied(s, length);
  }
  result->length = length;
  return result;
}

LertaString *lerta_string_extend(LertaString *s, const LertaString *part) {
  int64_t start = s->length;
  LertaString *result = extended(s, part->length);
  memcpy(result->bytes + start, part->bytes, (size_t)part->length);
  return result;
}

LertaString *lerta_binary_push(LertaString *binary, uint8_t byte) {
  LertaString *result = extended(binary, 1);
  result->bytes[result->length - 1] = byte;
  return result;
}

// `s`, taken, with the UTF-8 of `c`, a scalar value beyond ASCII, appended. Kept out of
// lerta_string_push, so that an ASCII character's push is short enough for LLVM to inline.
__attribute__((noinline)) static LertaString *pushed_beyond_ascii(LertaString *s, uint32_t c) {
  int64_t length = c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  LertaString *result = extended(s, length);
  uint8_t *bytes = result->bytes + result->length - length;
  static const uint8_t leads[] = {0, 0, 0xC0, 0xE0, 0xF0};
  for (int64_t i = length - 1; i > 0; i--) {
    bytes[i] = (uint8_t)(0x80 | (c & 0x3F));
    c >>= 6;
  }
  bytes[0] = (uint8_t)(leads[length] | c);
  return result;
}

LertaString *lerta_string_push(LertaString *s, uint32_t c) {
  if (c < 0x80) return lerta_binary_push(s, (uint8_t)c);
  return pushed_beyond_ascii(s, c);
}

uint64_t lerta_hash_seed;
uint64_t lerta_hash_secret[4];

// The targets are all little-endian, so that a load is the word of its bytes in order.
static uint64_t load_word(const uint8_t *bytes) {
  uint64_t word;
  memcpy(&word, bytes, sizeof word);
  return word;
}

static uint64_t load_half(const uint8_t *bytes) {
  uint32_t half;
  memcpy(&half, bytes, sizeof half);
  return half;
}

// The 128 bits of the product of a and b, the low half in a and the high in b; from four products
// of 32 bits where the target has no 128-bit integers, as i686, or LERTA_NO_INT128 is defined, as a
// check of the runtime defines it to take the way of i686 on the host.
static void multiply_wide(uint64_t *a, uint64_t *b) {
#if defined(__SIZEOF_INT128__) && !defined(LERTA_NO_INT128)
  __uint128_t product = (__uint128_t)*a * *b;
  *a = (uint64_t)product;
  *b = (uint64_t)(product >> 64);
#else
  uint64_t a_high = *a >> 32, a_low = (uint32_t)*a, b_high = *b >> 32, b_low = (uint32_t)*b;
  uint64_t high = a_high * b_high, middle_a = a_high * b_low, middle_b = b_high * a_low;
  uint64_t low = a_low * b_low;
  uint64_t partial = low + (middle_a << 32);
  uint64_t carry = partial < low;
  uint64_t result = partial + (middle_b << 32);
  carry += result < partial;
  *a = result;
  *b = high + (middle_a >> 32) + (middle_b >> 32) + carry;
#endif
}

static uint64_t mixed(uint64_t a, uint64_t b) {
  multiply_wide(&a, &b);
  return a ^ b;
}

// wyhash's random numbers, which make_secret draws from.
static uint64_t next_random(uint64_t *seed) {
  *seed += 0x2d358dccaa6c78a5u;
  return mixed(*seed, *seed ^ 0x8bb84b93962eacc9u);
}

// a * b modulo m, as wyhash's mul_mod gives it. Making the secret runs at every start, so this
// takes one remainder of 128 bits where the target has them; else, as on i686, where a remainder
// of 64 bits is a call, one of the product's high word, and then shifts in the low word's bits one
// by one, each reduced by a subtraction.
static uint64_t multiply_mod(uint64_t a, uint64_t b, uint64_t m) {
#if defined(__SIZEOF_INT128__) && !defined(LERTA_NO_INT128)
  return (uint64_t)((__uint128_t)a * b % m);
#else
  multiply_wide(&a, &b);
  uint64_t r = b % m;
  for (int bit = 63; bit >= 0; bit--) {
    uint64_t carry = r >> 63;
    r = r << 1 | (a >> bit & 1);
    if (carry || r >= m) r -= m;
  }
  return r;
#endif
}

static uint64_t power_mod(uint64_t a, uint64_t b, uint64_t m) {
  uint64_t r = 1;
  while (b) {
    if (b & 1) r = multiply_mod(r, a, m);
    b >>= 1;
    if (b) a = multiply_mod(a, a, m);
  }
  return r;
}

// Whether the odd n is a strong probable prime to the base a, as wyhash's sprp.
static bool is_strong_probable_prime(uint64_t n, uint64_t a) {
  uint64_t d = n - 1;
  unsigned s = 0;
  while (!(d & 1)) {
    d >>= 1;
    s++;
  }
  uint64_t b = power_mod(a, d, n);
  if (b == 1 || b == n - 1) return true;
  for (unsigned r = 1; r < s; r++) {
    b = multiply_mod(b, b, n);
    if (b <= 1) return false;
    if (b == n - 1) return true;
  }
  return false;
}

// Whether the odd n is prime, as wyhash's is_prime: the bases up to 37 decide it for every 64-bit
// n, and 2 alone below 2047. The primes up to 47 come first: they divide about 70% of the odd
// numbers that make_secret draws, which they reject without the costlier tests, which took most of
// the time of making a secret on i686.
static bool is_prime(uint64_t n) {
  static const uint64_t small_primes[] = {3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47};
  static const uint64_t bases[] = {2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37};
  if (n < 2 || !(n & 1)) return false;
  if (n < 4) return true;
  for (size_t i = 0; i < sizeof small_primes / sizeof *small_primes; i++) {
    if (n % small_primes[i] == 0) return n == small_primes[i];
  }
  for (size_t i = 0; i < sizeof bases / sizeof *bases; i++) {
    if (!is_strong_probable_prime(n, bases[i])) return false;
    if (n < 2047) return true;
  }
  return true;
}

__attribute__((noinline, cold)) void lerta_make_hash_secret(uint64_t seed, uint64_t secret[4]) {
  // The bytes of four set bits, of which each word of the secret is made.
  static const uint8_t bytes[] = {
      15,  23,  27,  29,  30,  39,  43,  45,  46,  51,  53,  54,  57,  58,  60,  71,  75,  77,
      78,  83,  85,  86,  89,  90,  92,  99,  101, 102, 105, 106, 108, 113, 114, 116, 120, 135,
      139, 141, 142, 147, 149, 150, 153, 154, 156, 163, 165, 166, 169, 170, 172, 177, 178, 180,
      184, 195, 197, 198, 201, 202, 204, 209, 210, 212, 216, 225, 226, 228, 232, 240};
  for (size_t i = 0; i < 4; i++) {
    bool ok;
    do {
      ok = true;
      secret[i] = 0;
      for (size_t j = 0; j < 64; j += 8) {
        secret[i] |= (uint64_t)bytes[next_random(&seed) % sizeof bytes] << j;
      }
      if (secret[i] % 2 == 0) {
        ok = false;
        continue;
      }
      for (size_t j = 0; j < i; j++) {
        if (__builtin_popcountll(secret[j] ^ secret[i]) != 32) {
          ok = false;
          break;
        }
      }
      if (ok && !is_prime(secret[i])) ok = false;
    } while (!ok);
  }
}

// wyhash (final version 4.3) under lerta_hash_seed and lerta_hash_secret (see
// docs/internals/representation.md#maps).
uint64_t lerta_string_hash(const LertaString *s) {
  // Made at the first hash, as making it costs a program on i686 a few milliseconds at start, which
  // one that hashes no String need not pay; a secret is odd, so 0 marks none made yet.
  if (__builtin_expect(lerta_hash_secret[0] == 0, 0)) {
    lerta_make_hash_secret(lerta_hash_seed, lerta_hash_secret);
  }
  const uint64_t *secret = lerta_hash_secret;
  const uint8_t *p = s->bytes;
  uint64_t length = (uint64_t)s->length;
  uint64_t seed = lerta_hash_seed ^ mixed(lerta_hash_seed ^ secret[0], secret[1]);
  uint64_t a, b;
  if (length <= 16) {
    if (length >= 4) {
      uint64_t step = (length >> 3) << 2;
      a = load_half(p) << 32 | load_half(p + step);
      b = load_half(p + length - 4) << 32 | load_half(p + length - 4 - step);
    } else if (length > 0) {
      a = (uint64_t)p[0] << 16 | (uint64_t)p[length >> 1] << 8 | p[length - 1];
      b = 0;
    } else {
      a = b = 0;
    }
  } else {
    uint64_t left = length;
    if (left >= 48) {
      uint64_t seed1 = seed, seed2 = seed;
      do {
        seed = mixed(load_word(p) ^ secret[1], load_word(p + 8) ^ seed);
        seed1 = mixed(load_word(p + 16) ^ secret[2], load_word(p + 24) ^ seed1);
        seed2 = mixed(load_word(p + 32) ^ secret[3], load_word(p + 40) ^ seed2);
        p += 48;
        left -= 48;
      } while (left >= 48);
      seed ^= seed1 ^ seed2;
    }
    while (left > 16) {
      seed = mixed(load_word(p) ^ secret[1], load_word(p + 8) ^ seed);
      p += 16;
      left -= 16;
    }
    a = load_word(p + left - 16);
    b = load_word(p + left - 8);
  }
  a ^= secret[1];
  b ^= seed;
  multiply_wide(&a, &b);
  return mixed(a ^ secret[0] ^ length, b ^ secret[1]);
}

bool lerta_string_equals(const LertaString *a, const LertaString *b) {
  return a->length == b->length && memcmp(a->bytes, b->bytes, (size_t)a->length) == 0;
}

int64_t lerta_enum_parse(const LertaString *const *texts, int64_t count, const LertaString *text) {
  for (int64_t i = 0; i < count; i++) {
    if (lerta_string_equals(texts[i], text)) return i;
  }
  return -1;
}

char *lerta_c_string(const LertaString *s) {
  if (memchr(s->bytes, '\0', (size_t)s->length) != NULL) lerta_panic("a C string with a NUL byte");
  char *result = lerta_checked_malloc((size_t)s->length + 1);
  memcpy(result, s->bytes, (size_t)s->length);
  result[s->length] = '\0';
  return result;
}

bool lerta_with_c_strings(const LertaString *a, const LertaString *b,
                          bool (*call)(const char *a, const char *b)) {
  char *c_a = lerta_c_string(a);
  char *c_b = lerta_c_string(b);
  bool result = call(c_a, c_b);
  free(c_a);
  free(c_b);
  return result;
}

// The bits of the value that the text reads as, a double, or a float if is_float32, which is
// widened to a double; -1 if it is beyond the largest.
static int64_t literal_bits(const LertaString *text, bool is_float32) {
  char *digits = lerta_c_string(text);
  // A float is read as one at once, rather than through a double, which could round it twice.
  double value = is_float32 ? strtof(digits, NULL) : strtod(digits, NULL);
  free(digits);
  if (!isfinite(value)) return -1;
  int64_t bits;
  memcpy(&bits, &value, sizeof bits);
  return bits;
}

int64_t lerta_float_literal_bits(const LertaString *text) { return literal_bits(text, false); }

int64_t lerta_float32_literal_bits(const LertaString *text) { return literal_bits(text, true); }

double lerta_float_from_bits(int64_t bits) {
  double value;
  memcpy(&value, &bits, sizeof value);
  return value;
}

// The fewest significant digits that read back as the value, a double, or a float if is_float32,
// at most 17 for a double and 9 for a float.
static LertaString *shortest_text(double value, bool is_float32) {
  if (isinf(value)) return lerta_string_from_c(value < 0 ? "-inf" : "inf");
  int digits = 1;
  char text[32];
  for (;; digits++) {
    snprintf(text, sizeof text, "%.*e", digits - 1, value);
    if (is_float32 ? digits == 9 || strtof(text, NULL) == (float)value
                   : digits == 17 || strtod(text, NULL) == value) {
      break;
    }
  }
  int exponent = atoi(strchr(text, 'e') + 1);
  // As Python writes it: in positional notation from 1e-4 up to 1e16, with at least one digit
  // after the point, and in scientific notation beyond.
  if (exponent >= -4 && exponent < 16) {
    int decimals = digits - 1 - exponent;
    snprintf(text, sizeof text, "%.*f", decimals > 0 ? decimals : 0, value);
    if (strchr(text, '.') == NULL) strcat(text, ".0");
  }
  return lerta_string_from_c(text);
}

LertaString *lerta_float_to_string(double value) { return shortest_text(value, false); }

LertaString *lerta_float32_to_string(float value) { return shortest_text(value, true); }

bool lerta_float_fits_int(double value) {
  // -2^63 is a double, the lowest Int; 2^63 is the first double past the highest.
  return value >= -9223372036854775808.0 && value < 9223372036854775808.0;
}

// C's conversion of a value that does not fit is undefined.
int64_t lerta_float_to_int(double value) { return (int64_t)value; }
