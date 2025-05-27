import fs from "fs";
import os from "os";

export default async function getTmpContents(req, res) {
  try {
    const files = await fs.promises.readdir(os.tmpdir());
    res.status(200).send(files);
  } catch (error) {
    console.error("Error reading /tmp:", error);
  }
}
