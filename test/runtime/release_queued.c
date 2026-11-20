// The parent's drop releases its child twice: the first release queues it, as the parent is being
// dropped, and the second finds it there.
#include "lerta.h"

typedef struct {
  LertaHeader header;
  void *child;
} Parent;

static void drop_parent(void *object) {
  Parent *parent = object;
  lerta_release(parent->child);
  lerta_release(parent->child);
}
static const LertaType parent_type = {drop_parent, NULL, NULL};

void lerta_main(void) {
  Parent *parent = lerta_new(sizeof(Parent), &parent_type);
  parent->child = lerta_new(sizeof(LertaHeader), NULL);
  lerta_release(parent);
}
