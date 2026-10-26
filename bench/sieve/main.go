// Counts the primes below n.
package main

import "fmt"

func sieve(n int) int {
	composite := make([]bool, n)
	count := 0
	for i := 2; i < n; i++ {
		if composite[i] {
			continue
		}
		count++
		for j := i * i; j < n; j += i {
			composite[j] = true
		}
	}
	return count
}

func main() {
	fmt.Println(sieve(50000000))
}
