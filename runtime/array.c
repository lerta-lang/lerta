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

static bool holds_references(LertaItemKind kind) {
  return kind == LERTA_REFERENCE_ITEMS || kind == LERTA_INTERFACE_ITEMS;
}

// The reference an item holds is its first 8 bytes: a reference, or an interface value's data.
static void *reference_of(LertaItemKind kind, const void *item) {
  if (!holds_references(kind)) return NULL;
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

void lerta_visit_item(LertaItemKind kind, const void *item, LertaVisitor visitor) {
  visitor(reference_of(kind, item));
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

static inline void visit_array(void *object, LertaVisitor visitor) {
  LertaArray *array = object;
  // Items that hold no reference would each be visited as NULL; the C compiler does not always drop
  // that loop, which costs a pass over a long array of numbers.
  if (!holds_references(array->item_kind)) return;
  for (int64_t i = 0; i < array->length; i++) {
    lerta_visit_item(array->item_kind, item_at(array, i), visitor);
  }
}

static void drop_array(void *object) {
  visit_array(object, lerta_release);
  lerta_mem_free(((LertaArray *)object)->items);
}

LERTA_STATIC_STRING(array_name, "Array");
const LertaType lerta_array_type = {drop_array, visit_array, LERTA_STR(array_name)};

LertaArray *lerta_array_create(LertaItemKind item_kind) {
  LertaArray *array = lerta_new((int64_t)sizeof(LertaArray), &lerta_array_type);
  array->length = 0;
  array->capacity = 0;
  array->items = NULL;
  array->item_kind = item_kind;
  return array;
}

LERTA_STATIC_STRING(negative_length, "an array of a negative length");

// Copies the item into each place, by a size that the callers give as a constant, so that the C
// compiler writes the copies as plain stores.
static inline void fill_items(uint8_t *items, int64_t length, const void *item, size_t size) {
  for (int64_t i = 0; i < length; i++) memcpy(items + i * (int64_t)size, item, size);
}

LertaArray *lerta_array_filled(LertaItemKind item_kind, int64_t length, const void *item) {
  if (length < 0) {
    lerta_raise(LERTA_VALUE_ERROR, LERTA_STR(negative_length));
    return NULL;
  }
  LertaArray *array = lerta_array_create(item_kind);
  if (length == 0) return array;
  int64_t size = lerta_item_size(item_kind);
  if (length > INT64_MAX / size) lerta_panic("out of memory");
  uint8_t *items = lerta_mem_alloc(length * size);
  uint8_t byte;
  memcpy(&byte, item, 1);
  switch (size) {
    case 1: memset(items, byte, (size_t)length); break;
    case 2: fill_items(items, length, item, 2); break;
    case 4: fill_items(items, length, item, 4); break;
    case 8: fill_items(items, length, item, 8); break;
    default: fill_items(items, length, item, 16); break;
  }
  for (int64_t i = 0; i < length; i++) lerta_retain_item(item_kind, item);
  array->items = items;
  array->length = length;
  array->capacity = length;
  return array;
}

int64_t lerta_array_length(const LertaArray *array) { return array->length; }

LERTA_STATIC_STRING(index_out_of_range, "index out of range");

void lerta_raise_index_out_of_range(void) {
  lerta_raise(LERTA_INDEX_ERROR, LERTA_STR(index_out_of_range));
}

uint8_t *lerta_array_checked_items(const LertaArray *array, int64_t index) {
  if ((uint64_t)index < (uint64_t)array->length) return array->items;
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
    lerta_raise(LERTA_INDEX_ERROR, LERTA_STR(pop_from_empty));
    return;
  }
  array->length--;
  memcpy(item, item_at(array, array->length), (size_t)lerta_item_size(array->item_kind));
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
