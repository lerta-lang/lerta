#include "internal.h"

LERTA_STATIC_STRING(slice_out_of_range, "slice out of range");

LertaString *lerta_binary_slice(const LertaString *binary, int64_t start, int64_t end) {
  if (start < 0 || start > end || end > binary->length) {
    lerta_raise(LERTA_INDEX_ERROR, (const LertaString *)&slice_out_of_range);
    return NULL;
  }
  return lerta_string_from_bytes(binary->bytes + start, end - start);
}

LertaString *lerta_binary_as_string(LertaString *binary) {
  lerta_retain(binary);
  return binary;
}
