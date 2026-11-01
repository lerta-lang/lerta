#include <string.h>

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

// The length of the valid sequence at `bytes`, of which `left` are there, or 0 if there is none.
// The lead fixes the length, and the leads 0xE0, 0xED, 0xF0 and 0xF4 narrow the byte after them,
// so that overlong forms, surrogates and code points above U+10FFFF are none, as the standard
// requires.
static int64_t sequence_length(const uint8_t *bytes, int64_t left) {
  uint8_t lead = bytes[0];
  int64_t length;
  uint8_t low = 0x80;
  uint8_t high = 0xBF;
  if (lead >= 0xC2 && lead <= 0xDF) {
    length = 2;
  } else if (lead >= 0xE0 && lead <= 0xEF) {
    length = 3;
    if (lead == 0xE0) low = 0xA0;
    if (lead == 0xED) high = 0x9F;
  } else if (lead >= 0xF0 && lead <= 0xF4) {
    length = 4;
    if (lead == 0xF0) low = 0x90;
    if (lead == 0xF4) high = 0x8F;
  } else {
    return 0;
  }
  if (length > left || bytes[1] < low || bytes[1] > high) return 0;
  for (int64_t i = 2; i < length; i++) {
    if ((bytes[i] & 0xC0) != 0x80) return 0;
  }
  return length;
}

// Whether the 8 bytes at `bytes` are all ASCII.
static bool is_ascii_word(const uint8_t *bytes) {
  uint64_t word;
  memcpy(&word, bytes, sizeof word);
  return (word & 0x8080808080808080u) == 0;
}

static bool is_utf8(const LertaString *binary) {
  const uint8_t *bytes = binary->bytes;
  int64_t length = binary->length;
  int64_t i = 0;
  while (i < length) {
    if (i + 8 <= length && is_ascii_word(bytes + i)) {
      i += 8;
    } else if (bytes[i] < 0x80) {
      i += 1;
    } else {
      int64_t sequence = sequence_length(bytes + i, length - i);
      if (sequence == 0) return false;
      i += sequence;
    }
  }
  return true;
}

// The same object as a String, unchecked, which only the seed's std calls; it goes with the next
// refresh of the seed.
LertaString *lerta_binary_as_string(LertaString *binary) {
  lerta_retain(binary);
  return binary;
}

LertaString *lerta_binary_text(LertaString *binary) {
  if (!is_utf8(binary)) return NULL;
  lerta_retain(binary);
  return binary;
}
