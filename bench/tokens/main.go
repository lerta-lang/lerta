// Makes a source of lines of tokens picked by a pseudo-random generator, lexes it 10 times into
// tokens that hold their kinds and positions, then prints how many tokens of each kind there are,
// the 5 names whose first positions are the latest, and how many distinct names there are.
package main

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
)

const (
	lines         = 60000
	rounds        = 10
	tokensPerLine = 8
	vocabulary    = 5000
)

var symbols = []string{"+", "-", "*", "/", "=", "(", ")"}

type kind int

const (
	name kind = iota
	number
	symbol
)

var kindNames = []string{"NAME", "NUMBER", "SYMBOL"}

type position struct {
	line   int32
	column int32
}

type token struct {
	kind  kind
	start int32
	pos   position
}

// MINSTD, whose products fit in the integers of every language compared.
var seed = 1

func nextRandom() int {
	seed = seed * 48271 % 2147483647
	return seed
}

func nextText() string {
	switch nextRandom() % 3 {
	case 0:
		return "v" + strconv.Itoa(nextRandom()%vocabulary)
	case 1:
		return strconv.Itoa(nextRandom() % 100000)
	default:
		return symbols[nextRandom()%len(symbols)]
	}
}

func isSpace(b byte) bool { return b == ' ' || b == '\t' || b == '\n' || b == '\v' || b == '\f' || b == '\r' }
func isDigit(b byte) bool { return b >= '0' && b <= '9' }
func isLetter(b byte) bool { return b >= 'a' && b <= 'z' || b >= 'A' && b <= 'Z' }

type lexer struct {
	bytes     string
	at        int
	line      int
	lineStart int
}

func (l *lexer) skipSpaces() {
	for l.at < len(l.bytes) && isSpace(l.bytes[l.at]) {
		if l.bytes[l.at] == '\n' {
			l.line++
			l.lineStart = l.at + 1
		}
		l.at++
	}
}

// The end of the name or number at start.
func (l *lexer) wordEnd(start int) int {
	end := start
	for end < len(l.bytes) && (isLetter(l.bytes[end]) || isDigit(l.bytes[end])) {
		end++
	}
	return end
}

func (l *lexer) next() (token, bool) {
	l.skipSpaces()
	if l.at == len(l.bytes) {
		return token{}, false
	}
	start := l.at
	first := l.bytes[start]
	k := symbol
	if isLetter(first) {
		k = name
	} else if isDigit(first) {
		k = number
	}
	if k == symbol {
		l.at = start + 1
	} else {
		l.at = l.wordEnd(start)
	}
	pos := position{int32(l.line), int32(start - l.lineStart + 1)}
	return token{k, int32(start), pos}, true
}

type entry struct {
	name string
	pos  position
}

func main() {
	sourceLines := []string{}
	for i := 0; i < lines; i++ {
		texts := []string{}
		for j := 0; j < tokensPerLine; j++ {
			texts = append(texts, nextText())
		}
		sourceLines = append(sourceLines, strings.Join(texts, " "))
	}
	source := strings.Join(sourceLines, "\n")
	counts := map[kind]int{}
	firstPositions := map[string]position{}
	for r := 0; r < rounds; r++ {
		lex := &lexer{bytes: source, line: 1}
		tokens := []token{}
		for {
			t, ok := lex.next()
			if !ok {
				break
			}
			tokens = append(tokens, t)
		}
		for _, t := range tokens {
			counts[t.kind]++
			if t.kind == name {
				start := int(t.start)
				n := source[start:lex.wordEnd(start)]
				if _, ok := firstPositions[n]; !ok {
					firstPositions[n] = t.pos
				}
			}
		}
	}

	for k, kindName := range kindNames {
		fmt.Println(kindName, counts[kind(k)])
	}
	latest := []entry{}
	for n, pos := range firstPositions {
		latest = append(latest, entry{n, pos})
	}
	sort.Slice(latest, func(a, b int) bool {
		if latest[a].pos.line != latest[b].pos.line {
			return latest[a].pos.line > latest[b].pos.line
		}
		return latest[a].pos.column > latest[b].pos.column
	})
	for _, e := range latest[:5] {
		fmt.Printf("%s %d:%d\n", e.name, e.pos.line, e.pos.column)
	}
	fmt.Println(len(firstPositions))
}
