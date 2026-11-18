#include <ctype.h>
#include <inttypes.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// Makes a source of lines of tokens picked by a pseudo-random generator, lexes it 10 times into
// tokens that hold their kinds and positions, then prints how many tokens of each kind there are,
// the 5 names whose first positions are the latest, and how many distinct names there are.
enum { LINES = 60000, ROUNDS = 10, TOKENS_PER_LINE = 8, VOCABULARY = 5000, SLOTS = 1 << 14 };

static const char SYMBOLS[] = "+-*/=()";

typedef enum { NAME, NUMBER, SYMBOL } Kind;
static const char *KIND_NAMES[] = {"NAME", "NUMBER", "SYMBOL"};

typedef struct {
  int32_t line;
  int32_t column;
} Position;

typedef struct {
  Kind kind;
  int32_t start;
  Position pos;
} Token;

typedef struct {
  char *name;
  Position pos;
} Entry;

static Entry table[SLOTS];
static int64_t distinct = 0;

// MINSTD, whose products fit in the integers of every language compared.
static int64_t seed = 1;
static int64_t next_random(void) {
  seed = seed * 48271 % 2147483647;
  return seed;
}

// Appends the next token's text at `out` and gives its length.
static int write_text(char *out) {
  switch (next_random() % 3) {
    case 0: return sprintf(out, "v%" PRId64, next_random() % VOCABULARY);
    case 1: return sprintf(out, "%" PRId64, next_random() % 100000);
    default: *out = SYMBOLS[next_random() % (sizeof SYMBOLS - 1)]; return 1;
  }
}

typedef struct {
  const char *bytes;
  int64_t length;
  int64_t at;
  int64_t line;
  int64_t line_start;
} Lexer;

static void skip_spaces(Lexer *l) {
  while (l->at < l->length && isspace((unsigned char)l->bytes[l->at])) {
    if (l->bytes[l->at] == '\n') {
      l->line++;
      l->line_start = l->at + 1;
    }
    l->at++;
  }
}

// The end of the name or number at `start`.
static int64_t word_end(const Lexer *l, int64_t start) {
  int64_t end = start;
  while (end < l->length && isalnum((unsigned char)l->bytes[end])) end++;
  return end;
}

static bool next_token(Lexer *l, Token *token) {
  skip_spaces(l);
  if (l->at == l->length) return false;
  int64_t start = l->at;
  unsigned char first = (unsigned char)l->bytes[start];
  Kind kind = isalpha(first) ? NAME : isdigit(first) ? NUMBER : SYMBOL;
  l->at = kind == SYMBOL ? start + 1 : word_end(l, start);
  Position pos = {(int32_t)l->line, (int32_t)(start - l->line_start + 1)};
  *token = (Token){kind, (int32_t)start, pos};
  return true;
}

static uint64_t hash(const char *name, int64_t length) {
  uint64_t h = 5381;
  for (int64_t i = 0; i < length; i++) h = h * 33 + (unsigned char)name[i];
  return h;
}

static void note_first(const char *name, int64_t length, Position pos) {
  uint64_t slot = hash(name, length) & (SLOTS - 1);
  while (table[slot].name != NULL &&
         !(strlen(table[slot].name) == (size_t)length && memcmp(table[slot].name, name, length) == 0)) {
    slot = (slot + 1) & (SLOTS - 1);
  }
  if (table[slot].name != NULL) return;
  // strndup is not in MSVC.
  table[slot].name = malloc((size_t)length + 1);
  memcpy(table[slot].name, name, (size_t)length);
  table[slot].name[length] = '\0';
  table[slot].pos = pos;
  distinct++;
}

static int by_latest(const void *a, const void *b) {
  const Entry *x = a, *y = b;
  if (x->pos.line != y->pos.line) return x->pos.line < y->pos.line ? 1 : -1;
  return x->pos.column < y->pos.column ? 1 : x->pos.column > y->pos.column ? -1 : 0;
}

int main(void) {
  char *source = malloc((size_t)LINES * TOKENS_PER_LINE * 8);
  int64_t length = 0;
  for (int64_t i = 0; i < LINES; i++) {
    if (i > 0) source[length++] = '\n';
    for (int j = 0; j < TOKENS_PER_LINE; j++) {
      if (j > 0) source[length++] = ' ';
      length += write_text(source + length);
    }
  }

  int64_t counts[3] = {0};
  for (int round = 0; round < ROUNDS; round++) {
    Lexer lexer = {source, length, 0, 1, 0};
    int64_t capacity = 1024, n = 0;
    Token *tokens = malloc(sizeof(Token) * (size_t)capacity);
    Token token;
    while (next_token(&lexer, &token)) {
      if (n == capacity) tokens = realloc(tokens, sizeof(Token) * (size_t)(capacity *= 2));
      tokens[n++] = token;
    }
    for (int64_t i = 0; i < n; i++) {
      counts[tokens[i].kind]++;
      if (tokens[i].kind == NAME) {
        int64_t start = tokens[i].start;
        note_first(source + start, word_end(&lexer, start) - start, tokens[i].pos);
      }
    }
    free(tokens);
  }

  for (int k = 0; k < 3; k++) printf("%s %" PRId64 "\n", KIND_NAMES[k], counts[k]);
  Entry *latest = malloc(sizeof(Entry) * (size_t)distinct);
  int64_t m = 0;
  for (int64_t slot = 0; slot < SLOTS; slot++) {
    if (table[slot].name != NULL) latest[m++] = table[slot];
  }
  qsort(latest, (size_t)m, sizeof(Entry), by_latest);
  for (int i = 0; i < 5; i++) printf("%s %d:%d\n", latest[i].name, latest[i].pos.line, latest[i].pos.column);
  printf("%" PRId64 "\n", distinct);
}
