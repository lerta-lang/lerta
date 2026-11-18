// Makes log lines from a pseudo-random generator, with 0 to 2 more addresses and a tab now and
// then, then over all of them tests a pattern, sums a group's numbers, counts the matches of
// another, replaces the matches of a third and splits by a fourth, and prints the counts and sums.
package main

import (
	"fmt"
	"regexp"
	"strconv"
	"unicode/utf8"
)

const lines = 100000

var methods = []string{"GET", "POST", "PUT", "DELETE"}
var resources = []string{"items", "users", "orders"}
var statuses = []int{200, 404, 500}

// MINSTD, whose products fit in the integers of every language compared.
var seed = 1

func next(limit int) int {
	seed = seed * 48271 % 2147483647
	return seed % limit
}

func twoDigits(n int) string {
	return fmt.Sprintf("%02d", n)
}

func lineOf() string {
	day := twoDigits(next(28) + 1)
	time := twoDigits(next(24)) + ":" + twoDigits(next(60)) + ":" + twoDigits(next(60))
	user := "user" + strconv.Itoa(next(1000)) + "@example.com"
	method := methods[next(len(methods))]
	path := "/" + resources[next(len(resources))] + "/" + strconv.Itoa(next(10000))
	gap := " "
	if next(4) == 0 {
		gap = "\t"
	}
	status := strconv.Itoa(statuses[next(len(statuses))])
	ms := strconv.Itoa(next(1000))
	line := "2026-11-" + day + " " + time + " " + user + " " + method + " " + path + gap + status +
		" " + ms + "ms"
	copies := next(3)
	for i := 0; i < copies; i++ {
		line += " cc" + strconv.Itoa(next(1000)) + "@example.com"
	}
	return line
}

func main() {
	all := make([]string, lines)
	for i := range all {
		all[i] = lineOf()
	}

	itemRead := regexp.MustCompile(`\b(?:GET|POST) /items/\d+`)
	duration := regexp.MustCompile(`(\d+)ms`)
	email := regexp.MustCompile(`\w+@\w+\.com`)
	number := regexp.MustCompile(`\d+`)
	spaces := regexp.MustCompile(`\s+`)

	itemReads, totalMs, emails, replacedLength, fields := 0, 0, 0, 0, 0
	for _, line := range all {
		if itemRead.MatchString(line) {
			itemReads++
		}
		ms, _ := strconv.Atoi(duration.FindStringSubmatch(line)[1])
		totalMs += ms
		emails += len(email.FindAllString(line, -1))
		replacedLength += utf8.RuneCountInString(number.ReplaceAllLiteralString(line, "#"))
		fields += len(spaces.Split(line, -1))
	}

	fmt.Printf("item reads: %d\n", itemReads)
	fmt.Printf("total ms: %d\n", totalMs)
	fmt.Printf("emails: %d\n", emails)
	fmt.Printf("replaced length: %d\n", replacedLength)
	fmt.Printf("fields: %d\n", fields)
}
