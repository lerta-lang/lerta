#include <stdlib.h>
#include <string.h>

#include "lerta.h"

// A slot of the hash index is the position of an entry, or EMPTY. A removed entry stays in place
// (not live) until the entries are compacted, so probes pass over it.
#define EMPTY (-1)

// The splitmix64 finalizer, so that the low bits, which pick the slot, depend on every bit.
static uint64_t mix(uint64_t hash) {
  hash = (hash ^ (hash >> 30)) * 0xBF58476D1CE4E5B9u;
  hash = (hash ^ (hash >> 27)) * 0x94D049BB133111EBu;
  return hash ^ (hash >> 31);
}

static uint64_t hash_key(const LertaMap *map, int64_t key) {
  switch (map->key_kind) {
    case LERTA_STRING_KEYS: return lerta_string_hash((const LertaString *)(intptr_t)key);
    case LERTA_VALUE_KEYS: return mix(map->hash(key));
    default: return mix((uint64_t)key);
  }
}

static bool same_key(const LertaMap *map, int64_t a, int64_t b) {
  switch (map->key_kind) {
    case LERTA_STRING_KEYS:
      return lerta_string_equals((const LertaString *)(intptr_t)a,
                                 (const LertaString *)(intptr_t)b);
    case LERTA_VALUE_KEYS: return map->equals(a, b);
    default: return a == b;
  }
}

static bool keys_are_references(const LertaMap *map) { return map->key_kind != LERTA_INT_KEYS; }

static size_t value_size(const LertaMap *map) { return (size_t)lerta_item_size(map->value_kind); }

static size_t entry_size(const LertaMap *map) { return sizeof(LertaMapEntry) + value_size(map); }

static LertaMapEntry *entry_at(const LertaMap *map, int64_t position) {
  return (LertaMapEntry *)(map->entries + (size_t)position * entry_size(map));
}

static void *value_of(LertaMapEntry *entry) { return (uint8_t *)entry + sizeof(LertaMapEntry); }

static void release_entry(const LertaMap *map, LertaMapEntry *entry) {
  if (keys_are_references(map)) lerta_release((void *)(intptr_t)entry->key);
  lerta_release_item(map->value_kind, value_of(entry));
}

static void drop_map(void *object) {
  LertaMap *map = object;
  for (int64_t i = 0; i < map->entry_count; i++) {
    if (entry_at(map, i)->live) release_entry(map, entry_at(map, i));
  }
  free(map->entries);
  free(map->slots);
}

LertaMap *lerta_map_create(LertaKeyKind key_kind, LertaItemKind value_kind, LertaHash hash,
                           LertaEquals equals) {
  LertaMap *map = lerta_alloc((int64_t)sizeof(LertaMap), drop_map);
  map->length = 0;
  map->entry_count = 0;
  map->entry_capacity = 0;
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

static void *checked_alloc(size_t size) {
  void *memory = malloc(size);
  if (memory == NULL) lerta_panic("out of memory");
  return memory;
}

// Drops the removed entries and rebuilds the index with room for twice the live ones.
static void grow(LertaMap *map) {
  int64_t live = 0;
  for (int64_t i = 0; i < map->entry_count; i++) {
    if (entry_at(map, i)->live) memmove(entry_at(map, live++), entry_at(map, i), entry_size(map));
  }
  map->entry_count = live;
  int64_t capacity = 8;
  while (capacity < live * 2) capacity *= 2;
  uint8_t *entries = realloc(map->entries, (size_t)capacity * entry_size(map));
  if (entries == NULL) lerta_panic("out of memory");
  map->entries = entries;
  map->entry_capacity = capacity;
  // At most half the slots are used, so that probes stay short and always end.
  free(map->slots);
  map->slot_count = capacity * 2;
  map->slots = checked_alloc((size_t)map->slot_count * sizeof(int64_t));
  for (int64_t i = 0; i < map->slot_count; i++) map->slots[i] = EMPTY;
  for (int64_t i = 0; i < live; i++) {
    const LertaMapEntry *entry = entry_at(map, i);
    map->slots[find_slot(map, entry->key, entry->hash)] = i;
  }
}

bool lerta_map_read(const LertaMap *map, int64_t key, void *value) {
  size_t size = value_size(map);
  memset(value, 0, size);
  if (map->length == 0) return false;
  int64_t position = map->slots[find_slot(map, key, hash_key(map, key))];
  if (position == EMPTY) return false;
  memcpy(value, value_of(entry_at(map, position)), size);
  lerta_retain_item(map->value_kind, value);
  return true;
}

// The new value is retained before the old one is released, in case they are the same object.
void lerta_map_write(LertaMap *map, int64_t key, const void *value) {
  lerta_retain_item(map->value_kind, value);
  size_t size = value_size(map);
  uint64_t hash = hash_key(map, key);
  if (map->entry_count > 0) {
    int64_t position = map->slots[find_slot(map, key, hash)];
    if (position != EMPTY) {
      void *entry_value = value_of(entry_at(map, position));
      LertaItem old;
      memcpy(&old, entry_value, size);
      memcpy(entry_value, value, size);
      lerta_release_item(map->value_kind, &old);
      return;
    }
  }
  if (map->entry_count == map->entry_capacity) grow(map);
  if (keys_are_references(map)) lerta_retain((void *)(intptr_t)key);
  int64_t position = map->entry_count++;
  LertaMapEntry *entry = entry_at(map, position);
  *entry = (LertaMapEntry){key, hash, true};
  memcpy(value_of(entry), value, size);
  map->slots[find_slot(map, key, hash)] = position;
  map->length++;
}

void lerta_map_remove(LertaMap *map, int64_t key) {
  if (map->length == 0) return;
  int64_t position = map->slots[find_slot(map, key, hash_key(map, key))];
  if (position == EMPTY) return;
  LertaMapEntry *entry = entry_at(map, position);
  entry->live = false;
  map->length--;
  release_entry(map, entry);
}

LertaArray *lerta_map_keys(const LertaMap *map) {
  LertaItemKind kind = keys_are_references(map) ? LERTA_REFERENCE_ITEMS : LERTA_PLAIN_ITEMS;
  LertaArray *keys = lerta_array_create(kind);
  for (int64_t i = 0; i < map->entry_count; i++) {
    const LertaMapEntry *entry = entry_at(map, i);
    if (entry->live) lerta_array_append(keys, &entry->key);
  }
  return keys;
}

// The 8-byte value API that the seed's generated code calls, over the one above, until the seed
// is refreshed (see docs/internals.md#bootstrap).
LertaMap *lerta_map_new(LertaKeyKind key_kind, bool owns_values, LertaHash hash,
                        LertaEquals equals) {
  LertaItemKind kind = owns_values ? LERTA_REFERENCE_ITEMS : LERTA_PLAIN_ITEMS;
  return lerta_map_create(key_kind, kind, hash, equals);
}

bool lerta_map_get(const LertaMap *map, int64_t key, int64_t *value) {
  return lerta_map_read(map, key, value);
}

void lerta_map_set(LertaMap *map, int64_t key, int64_t value) { lerta_map_write(map, key, &value); }
