// Adds up, over a number of rounds, the items of lazy pipelines of filters and maps over a generator
// of pseudo-random numbers, with functions that capture the round, and prints the total.
package main

import (
	"fmt"
	"iter"
)

const (
	rounds = 20
	count  = 1000000
)

// MINSTD from the seed, whose products fit in the integers of every language compared.
func randoms(seed, count int) iter.Seq[int] {
	return func(yield func(int) bool) {
		state := seed
		for range count {
			state = state * 48271 % 2147483647
			if !yield(state) {
				return
			}
		}
	}
}

func filter(source iter.Seq[int], keep func(int) bool) iter.Seq[int] {
	return func(yield func(int) bool) {
		for x := range source {
			if keep(x) && !yield(x) {
				return
			}
		}
	}
}

func mapSeq(source iter.Seq[int], transform func(int) int) iter.Seq[int] {
	return func(yield func(int) bool) {
		for x := range source {
			if !yield(transform(x)) {
				return
			}
		}
	}
}

func sum(source iter.Seq[int]) int {
	total := 0
	for x := range source {
		total += x
	}
	return total
}

func fold(source iter.Seq[int], initial int, combine func(int, int) int) int {
	result := initial
	for x := range source {
		result = combine(result, x)
	}
	return result
}

func main() {
	total := 0
	for k := 1; k <= rounds; k++ {
		notMultiple := func(x int) bool { return x%k != 0 }
		reducePlus := func(x int) int { return x%1000 + k }
		total += sum(mapSeq(filter(randoms(k, count), notMultiple), reducePlus))
		isEven := func(x int) bool { return x%2 == 0 }
		timesSeven := func(x int) int { return x % 1000 * 7 }
		add := func(a, b int) int { return a + b }
		total += fold(mapSeq(filter(randoms(k, count), isEven), timesSeven), 0, add)
	}
	fmt.Println(total)
}
