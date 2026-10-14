#include <stdio.h>

// Counts the points of a size × size grid that stay in the Mandelbrot set for 100 iterations.
static long mandelbrot(long size) {
  long inside = 0;
  for (long y = 0; y < size; y++) {
    for (long x = 0; x < size; x++) {
      double cr = 2.0 * x / size - 1.5;
      double ci = 2.0 * y / size - 1.0;
      double zr = 0, zi = 0;
      int i = 0;
      while (i < 100 && zr * zr + zi * zi <= 4.0) {
        double t = zr * zr - zi * zi + cr;
        zi = 2.0 * zr * zi + ci;
        zr = t;
        i++;
      }
      if (i == 100) inside++;
    }
  }
  return inside;
}

int main(void) {
  printf("%ld\n", mandelbrot(2000));
}
