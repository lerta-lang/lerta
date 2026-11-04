#include <inttypes.h>
#include <stdbool.h>
#include <stdio.h>

// Adds up, over a number of rounds, the items of lazy pipelines of filters and maps over a generator
// of pseudo-random numbers, with functions that capture the round, and prints the total.
#define ROUNDS 20
#define COUNT 1000000

// A lazy sequence: next gives whether there is an item, and stores it.
typedef struct Iter {
  bool (*next)(struct Iter *iter, int64_t *item);
} Iter;

// MINSTD from the seed, whose products fit in the integers of every language compared.
typedef struct {
  Iter iter;
  int64_t state, left;
} Randoms;

static bool randoms_next(Iter *iter, int64_t *item) {
  Randoms *randoms = (Randoms *)iter;
  if (randoms->left == 0) return false;
  randoms->left--;
  randoms->state = randoms->state * 48271 % 2147483647;
  *item = randoms->state;
  return true;
}

// A function of an item and what it captures.
typedef struct {
  int64_t (*call)(int64_t captured, int64_t x);
  int64_t captured;
} Closure;

typedef struct {
  Iter iter;
  Iter *source;
  Closure keep;
} Filter;

static bool filter_next(Iter *iter, int64_t *item) {
  Filter *filter = (Filter *)iter;
  while (filter->source->next(filter->source, item))
    if (filter->keep.call(filter->keep.captured, *item)) return true;
  return false;
}

typedef struct {
  Iter iter;
  Iter *source;
  Closure transform;
} Map;

static bool map_next(Iter *iter, int64_t *item) {
  Map *map = (Map *)iter;
  if (!map->source->next(map->source, item)) return false;
  *item = map->transform.call(map->transform.captured, *item);
  return true;
}

static int64_t sum(Iter *iter) {
  int64_t total = 0, item;
  while (iter->next(iter, &item)) total += item;
  return total;
}

static int64_t fold(Iter *iter, int64_t initial, int64_t (*combine)(int64_t, int64_t)) {
  int64_t result = initial, item;
  while (iter->next(iter, &item)) result = combine(result, item);
  return result;
}

static int64_t not_multiple(int64_t k, int64_t x) { return x % k != 0; }
static int64_t reduce_plus(int64_t k, int64_t x) { return x % 1000 + k; }
static int64_t is_even(int64_t unused, int64_t x) { return x % 2 == 0; }
static int64_t times_seven(int64_t unused, int64_t x) { return x % 1000 * 7; }
static int64_t add(int64_t a, int64_t b) { return a + b; }

int main(void) {
  int64_t total = 0;
  for (int64_t k = 1; k <= ROUNDS; k++) {
    Randoms randoms = {{randoms_next}, k, COUNT};
    Filter filter = {{filter_next}, &randoms.iter, {not_multiple, k}};
    Map map = {{map_next}, &filter.iter, {reduce_plus, k}};
    total += sum(&map.iter);
    Randoms more = {{randoms_next}, k, COUNT};
    Filter evens = {{filter_next}, &more.iter, {is_even, 0}};
    Map sevens = {{map_next}, &evens.iter, {times_seven, 0}};
    total += fold(&sevens.iter, 0, add);
  }
  printf("%" PRId64 "\n", total);
  return 0;
}
