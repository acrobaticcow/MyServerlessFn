/**
 * Compares a joined array of strings with a text after normalizing both.
 * Normalization trims and replaces multiple spaces with a single space.
 * @param {string[]} arr - Array of strings to join and normalize.
 * @param {string} text - Text to normalize and compare.
 * @returns {boolean} - True if normalized contents are equal, false otherwise.
 */

// function compareNormalized(arr, text) {
//   /**
//    * @param str {string}
//    */
//   const normalize = (str) =>
//     str
//       .normalize("NFC")
//       .replace(/[\u064B-\u065F]/g, "")
//       .split(/\s+/)
//       .filter(Boolean)
//       .join(" ")
//       .trim();

//   const normalizedArr = normalize(arr.join(" "));
//   const normalizedText = normalize(text);

//   if (normalizedArr.length === normalizedText.length) {
//     return true;
//   }

//   // Find the first difference
//   const arrWords = normalizedArr.split(" ");
//   const textWords = normalizedText.split(" ");
//   let diffIndex = -1;
//   for (let i = 0; i < Math.max(arrWords.length, textWords.length); i++) {
//     if (arrWords[i] !== textWords[i]) {
//       diffIndex = i;
//       break;
//     }
//   }

//   return {
//     equal: false,
//     arrValue: normalizedArr,
//     textValue: normalizedText,
//     diff: {
//       index: diffIndex,
//       arr: arrWords[diffIndex] ?? null,
//       text: textWords[diffIndex] ?? null,
//     },
//   };
// }

function groupSentencesByWordCount(sentences, maxWords = 100) {
  const blocks = [];
  let currentBlock = [];
  let wordCount = 0;

  for (const sentence of sentences) {
    const sentenceWordCount = sentence.trim().split(/\s+/).length;
    if (wordCount + sentenceWordCount > maxWords && currentBlock.length > 0) {
      blocks.push(currentBlock.join(" "));
      currentBlock = [];
      wordCount = 0;
    }
    currentBlock.push(sentence.trim());
    wordCount += sentenceWordCount;
  }
  if (currentBlock.length > 0) {
    blocks.push(currentBlock.join(" "));
  }
  return blocks;
}

export default function handler(req, res) {
  const { code, text, wordCount = 75 } = req.body;
  try {
    const segmenter = new Intl.Segmenter(code, {
      granularity: "sentence",
    });
    const sentences = Array.from(segmenter.segment(text)).map((s) => s.segment);
    const blocks = groupSentencesByWordCount(sentences, wordCount);
    res.status(200).json({ blocks });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
