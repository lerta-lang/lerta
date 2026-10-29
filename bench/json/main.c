#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// Makes the JSON text of an array of objects picked by a pseudo-random generator, parses it a
// number of times into values of arrays, objects, integers, strings and booleans, and prints a sum
// over each value parsed. The parser takes only what the text holds: no floats, escapes, nulls or
// errors.
#define OBJECTS 200000
#define PARSES 5

typedef enum { INT, STRING, BOOL, ARRAY, OBJECT } Kind;

typedef struct Json Json;

typedef struct {
  char *key; // NULL for an empty slot
  Json *value;
} Field;

// An object's fields, in a hash table of open addressing, as the maps of the other languages are.
typedef struct {
  Field *slots;
  long capacity, length;
} Fields;

typedef struct {
  Json **items;
  long capacity, length;
} Items;

struct Json {
  Kind kind;
  union {
    long integer;
    bool boolean;
    struct {
      char *bytes;
      long length;
    } string;
    Items array;
    Fields object;
  };
};

// MINSTD, whose products fit in the integers of every language compared.
static long seed = 1;
static long next_random(void) {
  seed = seed * 48271 % 2147483647;
  return seed;
}

typedef struct {
  char *bytes;
  long length, capacity;
} Text;

static void reserve(Text *text, long room) {
  if (text->length + room <= text->capacity) return;
  text->capacity = (text->length + room) * 2;
  text->bytes = realloc(text->bytes, text->capacity);
}

static void append(Text *text, const char *literal) {
  long length = strlen(literal);
  reserve(text, length + 1);
  memcpy(text->bytes + text->length, literal, length + 1);
  text->length += length;
}

// Appends the format with the number, which it holds once.
static void append_number(Text *text, const char *format, long value) {
  reserve(text, strlen(format) + 20);
  text->length += sprintf(text->bytes + text->length, format, value);
}

static Text make_text(void) {
  Text text = {malloc(16), 0, 16};
  append(&text, "[");
  for (long i = 0; i < OBJECTS; i++) {
    if (i > 0) append(&text, ", ");
    long id = next_random() % 1000000;
    long name = next_random() % 5000;
    append_number(&text, "{\"id\": %ld, ", id);
    append_number(&text, "\"name\": \"w%ld\", \"tags\": [", name);
    long tags = next_random() % 4;
    for (long t = 0; t < tags; t++) {
      if (t > 0) append(&text, ", ");
      append_number(&text, "\"t%ld\"", next_random() % 100);
    }
    bool active = next_random() % 2 == 0;
    append(&text, active ? "], \"active\": true}" : "], \"active\": false}");
  }
  append(&text, "]");
  return text;
}

static Json *new_json(Kind kind) {
  Json *json = calloc(1, sizeof(Json));
  json->kind = kind;
  return json;
}

static void push(Items *items, Json *item) {
  if (items->length == items->capacity) {
    items->capacity = items->capacity == 0 ? 4 : items->capacity * 2;
    items->items = realloc(items->items, items->capacity * sizeof(Json *));
  }
  items->items[items->length++] = item;
}

static uint64_t hash(const char *key) {
  uint64_t h = 14695981039346656037u; // FNV-1a
  for (; *key; key++) h = (h ^ (unsigned char)*key) * 1099511628211u;
  return h;
}

static void put_slot(Fields *fields, char *key, Json *value) {
  long mask = fields->capacity - 1;
  long i = hash(key) & mask;
  while (fields->slots[i].key != NULL && strcmp(fields->slots[i].key, key) != 0) i = (i + 1) & mask;
  if (fields->slots[i].key == NULL) fields->length++;
  fields->slots[i] = (Field){key, value};
}

static void put(Fields *fields, char *key, Json *value) {
  if ((fields->length + 1) * 4 > fields->capacity * 3) {
    Fields grown = {calloc(fields->capacity == 0 ? 8 : fields->capacity * 2, sizeof(Field)),
                    fields->capacity == 0 ? 8 : fields->capacity * 2, 0};
    for (long i = 0; i < fields->capacity; i++)
      if (fields->slots[i].key != NULL) put_slot(&grown, fields->slots[i].key, fields->slots[i].value);
    free(fields->slots);
    *fields = grown;
  }
  put_slot(fields, key, value);
}

