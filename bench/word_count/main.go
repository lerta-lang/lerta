// Makes lines of 8 words picked by a pseudo-random generator, splits each line back into its words
// and counts them, then prints the 5 most frequent words, by count and then by word, and how many
// words there are.
package main

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
)

const (
	lines        = 1000000
	wordsPerLine = 8
	vocabulary   = 5000
)

// MINSTD, whose products fit in the integers of every language compared.
var seed = 1

func nextWord() string {
	seed = seed * 48271 % 2147483647
	return "w" + strconv.Itoa(seed%vocabulary)
}

type entry struct {
	word  string
	count int
}

func main() {
	counts := map[string]int{}
	for i := 0; i < lines; i++ {
		words := []string{}
		for j := 0; j < wordsPerLine; j++ {
			words = append(words, nextWord())
		}
		line := strings.Join(words, " ")
		for _, word := range strings.Split(line, " ") {
			counts[word]++
		}
	}

	ranked := []entry{}
	for word, count := range counts {
		ranked = append(ranked, entry{word, count})
	}
	sort.Slice(ranked, func(a, b int) bool {
		if ranked[a].count != ranked[b].count {
			return ranked[a].count > ranked[b].count
		}
		return ranked[a].word < ranked[b].word
	})
	for _, e := range ranked[:5] {
		fmt.Println(e.word, e.count)
	}
	fmt.Println(len(counts))
}
