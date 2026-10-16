#include <stdlib.h>
#include <string.h>

#include "internal.h"

LERTA_STATIC_STRING(pop_from_empty, "pop from an empty array");

int64_t lerta_item_size(LertaItemKind kind) {
  if (kind & LERTA_INTEGER_ITEMS) return kind & LERTA_ITEM_BYTES;
  switch (kind) {
    case LERTA_INTERFACE_ITEMS: return 2 * (int64_t)sizeof(void *);
    case LERTA_NO_ITEMS: return 0;
    default: return 8;
  }
}

// The reference an item holds is its first 8 bytes: a reference, or an interface value's data.
static void *reference_of(LertaItemKind kind, const void *item) {
  if (kind != LERTA_REFERENCE_ITEMS && kind != LERTA_INTERFACE_ITEMS) return NULL;
  void *reference;
  memcpy(&reference, item, sizeof reference);
  return reference;
}

void lerta_retain_item(LertaItemKind kind, const void *item) {
  lerta_retain(reference_of(kind, item));
}

void lerta_release_item(LertaItemKind kind, const void *item) {
  lerta_release(reference_of(kind, item));
}

static uint8_t *item_at(const LertaArray *array, int64_t index) {
  return array->items + index * lerta_item_size(array->item_kind);
}

// The targets are all little-endian, so that an item narrower than a word is the word's first
// bytes.
int64_t lerta_word_item(const LertaArray *array, int64_t index) {
  LertaItemKind kind = array->item_kind;
  const uint8_t *item = item_at(array, index);
  int64_t word;
  if (!(kind & LERTA_INTEGER_ITEMS)) {
    memcpy(&word, item, sizeof word);
    return word;
  }
  uint64_t bits = 0;
  memcpy(&bits, item, (size_t)lerta_item_size(kind));
  int unused_bits = 64 - 8 * (int)lerta_item_size(kind);
  if (!(kind & LERTA_SIGNED_ITEMS)) return (int64_t)bits;
  return (int64_t)(bits << unused_bits) >> unused_bits;
}

static void drop_array(void *object) {
  LertaArray *array = object;
  for (int64_t i = 0; i < array->length; i++) {
    lerta_release_item(array->item_kind, item_at(array, i));
  }
  lerta_mem_free(array->items);
}

LertaArray *lerta_array_create(LertaItemKind item_kind) {
  LertaArray *array = lerta_alloc((int64_t)sizeof(LertaArray), drop_array);
  array->length = 0;
  array->capacity = 0;
  array->items = NULL;
  array->item_kind = item_kind;
  return array;
}

int64_t lerta_array_length(const LertaArray *array) { return array->length; }

LERTA_STATIC_STRING(index_out_of_range, "index out of range");

void lerta_raise_index_out_of_range(void) {
  lerta_raise(LERTA_INDEX_ERROR, (const LertaString *)&index_out_of_range);
}

uint8_t *lerta_array_checked_items(const LertaArray *array, int64_t index) {
  if (index >= 0 && index < array->length) return array->items;
  lerta_raise_index_out_of_range();
  return NULL;
}

// Kept out of lerta_array_pushed_items, so that the rest, which most pushes end in, is small
// enough for LLVM to inline into the generated code.
__attribute__((noinline)) static void grow(LertaArray *array) {
  int64_t capacity = array->capacity == 0 ? 4 : array->capacity * 2;
  size_t size = (size_t)lerta_item_size(array->item_kind);
  array->items = lerta_mem_realloc(array->items, capacity * (int64_t)size);
  array->capacity = capacity;
}

uint8_t *lerta_array_pushed_items(LertaArray *array) {
  if (array->length == array->capacity) grow(array);
  array->length++;
  return array->items;
}

void lerta_array_append(LertaArray *array, const void *item) {
  lerta_array_pushed_items(array);
  lerta_retain_item(array->item_kind, item);
  memcpy(item_at(array, array->length - 1), item, (size_t)lerta_item_size(array->item_kind));
}

// The array's reference to the item passes to the caller.
void lerta_array_take_last(LertaArray *array, void *item) {
  if (array->length == 0) {
    lerta_raise(LERTA_INDEX_ERROR, (const LertaString *)&pop_from_empty);
    return;
  }
  array->length--;
  memcpy(item, item_at(array, array->length), (size_t)lerta_item_size(array->item_kind));
}

LertaString *lerta_string_join(const LertaArray *strings, const LertaString *separator) {
  int64_t length = 0;
  for (int64_t i = 0; i < strings->length; i++) {
    length += ((const LertaString *)(intptr_t)lerta_word_item(strings, i))->length;
  }
  if (strings->length > 0) length += separator->length * (strings->length - 1);
  LertaString *result = lerta_string_new(length);
  int64_t offset = 0;
  for (int64_t i = 0; i < strings->length; i++) {
    if (i > 0) {
      memcpy(result->bytes + offset, separator->bytes, (size_t)separator->length);
      offset += separator->length;
    }
    const LertaString *part = (const LertaString *)(intptr_t)lerta_word_item(strings, i);
    memcpy(result->bytes + offset, part->bytes, (size_t)part->length);
    offset += part->length;
  }
  return result;
}

// `[a, b]`, of the texts of the items.
LertaString *lerta_array_text(const LertaArray *array, LertaItemText text_of) {
  int64_t count = array->length;
  LertaString **texts = lerta_mem_alloc(count * (int64_t)sizeof *texts);
  int64_t length = count > 0 ? 2 * count : 2;
  for (int64_t i = 0; i < count; i++) {
    texts[i] = text_of(lerta_word_item(array, i));
    length += texts[i]->length;
  }
  LertaString *result = lerta_string_new(length);
  int64_t offset = 0;
  result->bytes[offset++] = '[';
  for (int64_t i = 0; i < count; i++) {
    if (i > 0) {
      result->bytes[offset++] = ',';
      result->bytes[offset++] = ' ';
    }
    memcpy(result->bytes + offset, texts[i]->bytes, (size_t)texts[i]->length);
    offset += texts[i]->length;
    lerta_release(texts[i]);
  }
  result->bytes[offset] = ']';
  lerta_mem_free(texts);
  return result;
}

bool lerta_array_equals(const LertaArray *a, const LertaArray *b, LertaEquals equals) {
  if (a->length != b->length) return false;
  for (int64_t i = 0; i < a->length; i++) {
    if (!equals(lerta_word_item(a, i), lerta_word_item(b, i))) return false;
  }
  return true;
}

uint64_t lerta_array_hash(const LertaArray *array, LertaHash hash) {
  uint64_t result = (uint64_t)array->length;
  for (int64_t i = 0; i < array->length; i++) {
    result = result * 31 + hash(lerta_word_item(array, i));
  }
  return result;
}
