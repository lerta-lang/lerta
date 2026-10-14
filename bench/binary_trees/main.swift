// Builds complete binary trees of growing depths many times, counting the nodes of each before
// dropping it, while one long-lived tree is kept, and prints the count of all the nodes.
final class Node {
  let left: Node?
  let right: Node?

  init(left: Node?, right: Node?) {
    self.left = left
    self.right = right
  }
}

func make(_ depth: Int) -> Node {
  if depth == 0 { return Node(left: nil, right: nil) }
  return Node(left: make(depth - 1), right: make(depth - 1))
}

func check(_ node: Node) -> Int {
  guard let left = node.left, let right = node.right else { return 1 }
  return 1 + check(left) + check(right)
}

let maxDepth = 16
let longLived = make(maxDepth)
var total = 0
for depth in stride(from: 4, through: maxDepth, by: 2) {
  let iterations = 16 << (maxDepth - depth)
  for _ in 0..<iterations { total += check(make(depth)) }
}
print(total + check(longLived))
