// Counts the points of a size × size grid that stay in the Mandelbrot set for 100 iterations.
package main

import "fmt"

func mandelbrot(size int) int {
	inside := 0
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			cr := 2.0*float64(x)/float64(size) - 1.5
			ci := 2.0*float64(y)/float64(size) - 1.0
			zr, zi, i := 0.0, 0.0, 0
			for i < 100 && zr*zr+zi*zi <= 4.0 {
				t := zr*zr - zi*zi + cr
				zi = 2.0*zr*zi + ci
				zr = t
				i++
			}
			if i == 100 {
				inside++
			}
		}
	}
	return inside
}

func main() {
	fmt.Println(mandelbrot(2000))
}
