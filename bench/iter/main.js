// Adds up, over a number of rounds, the items of lazy pipelines of filters and maps over a generator
// of pseudo-random numbers, with functions that capture the round, and prints the total.
const ROUNDS = 20;
const COUNT = 1000000;

// MINSTD from the seed, whose products fit in the integers of every language compared.
function* randoms(seed, count) {
  let state = seed;
  for (let i = 0; i < count; i++) {
    state = state * 48271 % 2147483647;
    yield state;
  }
}

let total = 0;
for (let k = 1; k <= ROUNDS; k++) {
  total += randoms(k, COUNT).filter((x) => x % k !== 0).map((x) => x % 1000 + k)
    .reduce((a, b) => a + b, 0);
  total += randoms(k, COUNT).filter((x) => x % 2 === 0).map((x) => x % 1000 * 7)
    .reduce((a, b) => a + b, 0);
}
console.log(total);
