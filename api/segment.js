/**
 * Compares a joined array of strings with a text after normalizing both.
 * Normalization trims and replaces multiple spaces with a single space.
 * @param {string[]} arr - Array of strings to join and normalize.
 * @param {string} text - Text to normalize and compare.
 * @returns {boolean} - True if normalized contents are equal, false otherwise.
 */
function compareNormalized(arr, text) {
  /**
   * @param str {string}
   */
  const normalize = (str) => str.split(/\s+/).filter(Boolean).join(" ").trim();

  const normalizedArr = normalize(arr.join(" ").normalize()).normalize();
  const normalizedText = normalize(text.normalize()).normalize();

  if (normalizedArr === normalizedText) {
    return {
      equal: true,
      arrValue: normalizedArr,
      textValue: normalizedText,
      diff: null,
    };
  }

  // Find the first difference
  const arrWords = normalizedArr.split(" ");
  const textWords = normalizedText.split(" ");
  let diffIndex = -1;
  for (let i = 0; i < Math.max(arrWords.length, textWords.length); i++) {
    if (arrWords[i] !== textWords[i]) {
      diffIndex = i;
      break;
    }
  }

  return {
    equal: false,
    arrValue: normalizedArr,
    textValue: normalizedText,
    diff: {
      index: diffIndex,
      arr: arrWords[diffIndex] ?? null,
      text: textWords[diffIndex] ?? null,
    },
  };
}

export default function handler(req, res) {
  const { code, text } = req.body;
  try {
    const segmenter = new Intl.Segmenter(code, { granularity: "sentence" });
    const sentences = Array.from(segmenter.segment(text)).map((s) => s.segment);
    console.log("🚀 ~ segment.js ~ handler ~ sentences:", sentences);
    const compare = compareNormalized(sentences, text);
    console.log("🚀 ~ segment.js ~ handler ~ compare:", compare);
    res.status(200).json({ sentences, compare });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
