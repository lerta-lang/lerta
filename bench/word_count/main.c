#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// Makes lines of 8 words picked by a pseudo-random generator, splits each line back into its words
// and counts them, then prints the 5 most frequent words, by count and then by word, and how many
// words there are.
enum { LINES = 1000000, WORDS_PER_LINE = 8, VOCABULARY = 5000, SLOTS = 1 << 14 };

typedef struct {
  char *word;
  int64_t count;
} Entry;

static Entry table[SLOTS];
static int64_t distinct = 0;

// MINSTD, whose products fit in the integers of every language compared.
static int64_t seed = 1;
static int64_t next_word(void) {
  seed = seed * 48271 % 2147483647;
  return seed % VOCABULARY;
}

static uint64_t hash(const char *word) {
  uint64_t h = 5381;
  for (; *word != '\0'; word++) h = h * 33 + (unsigned char)*word;
  return h;
}

static void count(const char *word) {
  uint64_t slot = hash(word) & (SLOTS - 1);
  while (table[slot].word != NULL && strcmp(table[slot].word, word) != 0) {
    slot = (slot + 1) & (SLOTS - 1);
  }
  if (table[slot].word == NULL) {
    table[slot].word = strdup(word);
    distinct++;
  }
  table[slot].count++;
}

static int by_frequency(const void *a, const void *b) {
  const Entry *x = a, *y = b;
  if (x->count != y->count) return x->count < y->count ? 1 : -1;
  return strcmp(x->word, y->word);
}

int main(void) {
  char line[WORDS_PER_LINE * 8];
  for (int64_t i = 0; i < LINES; i++) {
    int length = 0;
    for (int j = 0; j < WORDS_PER_LINE; j++) {
      length += sprintf(line + length, j == 0 ? "w%" PRId64 : " w%" PRId64, next_word());
    }
    for (char *word = strtok(line, " "); word != NULL; word = strtok(NULL, " ")) count(word);
  }
  Entry *ranked = malloc(sizeof(Entry) * (size_t)distinct);
  int64_t n = 0;
  for (int64_t slot = 0; slot < SLOTS; slot++) {
    if (table[slot].word != NULL) ranked[n++] = table[slot];
  }
  qsort(ranked, (size_t)n, sizeof(Entry), by_frequency);
  for (int i = 0; i < 5; i++) printf("%s %" PRId64 "\n", ranked[i].word, ranked[i].count);
  printf("%" PRId64 "\n", distinct);
}
