import fs from "fs";
import os from "os";

export default async function getTmpContents(req, res) {
  try {
    const files = await fs.promises.readdir(os.tmpdir());
    console.log("🚀 ~ log_temp.js ~ getTmpContents ~ files:", files)
    res.status(200).send(`Files are ${files}`);
  } catch (error) {
    console.error("Error reading /tmp:", error);
  }
}
