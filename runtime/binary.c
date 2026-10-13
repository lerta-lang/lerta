#include <string.h>

#include "internal.h"

LERTA_STATIC_STRING(slice_out_of_range, "slice out of range");

int64_t lerta_binary_length(const LertaString *binary) { return binary->length; }

uint8_t lerta_binary_get(const LertaString *binary, int64_t index) {
  if (index >= 0 && index < binary->length) return binary->bytes[index];
  lerta_raise_index_out_of_range();
  return 0;
}

int64_t lerta_byte_to_int(uint8_t byte) { return byte; }

// The caller has checked that `n` fits in a byte.
uint8_t lerta_int_to_byte(int64_t n) { return (uint8_t)n; }

// `end` is exclusive.
LertaString *lerta_binary_slice(const LertaString *binary, int64_t start, int64_t end) {
  if (start < 0 || start > end || end > binary->length) {
    lerta_raise(LERTA_INDEX_ERROR, (const LertaString *)&slice_out_of_range);
    return NULL;
  }
  return lerta_string_from_bytes(binary->bytes + start, end - start);
}

int64_t lerta_binary_find(const LertaString *binary, const LertaString *part, int64_t from) {
  int64_t last_start = binary->length - part->length;
  for (int64_t i = from; i <= last_start; i++) {
    const uint8_t *candidate = memchr(binary->bytes + i, part->bytes[0], (size_t)(last_start - i + 1));
    if (candidate == NULL) return -1;
    i = candidate - binary->bytes;
    if (memcmp(candidate, part->bytes, (size_t)part->length) == 0) return i;
  }
  return -1;
}

LertaString *lerta_binary_from_bytes(const LertaArray *bytes) {
  LertaString *binary = lerta_string_new(bytes->length);
  for (int64_t i = 0; i < bytes->length; i++) binary->bytes[i] = (uint8_t)lerta_word_item(bytes, i);
  return binary;
}

LertaString *lerta_binary_as_string(LertaString *binary) {
  lerta_retain(binary);
  return binary;
}
