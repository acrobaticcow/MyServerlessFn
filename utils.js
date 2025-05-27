import fs from "node:fs";
import path from "path";
/**
 * @param folderPath {string}
 */
export function clearFolder(folderPath) {
  const files = fs.readdirSync(folderPath);
  files.forEach((file) => {
    fs.unlinkSync(path.join(folderPath, file));
  });
  fs.rmdirSync(folderPath);
}
