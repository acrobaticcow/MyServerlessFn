import fs from "fs";
import os from "os";

export default async function getTmpContents() {
  try {
    const files = await fs.promises.readdir(os.tmpdir());
    console.log("Files in /tmp:", files);
  } catch (error) {
    console.error("Error reading /tmp:", error);
  }
}
