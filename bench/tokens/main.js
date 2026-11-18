// Makes a source of lines of tokens picked by a pseudo-random generator, lexes it 10 times into
// tokens that hold their kinds and positions, then prints how many tokens of each kind there are,
// the 5 names whose first positions are the latest, and how many distinct names there are.
const LINES = 60000;
const ROUNDS = 10;
const TOKENS_PER_LINE = 8;
const VOCABULARY = 5000;
const SYMBOLS = ['+', '-', '*', '/', '=', '(', ')'];

const KINDS = ['NAME', 'NUMBER', 'SYMBOL'];
const [NAME, NUMBER, SYMBOL] = [0, 1, 2];

// MINSTD, whose products fit in the integers of every language compared.
let seed = 1;
const nextRandom = () => {
  seed = (seed * 48271) % 2147483647;
  return seed;
};

const nextText = () => {
  switch (nextRandom() % 3) {
    case 0:
      return `v${nextRandom() % VOCABULARY}`;
    case 1:
      return `${nextRandom() % 100000}`;
    default:
      return SYMBOLS[nextRandom() % SYMBOLS.length];
  }
};

const isSpace = (b) => b === 32 || (b >= 9 && b <= 13);
const isDigit = (b) => b >= 48 && b <= 57;
const isLetter = (b) => (b >= 97 && b <= 122) || (b >= 65 && b <= 90);

class Lexer {
  constructor(bytes) {
    this.bytes = bytes;
    this.at = 0;
    this.line = 1;
    this.lineStart = 0;
  }

  skipSpaces() {
    while (this.at < this.bytes.length && isSpace(this.bytes[this.at])) {
      if (this.bytes[this.at] === 10) {
        this.line++;
        this.lineStart = this.at + 1;
      }
      this.at++;
    }
  }

  // The end of the name or number at start.
  wordEnd(start) {
    let end = start;
    while (end < this.bytes.length && (isLetter(this.bytes[end]) || isDigit(this.bytes[end]))) end++;
    return end;
  }

  next() {
    this.skipSpaces();
    if (this.at === this.bytes.length) return null;
    const start = this.at;
    const first = this.bytes[start];
    const kind = isLetter(first) ? NAME : isDigit(first) ? NUMBER : SYMBOL;
    this.at = kind === SYMBOL ? start + 1 : this.wordEnd(start);
    const pos = { line: this.line, column: start - this.lineStart + 1 };
    return { kind, start, pos };
  }
}

const sourceLines = [];
for (let i = 0; i < LINES; i++) {
  const texts = [];
  for (let j = 0; j < TOKENS_PER_LINE; j++) texts.push(nextText());
  sourceLines.push(texts.join(' '));
}
const source = Buffer.from(sourceLines.join('\n'));
const counts = [0, 0, 0];
const firstPositions = new Map();
for (let round = 0; round < ROUNDS; round++) {
  const lexer = new Lexer(source);
  const tokens = [];
  for (let token; (token = lexer.next()) !== null; ) tokens.push(token);
  for (const token of tokens) {
    counts[token.kind]++;
    if (token.kind === NAME) {
      const name = source.toString('latin1', token.start, lexer.wordEnd(token.start));
      if (!firstPositions.has(name)) firstPositions.set(name, token.pos);
    }
  }
}

KINDS.forEach((kind, k) => console.log(`${kind} ${counts[k]}`));
const byLatest = ([, a], [, b]) => (a.line !== b.line ? b.line - a.line : b.column - a.column);
const latest = [...firstPositions].sort(byLatest);
for (const [name, pos] of latest.slice(0, 5)) console.log(`${name} ${pos.line}:${pos.column}`);
console.log(firstPositions.size);
