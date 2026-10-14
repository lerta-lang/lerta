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
  LertaString *s = lerta_alloc((int64_t)sizeof(LertaString) + length, NULL);
  s->length = length;
  return s;
}

LertaString *lerta_string_from_bytes(const void *bytes, int64_t length) {
  LertaString *s = lerta_string_new(length);
  memcpy(s->bytes, bytes, (size_t)length);
  return s;
}

LertaString *lerta_int_to_string(int64_t n) {
  uint8_t text[LERTA_INT_TEXT_MAX];
  int64_t start = lerta_format_int(n, text);
  return lerta_string_from_bytes(text + start, LERTA_INT_TEXT_MAX - start);
}

LertaString *lerta_string_concat(int64_t count, ...) {
  va_list args;
  va_start(args, count);
  int64_t length = 0;
  for (int64_t i = 0; i < count; i++) length += va_arg(args, const LertaString *)->length;
  va_end(args);

  LertaString *result = lerta_string_new(length);
  int64_t offset = 0;
  va_start(args, count);
  for (int64_t i = 0; i < count; i++) {
    const LertaString *part = va_arg(args, const LertaString *);
    memcpy(result->bytes + offset, part->bytes, (size_t)part->length);
    offset += part->length;
  }
  va_end(args);
  return result;
}

// FNV-1a over the bytes.
uint64_t lerta_string_hash(const LertaString *s) {
  uint64_t hash = 0xCBF29CE484222325u;
  for (int64_t i = 0; i < s->length; i++) hash = (hash ^ s->bytes[i]) * 0x100000001B3u;
  return hash;
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
  if (memchr(s->bytes, '\0', (size_t)s->length) != NULL) return NULL;
  char *result = lerta_checked_malloc((size_t)s->length + 1);
  memcpy(result, s->bytes, (size_t)s->length);
  result[s->length] = '\0';
  return result;
}

int64_t lerta_float_literal_bits(const LertaString *text) {
  char *digits = lerta_c_string(text);
  double value = strtod(digits, NULL);
  free(digits);
  if (!isfinite(value)) return -1;
  int64_t bits;
  memcpy(&bits, &value, sizeof bits);
  return bits;
}

double lerta_float_from_bits(int64_t bits) {
  double value;
  memcpy(&value, &bits, sizeof value);
  return value;
}

LertaString *lerta_float_to_string(double value) {
  // The fewest significant digits that read back as the value, at most 17 for a double.
  int digits = 1;
  char text[32];
  for (;; digits++) {
    snprintf(text, sizeof text, "%.*e", digits - 1, value);
    if (digits == 17 || strtod(text, NULL) == value) break;
  }
  int exponent = atoi(strchr(text, 'e') + 1);
  // As Python writes it: in positional notation from 1e-4 up to 1e16, with at least one digit
  // after the point, and in scientific notation beyond.
  if (exponent >= -4 && exponent < 16) {
    int decimals = digits - 1 - exponent;
    snprintf(text, sizeof text, "%.*f", decimals > 0 ? decimals : 0, value);
    if (strchr(text, '.') == NULL) strcat(text, ".0");
  }
  return lerta_string_from_bytes(text, (int64_t)strlen(text));
}

LERTA_STATIC_STRING(float_to_int_overflow, "integer overflow");

int64_t lerta_float_to_int(double value) {
  // -2^63 is a double, the lowest Int; 2^63 is the first double past the highest.
  if (value >= -9223372036854775808.0 && value < 9223372036854775808.0) return (int64_t)value;
  lerta_raise(LERTA_ARITHMETIC_ERROR, (const LertaString *)&float_to_int_overflow);
  return 0;
}

double lerta_int_to_float(int64_t n) {
  return (double)n;
}
