// Makes the JSON text of an array of objects picked by a pseudo-random generator, parses it a
// number of times into values of arrays, objects, integers, strings and booleans, and prints a sum
// over each value parsed. The parser takes only what the text holds: no floats, escapes, nulls or
// errors.
package main

import (
	"fmt"
	"strings"
)

const (
	objects = 200000
	parses  = 5
)

type Json interface{}

// MINSTD, whose products fit in the integers of every language compared.
var seed = 1

func nextRandom() int {
	seed = seed * 48271 % 2147483647
	return seed
}

func makeText() string {
	var text strings.Builder
	text.WriteString("[")
	for i := 0; i < objects; i++ {
		if i > 0 {
			text.WriteString(", ")
		}
		id := nextRandom() % 1000000
		name := nextRandom() % 5000
		fmt.Fprintf(&text, "{\"id\": %d, \"name\": \"w%d\", \"tags\": [", id, name)
		tags := nextRandom() % 4
		for t := 0; t < tags; t++ {
			if t > 0 {
				text.WriteString(", ")
			}
			fmt.Fprintf(&text, "\"t%d\"", nextRandom()%100)
		}
		active := nextRandom()%2 == 0
		fmt.Fprintf(&text, "], \"active\": %t}", active)
	}
	text.WriteString("]")
	return text.String()
}

// Each part read skips the spaces after it, so that the next starts at its first byte.
type Parser struct {
	bytes    string
	position int
}

func (p *Parser) skipSpaces() {
	for p.position < len(p.bytes) && p.bytes[p.position] == ' ' {
		p.position++
	}
}

// Skips a punctuation byte, as `[` or `,`, which the text has at the position.
func (p *Parser) skipByte() {
	p.position++
	p.skipSpaces()
}

func (p *Parser) parseValue() Json {
	switch p.bytes[p.position] {
	case '[':
		return p.parseArray()
	case '{':
		return p.parseObject()
	case '"':
		return p.parseString()
	case 't':
		return p.parseWord(4, true)
	case 'f':
		return p.parseWord(5, false)
	default:
		return p.parseInt()
	}
}

func (p *Parser) parseWord(length int, value bool) Json {
	p.position += length
	p.skipSpaces()
	return value
}

func (p *Parser) parseArray() Json {
	p.skipByte()
	var items []Json
	if p.bytes[p.position] != ']' {
		items = append(items, p.parseValue())
		for p.bytes[p.position] == ',' {
			p.skipByte()
			items = append(items, p.parseValue())
		}
	}
	p.skipByte()
	return items
}

func (p *Parser) parseObject() Json {
	p.skipByte()
	fields := map[string]Json{}
	if p.bytes[p.position] != '}' {
		p.parseField(fields)
		for p.bytes[p.position] == ',' {
			p.skipByte()
			p.parseField(fields)
		}
	}
	p.skipByte()
	return fields
}

func (p *Parser) parseField(fields map[string]Json) {
	key := p.parseString()
	p.skipByte()
	fields[key] = p.parseValue()
}

func (p *Parser) parseString() string {
	start := p.position + 1
	p.position = start
	for p.bytes[p.position] != '"' {
		p.position++
	}
	// Copied, as the other languages copy, rather than a slice that shares the text.
	text := strings.Clone(p.bytes[start:p.position])
	p.skipByte()
	return text
}

func (p *Parser) parseInt() Json {
	value := 0
	for p.bytes[p.position] >= '0' && p.bytes[p.position] <= '9' {
		value = value*10 + int(p.bytes[p.position]-'0')
		p.position++
	}
	p.skipSpaces()
	return value
}

// The integers, the lengths of the strings, the true booleans and the items and fields, added up.
func sum(value Json) int {
	switch value := value.(type) {
	case int:
		return value
	case string:
		return len(value)
	case bool:
		if value {
			return 1
		}
		return 0
	case []Json:
		total := len(value)
		for _, item := range value {
			total += sum(item)
		}
		return total
	case map[string]Json:
		total := len(value)
		for _, field := range value {
			total += sum(field)
		}
		return total
	}
	panic("unknown value")
}

func main() {
	text := makeText()
	total := 0
	for i := 0; i < parses; i++ {
		parser := Parser{bytes: text}
		total += sum(parser.parseValue())
	}
	fmt.Println(total)
}
