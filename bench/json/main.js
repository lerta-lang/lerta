// Makes the JSON text of an array of objects picked by a pseudo-random generator, parses it a
// number of times into values of arrays, objects, integers, strings and booleans, and prints a sum
// over each value parsed. The parser takes only what the text holds: no floats, escapes, nulls or
// errors.
const OBJECTS = 200000;
const PARSES = 5;

const SPACE = 0x20, QUOTE = 0x22, COMMA = 0x2c, ZERO = 0x30, NINE = 0x39;

// MINSTD, whose products fit in the integers of every language compared.
let seed = 1;
function nextRandom() {
  seed = seed * 48271 % 2147483647;
  return seed;
}

function makeText() {
  let text = '[';
  for (let i = 0; i < OBJECTS; i++) {
    if (i > 0) text += ', ';
    const id = nextRandom() % 1000000;
    const name = nextRandom() % 5000;
    text += `{"id": ${id}, "name": "w${name}", "tags": [`;
    const tags = nextRandom() % 4;
    for (let t = 0; t < tags; t++) {
      if (t > 0) text += ', ';
      text += `"t${nextRandom() % 100}"`;
    }
    const active = nextRandom() % 2 === 0;
    text += `], "active": ${active}}`;
  }
  return text + ']';
}

// Each part read skips the spaces after it, so that the next starts at its first character. It
// reads the string itself, by its code units, as JavaScript does: the text is ASCII.
class Parser {
  constructor(text) {
    this.text = text;
    this.position = 0;
  }

  // The code unit at the position.
  peek() {
    return this.text.charCodeAt(this.position);
  }

  skipSpaces() {
    while (this.position < this.text.length && this.peek() === SPACE) this.position++;
  }

  // Skips a punctuation character, as `[` or `,`, which the text has at the position.
  skipChar() {
    this.position++;
    this.skipSpaces();
  }

  parseValue() {
    switch (this.peek()) {
      case 0x5b: return this.parseArray(); // [
      case 0x7b: return this.parseObject(); // {
      case QUOTE: return this.parseString();
      case 0x74: return this.parseWord(4, true); // t
      case 0x66: return this.parseWord(5, false); // f
      default: return this.parseInt();
    }
  }

  parseWord(length, value) {
    this.position += length;
    this.skipSpaces();
    return value;
  }

  parseArray() {
    this.skipChar();
    const items = [];
    if (this.peek() !== 0x5d) { // ]
      items.push(this.parseValue());
      while (this.peek() === COMMA) {
        this.skipChar();
        items.push(this.parseValue());
      }
    }
    this.skipChar();
    return items;
  }

  parseObject() {
    this.skipChar();
    const fields = new Map();
    if (this.peek() !== 0x7d) { // }
      this.parseField(fields);
      while (this.peek() === COMMA) {
        this.skipChar();
        this.parseField(fields);
      }
    }
    this.skipChar();
    return fields;
  }

  parseField(fields) {
    const key = this.parseString();
    this.skipChar();
    fields.set(key, this.parseValue());
  }

  parseString() {
    const start = this.position + 1;
    this.position = start;
    while (this.peek() !== QUOTE) this.position++;
    const text = this.text.slice(start, this.position);
    this.skipChar();
    return text;
  }

  parseInt() {
    let value = 0;
    for (let c = this.peek(); c >= ZERO && c <= NINE; c = this.peek()) {
      value = value * 10 + (c - ZERO);
      this.position++;
    }
    this.skipSpaces();
    return value;
  }
}

// The integers, the lengths of the strings, the true booleans and the items and fields, added up.
function sum(value) {
  switch (typeof value) {
    case 'number': return value;
    case 'string': return value.length; // its bytes, as the text is ASCII
    case 'boolean': return value ? 1 : 0;
  }
  let total = value.length ?? value.size;
  for (const item of value.values()) total += sum(item);
  return total;
}

const text = makeText();
let total = 0;
for (let i = 0; i < PARSES; i++) total += sum(new Parser(text).parseValue());
console.log(total);
