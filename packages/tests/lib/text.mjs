const normalizeText = (text) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

const wordOverlapScore = (a, b) => {
  const aWords = normalizeText(a);
  const bWords = normalizeText(b);
  if (!aWords.length || !bWords.length) return 0;

  const aSet = new Set(aWords);
  let matches = 0;
  for (const word of bWords) {
    if (aSet.has(word)) matches += 1;
  }
  return matches / Math.max(aSet.size, bWords.length);
};

export {
  normalizeText,
  wordOverlapScore
};
