// Counts the points of a size × size grid that stay in the Mandelbrot set for 100 iterations.
function mandelbrot(size) {
  let inside = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cr = (2.0 * x) / size - 1.5;
      const ci = (2.0 * y) / size - 1.0;
      let zr = 0, zi = 0, i = 0;
      while (i < 100 && zr * zr + zi * zi <= 4.0) {
        const t = zr * zr - zi * zi + cr;
        zi = 2.0 * zr * zi + ci;
        zr = t;
        i++;
      }
      if (i === 100) inside++;
    }
  }
  return inside;
}

console.log(mandelbrot(2000));
