// The functions of std:math that libm's alone would make an infinity or a NaN of, which no Float
// holds (see docs/reference/types.md#float): they throw instead.
#include <math.h>
#include "internal.h"

LERTA_STATIC_STRING(negative_root, "square root of a negative number");
LERTA_STATIC_STRING(float_overflow, "float overflow");
LERTA_STATIC_STRING(division_by_zero, "division by zero");
LERTA_STATIC_STRING(fractional_power, "a negative number to a fractional power");

// Throws the ArithmeticError, whose caller checks for it on return, so the value is never read.
static double thrown(const void *message) {
  lerta_raise(LERTA_ARITHMETIC_ERROR, message);
  return 0;
}

double lerta_math_sqrt(double x) { return x < 0 ? thrown(&negative_root) : sqrt(x); }

double lerta_math_pow(double x, double y) {
  if (x == 0 && y < 0) return thrown(&division_by_zero);
  if (x < 0 && y != trunc(y)) return thrown(&fractional_power);
  // Stored as a double: on i686, x87 holds the result with a wider range until it is.
  volatile double result = pow(x, y);
  return isfinite(result) ? result : thrown(&float_overflow);
}

double lerta_math_remainder(double x, double y) {
  return y == 0 ? thrown(&division_by_zero) : fmod(x, y);
}
