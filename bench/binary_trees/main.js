// Builds complete binary trees of growing depths many times, counting the nodes of each before
// dropping it, while one long-lived tree is kept, and prints the count of all the nodes.
class Node {
  constructor(left, right) {
    this.left = left;
    this.right = right;
  }
}

const make = (depth) => (depth === 0 ? new Node(null, null) : new Node(make(depth - 1), make(depth - 1)));

const check = (node) =>
  node.left === null || node.right === null ? 1 : 1 + check(node.left) + check(node.right);

const MAX_DEPTH = 16;
const longLived = make(MAX_DEPTH);
let total = 0;
for (let depth = 4; depth <= MAX_DEPTH; depth += 2) {
  const iterations = 16 << (MAX_DEPTH - depth);
  for (let i = 0; i < iterations; i++) total += check(make(depth));
}
console.log(total + check(longLived));
