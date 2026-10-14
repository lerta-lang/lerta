// Makes lines of 8 words picked by a pseudo-random generator, splits each line back into its words
// and counts them, then prints the 5 most frequent words, by count and then by word, and how many
// words there are.
const LINES = 1000000;
const WORDS_PER_LINE = 8;
const VOCABULARY = 5000;

// MINSTD, whose products fit in the integers of every language compared.
let seed = 1;
const nextWord = () => {
  seed = (seed * 48271) % 2147483647;
  return `w${seed % VOCABULARY}`;
};

const counts = new Map();
for (let i = 0; i < LINES; i++) {
  const words = [];
  for (let j = 0; j < WORDS_PER_LINE; j++) words.push(nextWord());
  const line = words.join(' ');
  for (const word of line.split(' ')) counts.set(word, (counts.get(word) ?? 0) + 1);
}

const byFrequency = ([wordA, countA], [wordB, countB]) =>
  countA !== countB ? countB - countA : wordA < wordB ? -1 : wordA > wordB ? 1 : 0;

const ranked = [...counts].sort(byFrequency);
for (const [word, count] of ranked.slice(0, 5)) console.log(`${word} ${count}`);
console.log(counts.size);
