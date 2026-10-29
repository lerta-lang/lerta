#include <stdbool.h>
#include <stdio.h>

// Adds up, over a number of rounds, the items of lazy pipelines of filters and maps over a generator
// of pseudo-random numbers, with functions that capture the round, and prints the total.
#define ROUNDS 20
#define COUNT 1000000

// A lazy sequence: next gives whether there is an item, and stores it.
typedef struct Iter {
  bool (*next)(struct Iter *iter, long *item);
} Iter;

// MINSTD from the seed, whose products fit in the integers of every language compared.
typedef struct {
  Iter iter;
  long state, left;
} Randoms;

static bool randoms_next(Iter *iter, long *item) {
  Randoms *randoms = (Randoms *)iter;
  if (randoms->left == 0) return false;
  randoms->left--;
  randoms->state = randoms->state * 48271 % 2147483647;
  *item = randoms->state;
  return true;
}

// A function of an item and what it captures.
typedef struct {
  long (*call)(long captured, long x);
  long captured;
} Closure;

typedef struct {
  Iter iter;
  Iter *source;
  Closure keep;
} Filter;

static bool filter_next(Iter *iter, long *item) {
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

static bool map_next(Iter *iter, long *item) {
  Map *map = (Map *)iter;
  if (!map->source->next(map->source, item)) return false;
  *item = map->transform.call(map->transform.captured, *item);
  return true;
}

static long sum(Iter *iter) {
  long total = 0, item;
  while (iter->next(iter, &item)) total += item;
  return total;
}

static long fold(Iter *iter, long initial, long (*combine)(long, long)) {
  long result = initial, item;
  while (iter->next(iter, &item)) result = combine(result, item);
  return result;
}

static long not_multiple(long k, long x) { return x % k != 0; }
static long reduce_plus(long k, long x) { return x % 1000 + k; }
static long is_even(long unused, long x) { return x % 2 == 0; }
static long times_seven(long unused, long x) { return x % 1000 * 7; }
static long add(long a, long b) { return a + b; }

int main(void) {
  long total = 0;
  for (long k = 1; k <= ROUNDS; k++) {
    Randoms randoms = {{randoms_next}, k, COUNT};
    Filter filter = {{filter_next}, &randoms.iter, {not_multiple, k}};
    Map map = {{map_next}, &filter.iter, {reduce_plus, k}};
    total += sum(&map.iter);
    Randoms more = {{randoms_next}, k, COUNT};
    Filter evens = {{filter_next}, &more.iter, {is_even, 0}};
    Map sevens = {{map_next}, &evens.iter, {times_seven, 0}};
    total += fold(&sevens.iter, 0, add);
  }
  printf("%ld\n", total);
  return 0;
}
