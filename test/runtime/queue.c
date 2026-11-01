// A LertaQueue of items wider than a pointer, shifted and pushed past its capacity again and again,
// so that it both drops the items shifted from its front and grows, keeps its items in order.
#include <stdlib.h>
#include <unistd.h>

#include "internal.h"

typedef struct {
  int64_t value;
  int64_t twice;
  int32_t thrice;
} Item;

void lerta_main(void) {
  LertaQueue queue = {0};
  int64_t pushed = 0;
  int64_t shifted = 0;
  for (int round = 0; round < 100; round++) {
    for (int i = 0; i < 7; i++, pushed++) {
      *(Item *)lerta_queue_push(&queue, sizeof(Item)) =
          (Item){pushed, 2 * pushed, (int32_t)(3 * pushed)};
    }
    for (int i = 0; i < 5; i++, shifted++) {
      Item *first = lerta_queue_front(&queue, sizeof(Item));
      if (first == NULL || first->value != shifted || first->twice != 2 * shifted ||
          first->thrice != 3 * shifted) {
        _exit(1);
      }
      lerta_queue_shift(&queue);
    }
  }
  for (; shifted < pushed; shifted++) {
    Item *first = lerta_queue_front(&queue, sizeof(Item));
    if (first == NULL || first->value != shifted) _exit(1);
    lerta_queue_shift(&queue);
  }
  if (lerta_queue_front(&queue, sizeof(Item)) != NULL) _exit(1);
  free(queue.items);
}
