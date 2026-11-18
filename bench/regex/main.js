// Makes log lines from a pseudo-random generator, with 0 to 2 more addresses and a tab now and
// then, then over all of them tests a pattern, sums a group's numbers, counts the matches of
// another, replaces the matches of a third and splits by a fourth, and prints the counts and sums.
const LINES = 100000;
const METHODS = ['GET', 'POST', 'PUT', 'DELETE'];
const RESOURCES = ['items', 'users', 'orders'];
const STATUSES = [200, 404, 500];

// MINSTD, whose products fit in the integers of every language compared.
let seed = 1;
function next(limit) {
  seed = (seed * 48271) % 2147483647;
  return seed % limit;
}

function twoDigits(n) {
  return String(n).padStart(2, '0');
}

function lineOf() {
  const day = twoDigits(next(28) + 1);
  const time = `${twoDigits(next(24))}:${twoDigits(next(60))}:${twoDigits(next(60))}`;
  const user = `user${next(1000)}@example.com`;
  const method = METHODS[next(METHODS.length)];
  const path = `/${RESOURCES[next(RESOURCES.length)]}/${next(10000)}`;
  const gap = next(4) === 0 ? '\t' : ' ';
  const status = STATUSES[next(STATUSES.length)];
  const ms = next(1000);
  let line = `2026-11-${day} ${time} ${user} ${method} ${path}${gap}${status} ${ms}ms`;
  const copies = next(3);
  for (let i = 0; i < copies; i++) line += ` cc${next(1000)}@example.com`;
  return line;
}

const lines = [];
for (let i = 0; i < LINES; i++) lines.push(lineOf());

let itemReads = 0;
let totalMs = 0;
let emails = 0;
let replacedLength = 0;
let fields = 0;
for (const line of lines) {
  if (/\b(?:GET|POST) \/items\/\d+/.test(line)) itemReads++;
  totalMs += parseInt(/(\d+)ms/.exec(line)[1], 10);
  emails += [...line.matchAll(/\w+@\w+\.com/g)].length;
  replacedLength += [...line.replace(/\d+/g, '#')].length;
  fields += line.split(/\s+/).length;
}

console.log(`item reads: ${itemReads}`);
console.log(`total ms: ${totalMs}`);
console.log(`emails: ${emails}`);
console.log(`replaced length: ${replacedLength}`);
console.log(`fields: ${fields}`);
