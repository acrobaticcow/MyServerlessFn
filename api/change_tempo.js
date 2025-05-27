import fs from "fs";
import formidable from "formidable";
import { path as ffmpegPath } from "@ffmpeg-installer/ffmpeg";
import os from "node:os";
import ffmpeg from "fluent-ffmpeg";
import path from "path";
import { clearFolder } from "../utils.js";

ffmpeg.setFfmpegPath(ffmpegPath);

export const config = {
  api: {
    bodyParser: false,
  },
};

const tmpPath = os.tmpdir();

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  const oneTimePath = path.join(tmpPath, Date.now().toString());
  fs.mkdirSync(oneTimePath, { recursive: true });

  const form = new formidable.IncomingForm({
    uploadDir: oneTimePath,
    keepExtensions: true,
  });

  form.parse(req, async (err, fields, files) => {
    const audioFile = files.audio?.path || files.audio?.filepath;
    const percent = parseFloat(fields.tempo);
    const multiplier = 1 + percent / 100;
    try {
      if (err) {
        console.error("Form parse error:", err);
        throw new Error("Form parsing failed");
      }

      if (!audioFile) {
        throw new Error("Missing audio file");
      }

      if (isNaN(percent)) {
        throw new Error("Invalid tempo percentage");
      }

      if (multiplier <= 0) {
        throw new Error("Tempo multiplier must be positive");
      }
      // rest of your code continues...
    } catch (error) {
      console.error(error);
      res.status(400).send(error.message);
      clearFolder(oneTimePath);
      return;
    }

    // Construct atempo filter chain for FFmpeg
    const atempoChain = [];
    let remaining = multiplier;
    while (remaining < 0.5 || remaining > 2.0) {
      const step = remaining > 2.0 ? 2.0 : 0.5;
      atempoChain.push(`atempo=${step}`);
      remaining /= step;
    }
    atempoChain.push(`atempo=${remaining.toFixed(5)}`);
    const filter = atempoChain.join(",");

    const outputPath = path.join(
      oneTimePath,
      `tempo-changed-${Date.now()}.mp3`
    );
    try {
      await new Promise((resolve, reject) => {
        ffmpeg(audioFile)
          .audioFilters(filter)
          .audioCodec("libmp3lame")
          .audioBitrate("128k")
          .outputOptions("-ar 44100")
          .output(outputPath)
          .on("end", resolve)
          .on("error", reject)
          .run();
      });
      const stat = fs.statSync(outputPath);
      res.writeHead(200, {
        "Content-Type": "audio/mpeg",
        "Content-Length": stat.size,
        "Content-Disposition": 'attachment; filename="tempo_changed.mp3"',
      });
      fs.createReadStream(outputPath).pipe(res);
      await new Promise((resolve, reject) => {
        res.on("finish", resolve); // when response is fully sent
        res.on("error", reject); // if there is an error
      });
    } catch (err) {
      console.error("FFmpeg error:", err);
      res.status(500).send("Audio processing failed");
    } finally {
      clearFolder(oneTimePath);
    }
  });
}
