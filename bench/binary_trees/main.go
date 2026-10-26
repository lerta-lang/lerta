// Builds complete binary trees of growing depths many times, counting the nodes of each before
// dropping it, while one long-lived tree is kept, and prints the count of all the nodes.
package main

import "fmt"

type Node struct {
	left, right *Node
}

// Not make, as the others call it, which would shadow Go's builtin make.
func build(depth int) *Node {
	if depth == 0 {
		return &Node{}
	}
	return &Node{left: build(depth - 1), right: build(depth - 1)}
}

func check(node *Node) int {
	if node.left == nil || node.right == nil {
		return 1
	}
	return 1 + check(node.left) + check(node.right)
}

func main() {
	const maxDepth = 16
	longLived := build(maxDepth)
	total := 0
	for depth := 4; depth <= maxDepth; depth += 2 {
		iterations := 16 << (maxDepth - depth)
		for i := 0; i < iterations; i++ {
			total += check(build(depth))
		}
	}
	fmt.Println(total + check(longLived))
}
