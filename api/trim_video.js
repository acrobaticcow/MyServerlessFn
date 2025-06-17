import fs from "fs";
import { path as ffmpegPath } from "@ffmpeg-installer/ffmpeg";
import ffmpeg from "fluent-ffmpeg";
import formidable from "formidable-serverless";
import path from "path";
import os from "node:os";

ffmpeg.setFfmpegPath(ffmpegPath);

export const config = {
  api: {
    bodyParser: false,
  },
};

const tmpPath = os.tmpdir();

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const form = new formidable.IncomingForm({
    uploadDir: tmpPath,
    keepExtensions: true,
  });

  form.parse(req, async (err, fields, files) => {
    if (err) {
      res.status(500).json({ error: "File upload error" });
      return;
    }

    const file = files.file;
    if (!file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }

    const inputPath = file.path;
    const outputPath = path.join(tmpPath, `trimmed_${Date.now()}.mp4`);

    try {
      // Try to trim directly to 60 seconds, regardless of duration
      await new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .setStartTime("00:00:00")
          .setDuration(60)
          .output(outputPath)
          .on("end", resolve)
          .on("error", reject)
          .save(outputPath); // Ensure the process starts
      });

      res.setHeader("Content-Type", "video/mp4");
      const readStream = fs.createReadStream(outputPath);
      readStream.pipe(res);
      readStream.on("close", () => {
        // fs.unlinkSync(inputPath);
        // fs.unlinkSync(outputPath);
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
      //   if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
      //   if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    }
  });
}
