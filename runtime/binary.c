#include <string.h>

#include "lerta.h"

LERTA_STATIC_STRING(slice_out_of_range, "slice out of range");

int64_t lerta_binary_length(const LertaString *binary) { return binary->length; }

uint8_t lerta_binary_get(const LertaString *binary, int64_t index) {
  if (index < 0 || index >= binary->length) lerta_throw_index_out_of_range();
  return binary->bytes[index];
}

// `end` is exclusive.
LertaString *lerta_binary_slice(const LertaString *binary, int64_t start, int64_t end) {
  if (start < 0 || start > end || end > binary->length) {
    lerta_throw((const LertaString *)&slice_out_of_range);
  }
  int64_t length = end - start;
  LertaString *slice = lerta_alloc((int64_t)sizeof(LertaString) + length, NULL);
  slice->length = length;
  memcpy(slice->bytes, binary->bytes + start, (size_t)length);
  return slice;
}
