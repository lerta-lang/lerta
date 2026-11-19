#include <stdlib.h>
#include <string.h>

#include "internal.h"

LERTA_STATIC_STRING(pop_from_empty, "pop from an empty array");

int64_t lerta_item_size(LertaItemKind kind) {
  if (kind & LERTA_MASKED_ITEMS) return kind & LERTA_WIDE_ITEMS ? 16 : 8;
  if (kind & LERTA_INTEGER_ITEMS) return kind & LERTA_ITEM_BYTES;
  if (kind == LERTA_NO_ITEMS) return 0;
  lerta_panic("unknown item kind");
}

// The places of the pointers in an item that hold references, a bit each, the first the lowest.
static unsigned reference_places(LertaItemKind kind) {
  return (kind & LERTA_REFERENCE_PLACES) >> 8;
}

static bool holds_references(LertaItemKind kind) { return reference_places(kind) != 0; }

// The references of a value at more places than the first. Kept out of the callers, so that those
// stay small enough for LLVM to inline.
__attribute__((noinline)) static void visit_references_at(unsigned places, const void *item,
                                                          LertaVisitor visitor) {
  for (int place = 0; places; place++, places >>= 1) {
    if (!(places & 1)) continue;
    void *reference;
    memcpy(&reference, (const uint8_t *)item + place * sizeof reference, sizeof reference);
    visitor(reference);
  }
}

// An item of a reference at the first place alone, the most common, a reference or an interface
// value's data, costs no loop.
static inline void visit_references(LertaItemKind kind, const void *item, LertaVisitor visitor) {
  unsigned places = reference_places(kind);
  if (places == 1) {
    void *reference;
    memcpy(&reference, item, sizeof reference);
    visitor(reference);
  } else if (places) {
    visit_references_at(places, item, visitor);
  }
}

void lerta_visit_item(LertaItemKind kind, const void *item, LertaVisitor visitor) {
  visit_references(kind, item, visitor);
}

void lerta_retain_item(LertaItemKind kind, const void *item) {
  visit_references(kind, item, lerta_retain);
}

void lerta_release_item(LertaItemKind kind, const void *item) {
  visit_references(kind, item, lerta_release);
}

static uint8_t *item_at(const LertaArray *array, int64_t index) {
  return array->items + index * lerta_item_size(array->item_kind);
}

// The targets are all little-endian, so that an item narrower than a word is the word's first
// bytes, which an integer item's sign extends.
static int64_t word_of(LertaItemKind kind, const void *item) {
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

int64_t lerta_word_item(const LertaArray *array, int64_t index) {
  return word_of(array->item_kind, item_at(array, index));
}

// A masked item is given by its address, which the generated code reads it through (see
// compiler/codegen/items.lerta); an integer item as its word.
int64_t lerta_item_word(LertaItemKind kind, const void *item) {
  if (kind & LERTA_MASKED_ITEMS) return (int64_t)(intptr_t)item;
  return word_of(kind, item);
}

static inline void visit_array(void *object, LertaVisitor visitor) {
  LertaArray *array = object;
  // Items that hold no reference would each be visited as NULL; the C compiler does not always drop
  // that loop, which costs a pass over a long array of numbers.
  if (!holds_references(array->item_kind)) return;
  for (int64_t i = 0; i < array->length; i++) {
    visit_references(array->item_kind, item_at(array, i), visitor);
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

LERTA_STATIC_STRING(slice_out_of_range, "slice out of range");

LertaArray *lerta_array_slice(const LertaArray *array, int64_t start, int64_t end) {
  if (start < 0 || start > end || end > array->length) {
    lerta_raise(LERTA_INDEX_ERROR, LERTA_STR(slice_out_of_range));
    return NULL;
  }
  LertaItemKind kind = array->item_kind;
  LertaArray *slice = lerta_array_create(kind);
  int64_t length = end - start;
  if (length == 0) return slice;
  int64_t size = lerta_item_size(kind);
  uint8_t *items = lerta_mem_alloc(length * size);
  memcpy(items, item_at(array, start), (size_t)(length * size));
  for (int64_t i = 0; i < length; i++) lerta_retain_item(kind, items + i * size);
  slice->items = items;
  slice->length = length;
  slice->capacity = length;
  return slice;
}

uint8_t *lerta_array_checked_items(const LertaArray *array, int64_t index) {
  if ((uint64_t)index < (uint64_t)array->length) {
    // An array with any items has them allocated, so items is not NULL here. Telling LLVM so drops
    // the generated code's check of the result for NULL, its sign of the exception, from the loops
    // that index arrays.
    __builtin_assume(array->items != NULL);
    return array->items;
  }
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

// An item that the program's own `equals` or `hash` is given is copied and held across the call, as
// the call may remove items of the array, which would free them. As the call may change the array's
// length too, the callers check it again at each item.
static LertaItem hold_item(const LertaArray *array, int64_t index) {
  LertaItem item;
  memcpy(&item, item_at(array, index), (size_t)lerta_item_size(array->item_kind));
  lerta_retain_item(array->item_kind, &item);
  return item;
}

static bool same_items(const LertaArray *a, const LertaArray *b, int64_t index, LertaEquals equals) {
  LertaItem a_item = hold_item(a, index);
  LertaItem b_item = hold_item(b, index);
  bool same =
      equals(lerta_item_word(a->item_kind, &a_item), lerta_item_word(b->item_kind, &b_item));
  lerta_release_item(a->item_kind, &a_item);
  lerta_release_item(b->item_kind, &b_item);
  return same;
}

static uint64_t item_hash(const LertaArray *array, int64_t index, LertaHash hash) {
  LertaItem item = hold_item(array, index);
  uint64_t result = hash(lerta_item_word(array->item_kind, &item));
  lerta_release_item(array->item_kind, &item);
  return result;
}

bool lerta_array_equals(const LertaArray *a, const LertaArray *b, LertaEquals equals) {
  if (a->length != b->length) return false;
  for (int64_t i = 0; i < a->length; i++) {
    if (i >= b->length || !same_items(a, b, i, equals)) return false;
  }
  return a->length == b->length;
}

uint64_t lerta_array_hash(const LertaArray *array, LertaHash hash) {
  uint64_t result = (uint64_t)array->length;
  for (int64_t i = 0; i < array->length; i++) {
    result = result * 31 + item_hash(array, i, hash);
  }
  return result;
}
