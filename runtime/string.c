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

LertaString *lerta_int_to_string(int64_t n) {
  uint8_t text[LERTA_INT_TEXT_MAX];
  int64_t start = lerta_format_int(n, text);
  return lerta_string_from_bytes(text + start, LERTA_INT_TEXT_MAX - start);
}

// A UInt64, whose values above the largest Int an Int's text would show as negative.
LertaString *lerta_uint64_to_string(uint64_t n) {
  uint8_t text[LERTA_INT_TEXT_MAX];
  int64_t start = LERTA_INT_TEXT_MAX;
  do {
    text[--start] = (uint8_t)('0' + n % 10);
    n /= 10;
  } while (n != 0);
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

int64_t lerta_string_compare(const LertaString *a, const LertaString *b) {
  int64_t shorter = a->length < b->length ? a->length : b->length;
  int bytes = memcmp(a->bytes, b->bytes, (size_t)shorter);
  if (bytes != 0) return bytes < 0 ? -1 : 1;
  return a->length < b->length ? -1 : a->length > b->length ? 1 : 0;
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

int64_t lerta_float32_literal_bits(const LertaString *text) {
  char *digits = lerta_c_string(text);
  // Rounded to a float at once, rather than through a double, which could round it twice.
  double value = strtof(digits, NULL);
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

// The fewest significant digits that read back as the value, a double, or a float if is_float32,
// at most 17 for a double and 9 for a float.
static LertaString *shortest_text(double value, bool is_float32) {
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
  return lerta_string_from_bytes(text, (int64_t)strlen(text));
}

LertaString *lerta_float_to_string(double value) { return shortest_text(value, false); }

LertaString *lerta_float32_to_string(float value) { return shortest_text(value, true); }

bool lerta_float_fits_float32(double value) { return isfinite((float)value); }

float lerta_float_to_float32(double value) { return (float)value; }

double lerta_float32_to_float(float value) { return value; }

bool lerta_float_fits_int(double value) {
  // -2^63 is a double, the lowest Int; 2^63 is the first double past the highest.
  return value >= -9223372036854775808.0 && value < 9223372036854775808.0;
}

// C's conversion of a value that does not fit is undefined.
int64_t lerta_float_to_int(double value) { return (int64_t)value; }

LERTA_STATIC_STRING(true_text, "true");
LERTA_STATIC_STRING(false_text, "false");

// Immortal, so that the caller's release of it does nothing.
LertaString *lerta_bool_text(bool value) {
  const void *text = value ? (const void *)&true_text : (const void *)&false_text;
  return (LertaString *)(intptr_t)text;
}

static bool is_control(uint8_t byte) { return byte < 0x20 || byte == 0x7F; }

// The escape of a byte in a "..." literal (see docs/reference/syntax.md), or NULL if it needs none.
static const char *escape_of(uint8_t byte) {
  switch (byte) {
    case '\\': return "\\\\";
    case '"': return "\\\"";
    case '#': return "\\#";
    case '\n': return "\\n";
    case '\t': return "\\t";
    case '\r': return "\\r";
    case '\0': return "\\0";
    default: return NULL;
  }
}

// The string as a literal that gives it: '...' if that can hold it, as it has no escapes, and
// otherwise "...", with escapes, a control character as \u{...}.
LertaString *lerta_string_quoted(const LertaString *s) {
  bool plain = true;
  for (int64_t i = 0; i < s->length; i++) {
    if (s->bytes[i] == '\'' || is_control(s->bytes[i])) plain = false;
  }
  if (plain) {
    LertaString *result = lerta_string_new(s->length + 2);
    result->bytes[0] = '\'';
    memcpy(result->bytes + 1, s->bytes, (size_t)s->length);
    result->bytes[s->length + 1] = '\'';
    return result;
  }
  // Each byte takes at most 7 bytes, as \u{7F}.
  char *buffer = lerta_mem_alloc(s->length * 7 + 2);
  int64_t length = 0;
  buffer[length++] = '"';
  for (int64_t i = 0; i < s->length; i++) {
    uint8_t byte = s->bytes[i];
    const char *escape = escape_of(byte);
    if (escape) {
      size_t size = strlen(escape);
      memcpy(buffer + length, escape, size);
      length += (int64_t)size;
    } else if (is_control(byte)) {
      length += (int64_t)snprintf(buffer + length, 8, "\\u{%X}", byte);
    } else {
      buffer[length++] = (char)byte;
    }
  }
  buffer[length++] = '"';
  LertaString *result = lerta_string_from_bytes(buffer, length);
  lerta_mem_free(buffer);
  return result;
}
