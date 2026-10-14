// Counts the points of a size × size grid that stay in the Mandelbrot set for 100 iterations.
func mandelbrot(_ size: Int) -> Int {
  var inside = 0
  for y in 0..<size {
    for x in 0..<size {
      let cr = 2.0 * Double(x) / Double(size) - 1.5
      let ci = 2.0 * Double(y) / Double(size) - 1.0
      var zr = 0.0, zi = 0.0, i = 0
      while i < 100 && zr * zr + zi * zi <= 4.0 {
        let t = zr * zr - zi * zi + cr
        zi = 2.0 * zr * zi + ci
        zr = t
        i += 1
      }
      if i == 100 { inside += 1 }
    }
  }
  return inside
}

print(mandelbrot(2000))
