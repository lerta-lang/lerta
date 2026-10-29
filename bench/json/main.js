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

// Each part read skips the spaces after it, so that the next starts at its first byte.
class Parser {
  constructor(bytes) {
    this.bytes = bytes;
    this.position = 0;
    this.decoder = new TextDecoder();
  }

  skipSpaces() {
    while (this.position < this.bytes.length && this.bytes[this.position] === SPACE) this.position++;
  }

  // Skips a punctuation byte, as `[` or `,`, which the text has at the position.
  skipByte() {
    this.position++;
    this.skipSpaces();
  }

  parseValue() {
    switch (this.bytes[this.position]) {
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
    this.skipByte();
    const items = [];
    if (this.bytes[this.position] !== 0x5d) { // ]
      items.push(this.parseValue());
      while (this.bytes[this.position] === COMMA) {
        this.skipByte();
        items.push(this.parseValue());
      }
    }
    this.skipByte();
    return items;
  }

  parseObject() {
    this.skipByte();
    const fields = new Map();
    if (this.bytes[this.position] !== 0x7d) { // }
      this.parseField(fields);
      while (this.bytes[this.position] === COMMA) {
        this.skipByte();
        this.parseField(fields);
      }
    }
    this.skipByte();
    return fields;
  }

  parseField(fields) {
    const key = this.parseString();
    this.skipByte();
    fields.set(key, this.parseValue());
  }

  parseString() {
    const start = this.position + 1;
    this.position = start;
    while (this.bytes[this.position] !== QUOTE) this.position++;
    const text = this.decoder.decode(this.bytes.subarray(start, this.position));
    this.skipByte();
    return text;
  }

  parseInt() {
    let value = 0;
    while (this.bytes[this.position] >= ZERO && this.bytes[this.position] <= NINE) {
      value = value * 10 + (this.bytes[this.position] - ZERO);
      this.position++;
    }
    this.skipSpaces();
    return value;
  }
}

const encoder = new TextEncoder();

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

const text = encoder.encode(makeText());
let total = 0;
for (let i = 0; i < PARSES; i++) total += sum(new Parser(text).parseValue());
console.log(total);
