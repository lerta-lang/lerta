#include "internal.h"

LERTA_STATIC_STRING(slice_out_of_range, "slice out of range");

LertaString *lerta_binary_slice(const LertaString *binary, int64_t start, int64_t end) {
  if (start < 0 || start > end || end > binary->length) {
    lerta_raise(LERTA_INDEX_ERROR, (const LertaString *)&slice_out_of_range);
    return NULL;
  }
  return lerta_string_from_bytes(binary->bytes + start, end - start);
}

LERTA_STATIC_STRING(slice_within_character, "slice within a character");

// Whether `at` is the end of `s` or the start of a character, rather than a byte that continues
// one.
static bool is_boundary(const LertaString *s, int64_t at) {
  return at == s->length || (s->bytes[at] & 0xC0) != 0x80;
}

// Kept out of lerta_string_slice, so that it is short enough for LLVM to inline.
__attribute__((noinline)) static LertaString *raise_slice_error(const LertaString *message) {
  lerta_raise(LERTA_INDEX_ERROR, message);
  return NULL;
}

// The bytes of valid UTF-8 between two boundaries of characters are valid UTF-8 themselves.
LertaString *lerta_string_slice(const LertaString *s, int64_t start, int64_t end) {
  if (start < 0 || start > end || end > s->length) {
    return raise_slice_error((const LertaString *)&slice_out_of_range);
  }
  if (!is_boundary(s, start) || !is_boundary(s, end)) {
    return raise_slice_error((const LertaString *)&slice_within_character);
  }
  return lerta_string_from_bytes(s->bytes + start, end - start);
}

LertaString *lerta_binary_as_string(LertaString *binary) {
  lerta_retain(binary);
  return binary;
}
