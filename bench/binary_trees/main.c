#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>

// Builds complete binary trees of growing depths many times, counting the nodes of each before
// dropping it, while one long-lived tree is kept, and prints the count of all the nodes.
typedef struct Node {
  struct Node *left, *right;
} Node;

static Node *make(int depth) {
  Node *node = malloc(sizeof(Node));
  node->left = depth == 0 ? NULL : make(depth - 1);
  node->right = depth == 0 ? NULL : make(depth - 1);
  return node;
}

static int64_t check(const Node *node) {
  if (node->left == NULL || node->right == NULL) return 1;
  return 1 + check(node->left) + check(node->right);
}

static void drop(Node *node) {
  if (node == NULL) return;
  drop(node->left);
  drop(node->right);
  free(node);
}

int main(void) {
  const int max_depth = 16;
  Node *long_lived = make(max_depth);
  int64_t total = 0;
  for (int depth = 4; depth <= max_depth; depth += 2) {
    int64_t iterations = INT64_C(16) << (max_depth - depth);
    for (int64_t i = 0; i < iterations; i++) {
      Node *tree = make(depth);
      total += check(tree);
      drop(tree);
    }
  }
  printf("%" PRId64 "\n", total + check(long_lived));
  drop(long_lived);
}
