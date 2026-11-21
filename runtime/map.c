#include <stdlib.h>
#include <string.h>

#include "internal.h"

// A removed entry stays in place until the entries are compacted, so that probes pass over it.
#define EMPTY (-1)

// The splitmix64 finalizer, so that the low bits, which pick the slot, depend on every bit.
static uint64_t mix(uint64_t hash) {
  hash = (hash ^ (hash >> 30)) * 0xBF58476D1CE4E5B9u;
  hash = (hash ^ (hash >> 27)) * 0x94D049BB133111EBu;
  return hash ^ (hash >> 31);
}

// The program's own hash and equals, of value keys and of values, may run any code, which must not
// change the map meanwhile: its search, or its comparison, would go on with entries freed or moved.
static void start_comparing(const LertaMap *map) { ((LertaMap *)map)->comparing++; }
static void stop_comparing(const LertaMap *map) { ((LertaMap *)map)->comparing--; }

static void check_not_comparing(const LertaMap *map) {
  if (map->comparing > 0) lerta_panic("a map changed while its keys or values were compared");
}

static uint64_t hash_key(const LertaMap *map, int64_t key) {
  switch (map->key_kind) {
    case LERTA_STRING_KEYS: return lerta_string_hash((const LertaString *)(intptr_t)key);
    case LERTA_VALUE_KEYS: {
      start_comparing(map);
      uint64_t hash = map->hash(key);
      stop_comparing(map);
      return mix(hash);
    }
    default: return mix((uint64_t)key);
  }
}

static bool same_key(const LertaMap *map, int64_t a, int64_t b) {
  switch (map->key_kind) {
    case LERTA_STRING_KEYS:
      return lerta_string_equals((const LertaString *)(intptr_t)a,
                                 (const LertaString *)(intptr_t)b);
    case LERTA_VALUE_KEYS: {
      start_comparing(map);
      bool same = map->equals(a, b);
      stop_comparing(map);
      return same;
    }
    default: return a == b;
  }
}

static bool keys_are_references(const LertaMap *map) {
  return map->key_kind != LERTA_INT_KEYS && !(map->key_kind & LERTA_INTEGER_KEYS);
}

static size_t value_size(const LertaMap *map) { return (size_t)lerta_item_size(map->value_kind); }

// Rounded up to 8 bytes, so that each entry's key stays aligned after a value of one byte.
static size_t entry_size(const LertaMap *map) {
  return (sizeof(LertaMapEntry) + value_size(map) + 7) & ~(size_t)7;
}

// The entry at the position, where each entry takes `size` bytes from `entries`.
static LertaMapEntry *entry_in(uint8_t *entries, size_t size, int64_t position) {
  return (LertaMapEntry *)(entries + (size_t)position * size);
}

static LertaMapEntry *entry_at(const LertaMap *map, int64_t position) {
  return entry_in(map->entries, entry_size(map), position);
}

static void *value_of(LertaMapEntry *entry) { return (uint8_t *)entry + sizeof(LertaMapEntry); }

// The references of an entry of a map whose keys are references if `keys` and whose values are of
// the kind.
static inline void visit_entry(bool keys, LertaItemKind kind, LertaMapEntry *entry,
                               LertaVisitor visitor) {
  if (keys) visitor((void *)(intptr_t)entry->key);
  lerta_visit_item(kind, value_of(entry), visitor);
}

// Released from a copy: each release may run a deinit that adds to the map, moving its entries.
static void release_entry(const LertaMap *map, const LertaMapEntry *entry) {
  struct {
    LertaMapEntry entry;
    LertaItem value;
  } held;
  memcpy(&held, entry, sizeof(LertaMapEntry) + value_size(map));
  visit_entry(keys_are_references(map), map->value_kind, &held.entry, lerta_release);
}

// What the loop needs of the map is read before it, as LLVM would read it again after each call
// of the visitor, which might change the map as far as it knows.
static inline void visit_map(void *object, LertaVisitor visitor) {
  LertaMap *map = object;
  int64_t count = map->entry_count;
  uint8_t *entries = map->entries;
  size_t size = entry_size(map);
  bool keys = keys_are_references(map);
  LertaItemKind kind = map->value_kind;
  for (int64_t i = 0; i < count; i++) {
    LertaMapEntry *entry = entry_in(entries, size, i);
    if (entry->live) visit_entry(keys, kind, entry, visitor);
  }
}

static void drop_map(void *object) {
  visit_map(object, lerta_release);
  LertaMap *map = object;
  lerta_mem_free(map->entries);
  lerta_mem_free(map->slots);
}

LERTA_STATIC_STRING(map_name, "Map");
const LertaType lerta_map_type = {drop_map, visit_map, LERTA_STR(map_name)};

LertaMap *lerta_map_create(LertaKeyKind key_kind, LertaItemKind value_kind, LertaHash hash,
                           LertaEquals equals) {
  LertaMap *map = lerta_new((int64_t)sizeof(LertaMap), &lerta_map_type);
  map->length = 0;
  map->entry_count = 0;
  map->entry_capacity = 0;
  map->cursors = 0;
  map->comparing = 0;
  map->entries = NULL;
  map->slot_count = 0;
  map->slots = NULL;
  map->key_kind = key_kind;
  map->value_kind = value_kind;
  map->hash = hash;
  map->equals = equals;
  return map;
}

int64_t lerta_map_length(const LertaMap *map) { return map->length; }

