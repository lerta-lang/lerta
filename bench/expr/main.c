#include <stdio.h>
#include <stdlib.h>

// Builds an expression tree of one variable picked by a pseudo-random generator, evaluates it
// modulo a prime for many values of the variable, and prints the sum of the values modulo the prime.
#define DEPTH 22
#define VALUES 150
#define MODULUS 1000003

typedef enum { NUM, VAR, ADD, MUL, NEG } Kind;

typedef struct Expr {
  Kind kind;
  long value; // the number of a NUM, the coefficient of a VAR
  struct Expr *left, *right; // the operands of an ADD or a MUL, and the operand of a NEG on the left
} Expr;

// MINSTD, whose products fit in the integers of every language compared.
static long seed = 1;
static long next_random(void) {
  seed = seed * 48271 % 2147483647;
  return seed;
}

static Expr *new_expr(Kind kind, long value, Expr *left, Expr *right) {
  Expr *expr = malloc(sizeof(Expr));
  *expr = (Expr){kind, value, left, right};
  return expr;
}

static Expr *make(int depth) {
  if (depth == 0) {
    int is_num = next_random() % 2 == 0;
    long digit = next_random() % 10;
    return new_expr(is_num ? NUM : VAR, digit, NULL, NULL);
  }
  switch (next_random() % 3) {
  case 0: {
    Expr *left = make(depth - 1);
    return new_expr(ADD, 0, left, make(depth - 1));
  }
  case 1: {
    Expr *left = make(depth - 1);
    return new_expr(MUL, 0, left, make(depth - 1));
  }
  default:
    return new_expr(NEG, 0, make(depth - 1), NULL);
  }
}

static long eval(const Expr *expr, long x) {
  switch (expr->kind) {
  case NUM: return expr->value;
  case VAR: return expr->value * x % MODULUS;
  case ADD: return (eval(expr->left, x) + eval(expr->right, x)) % MODULUS;
  case MUL: return eval(expr->left, x) * eval(expr->right, x) % MODULUS;
  case NEG: return (MODULUS - eval(expr->left, x)) % MODULUS;
  }
  return 0;
}

static void drop(Expr *expr) {
  if (expr == NULL) return;
  drop(expr->left);
  drop(expr->right);
  free(expr);
}

int main(void) {
  Expr *tree = make(DEPTH);
  long sum = 0;
  for (long x = 0; x < VALUES; x++) sum = (sum + eval(tree, x)) % MODULUS;
  printf("%ld\n", sum);
  drop(tree);
  return 0;
}
