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

  return normalize(arr.join(" ")) === normalize(text);
}

export default function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { arr, text } = req.body;

  if (!Array.isArray(arr) || typeof text !== "string") {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  const result = compareNormalized(arr, text);
  res.status(200).json({ result });
}

// Example usage:
// console.log(compareNormalized(["hello", " world"], "hello world")); // true
// console.log(compareNormalized(["hello", "world"], "hello   world")); // true
// console.log(compareNormalized(["hello", "world"], "hello world")); // true
// console.log(compareNormalized(["hello", "world"], "helloworld")); // false