// The slot that holds the live entry with the key, or EMPTY's slot where it would go.
static int64_t find_slot(const LertaMap *map, int64_t key, uint64_t hash) {
  uint64_t mask = (uint64_t)map->slot_count - 1;
  for (uint64_t i = hash & mask;; i = (i + 1) & mask) {
    int64_t position = map->slots[i];
    if (position == EMPTY) return (int64_t)i;
    const LertaMapEntry *entry = entry_at(map, position);
    if (entry->live && entry->hash == hash && same_key(map, entry->key, key)) return (int64_t)i;
  }
}

static void grow(LertaMap *map) {
  if (map->cursors == 0) {
    int64_t live = 0;
    for (int64_t i = 0; i < map->entry_count; i++) {
      if (entry_at(map, i)->live) memmove(entry_at(map, live++), entry_at(map, i), entry_size(map));
    }
    map->entry_count = live;
  }
  int64_t kept = map->entry_count;
  int64_t capacity = 8;
  while (capacity < kept * 2) capacity *= 2;
  map->entries = lerta_mem_realloc(map->entries, capacity * (int64_t)entry_size(map));
  map->entry_capacity = capacity;
  // At most half the slots are used, so that probes stay short and always end.
  lerta_mem_free(map->slots);
  map->slot_count = capacity * 2;
  map->slots = lerta_mem_alloc(map->slot_count * (int64_t)sizeof(int64_t));
  for (int64_t i = 0; i < map->slot_count; i++) map->slots[i] = EMPTY;
  for (int64_t i = 0; i < kept; i++) {
    const LertaMapEntry *entry = entry_at(map, i);
    if (entry->live) map->slots[find_slot(map, entry->key, entry->hash)] = i;
  }
}

void *lerta_map_find(const LertaMap *map, int64_t key) {
  if (map->length == 0) return NULL;
  int64_t position = map->slots[find_slot(map, key, hash_key(map, key))];
  return position == EMPTY ? NULL : value_of(entry_at(map, position));
}

void *lerta_map_place(LertaMap *map, int64_t key) {
  check_not_comparing(map);
  uint64_t hash = hash_key(map, key);
  if (map->entry_count > 0) {
    int64_t position = map->slots[find_slot(map, key, hash)];
    if (position != EMPTY) return value_of(entry_at(map, position));
  }
  if (map->entry_count == map->entry_capacity) grow(map);
  if (keys_are_references(map)) lerta_retain((void *)(intptr_t)key);
  int64_t position = map->entry_count++;
  LertaMapEntry *entry = entry_at(map, position);
  *entry = (LertaMapEntry){key, hash, true};
  memset(value_of(entry), 0, value_size(map));
  map->slots[find_slot(map, key, hash)] = position;
  map->length++;
  return value_of(entry);
}

// Tells whether the key was there, which the release of its value, running a deinit that may
// change the map, cannot change.
bool lerta_map_remove(LertaMap *map, int64_t key) {
  check_not_comparing(map);
  if (map->length == 0) return false;
  int64_t position = map->slots[find_slot(map, key, hash_key(map, key))];
  if (position == EMPTY) return false;
  LertaMapEntry *entry = entry_at(map, position);
  entry->live = false;
  map->length--;
  release_entry(map, entry);
  return true;
}

struct LertaMapCursor {
  LertaHeader header;
  LertaMap *map;
  int64_t position;
  int64_t end;
};

bool lerta_map_equals(const LertaMap *a, const LertaMap *b, LertaEquals values) {
  if (a->length != b->length) return false;
  start_comparing(a);
  start_comparing(b);
  bool same = true;
  for (int64_t i = 0; same && i < a->entry_count; i++) {
    LertaMapEntry *entry = entry_at(a, i);
    if (!entry->live) continue;
    void *other = lerta_map_find(b, entry->key);
    if (!other) {
      same = false;
    } else if (values) {
      int64_t value = lerta_item_word(a->value_kind, value_of(entry));
      same = values(value, lerta_item_word(b->value_kind, other));
    }
  }
  stop_comparing(a);
  stop_comparing(b);
  return same;
}

static inline void visit_cursor(void *object, LertaVisitor visitor) {
  visitor(((LertaMapCursor *)object)->map);
}

static void drop_cursor(void *object) {
  ((LertaMapCursor *)object)->map->cursors--;
  visit_cursor(object, lerta_release);
}

LERTA_STATIC_STRING(cursor_name, "Map cursor");
static const LertaType cursor_type = {drop_cursor, visit_cursor, LERTA_STR(cursor_name)};

LertaMapCursor *lerta_map_cursor(LertaMap *map) {
  LertaMapCursor *cursor = lerta_new((int64_t)sizeof(LertaMapCursor), &cursor_type);
  lerta_retain(map);
  map->cursors++;
  cursor->map = map;
  cursor->position = 0;
  cursor->end = map->entry_count;
  return cursor;
}

bool lerta_map_cursor_has_next(LertaMapCursor *cursor) {
  const LertaMap *map = cursor->map;
  while (cursor->position < cursor->end && !entry_at(map, cursor->position)->live) {
    cursor->position++;
  }
  return cursor->position < cursor->end;
}

void lerta_map_cursor_next(LertaMapCursor *cursor, int64_t *key, void *value) {
  const LertaMap *map = cursor->map;
  LertaMapEntry *entry = entry_at(map, cursor->position++);
  *key = entry->key;
  if (keys_are_references(map)) lerta_retain((void *)(intptr_t)entry->key);
  if (value == NULL) return;
  memcpy(value, value_of(entry), value_size(map));
  lerta_retain_item(map->value_kind, value);
}
