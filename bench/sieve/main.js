// Counts the primes below n.
function sieve(n) {
  const composite = new Uint8Array(n);
  let count = 0;
  for (let i = 2; i < n; i++) {
    if (composite[i]) continue;
    count++;
    for (let j = i * i; j < n; j += i) composite[j] = 1;
  }
  return count;
}

console.log(sieve(50000000));