// Each part read skips the spaces after it, so that the next starts at its first byte.
typedef struct {
  const char *bytes;
  long length, position;
} Parser;

static void skip_spaces(Parser *p) {
  while (p->position < p->length && p->bytes[p->position] == ' ') p->position++;
}

// Skips a punctuation byte, as `[` or `,`, which the text has at the position.
static void skip_byte(Parser *p) {
  p->position++;
  skip_spaces(p);
}

static Json *parse_value(Parser *p);

static Json *parse_word(Parser *p, long length, bool value) {
  p->position += length;
  skip_spaces(p);
  Json *json = new_json(BOOL);
  json->boolean = value;
  return json;
}

static Json *parse_array(Parser *p) {
  skip_byte(p);
  Json *json = new_json(ARRAY);
  if (p->bytes[p->position] != ']') {
    push(&json->array, parse_value(p));
    while (p->bytes[p->position] == ',') {
      skip_byte(p);
      push(&json->array, parse_value(p));
    }
  }
  skip_byte(p);
  return json;
}

static char *parse_key(Parser *p) {
  long start = p->position + 1;
  p->position = start;
  while (p->bytes[p->position] != '"') p->position++;
  char *key = strndup(p->bytes + start, p->position - start);
  skip_byte(p);
  return key;
}

static void parse_field(Parser *p, Fields *fields) {
  char *key = parse_key(p);
  skip_byte(p);
  put(fields, key, parse_value(p));
}

static Json *parse_object(Parser *p) {
  skip_byte(p);
  Json *json = new_json(OBJECT);
  if (p->bytes[p->position] != '}') {
    parse_field(p, &json->object);
    while (p->bytes[p->position] == ',') {
      skip_byte(p);
      parse_field(p, &json->object);
    }
  }
  skip_byte(p);
  return json;
}

static Json *parse_string(Parser *p) {
  char *bytes = parse_key(p);
  Json *json = new_json(STRING);
  json->string.bytes = bytes;
  json->string.length = strlen(bytes);
  return json;
}

static Json *parse_int(Parser *p) {
  long value = 0;
  while (p->bytes[p->position] >= '0' && p->bytes[p->position] <= '9') {
    value = value * 10 + (p->bytes[p->position] - '0');
    p->position++;
  }
  skip_spaces(p);
  Json *json = new_json(INT);
  json->integer = value;
  return json;
}

static Json *parse_value(Parser *p) {
  switch (p->bytes[p->position]) {
  case '[': return parse_array(p);
  case '{': return parse_object(p);
  case '"': return parse_string(p);
  case 't': return parse_word(p, 4, true);
  case 'f': return parse_word(p, 5, false);
  default: return parse_int(p);
  }
}

// The integers, the lengths of the strings, the true booleans and the items and fields, added up.
static long sum(const Json *json) {
  switch (json->kind) {
  case INT: return json->integer;
  case STRING: return json->string.length;
  case BOOL: return json->boolean ? 1 : 0;
  case ARRAY: {
    long total = json->array.length;
    for (long i = 0; i < json->array.length; i++) total += sum(json->array.items[i]);
    return total;
  }
  case OBJECT: {
    long total = json->object.length;
    for (long i = 0; i < json->object.capacity; i++)
      if (json->object.slots[i].key != NULL) total += sum(json->object.slots[i].value);
    return total;
  }
  }
  return 0;
}

static void drop(Json *json) {
  switch (json->kind) {
  case STRING: free(json->string.bytes); break;
  case ARRAY:
    for (long i = 0; i < json->array.length; i++) drop(json->array.items[i]);
    free(json->array.items);
    break;
  case OBJECT:
    for (long i = 0; i < json->object.capacity; i++) {
      if (json->object.slots[i].key == NULL) continue;
      free(json->object.slots[i].key);
      drop(json->object.slots[i].value);
    }
    free(json->object.slots);
    break;
  default: break;
  }
  free(json);
}

int main(void) {
  Text text = make_text();
  long total = 0;
  for (int i = 0; i < PARSES; i++) {
    Parser parser = {text.bytes, text.length, 0};
    Json *json = parse_value(&parser);
    total += sum(json);
    drop(json);
  }
  printf("%ld\n", total);
  free(text.bytes);
  return 0;
}
