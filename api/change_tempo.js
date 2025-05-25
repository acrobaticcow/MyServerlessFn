import fs from "fs";
import formidable from "formidable";
import { path as ffmpegPath } from "@ffmpeg-installer/ffmpeg";
import os from "node:os";
import ffmpeg from "fluent-ffmpeg";
import path from "path";

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

  const form = new formidable.IncomingForm({
    uploadDir: tmpPath,
    keepExtensions: true,
  });

  form.parse(req, async (err, fields, files) => {
    if (err) {
      console.error("Form parse error:", err);
      return res.status(500).send("Form parsing failed");
    }

    const audioFile = files.audio?.path;

    if (!audioFile) {
      return res.status(400).send("Missing audio file");
    }

    const percent = parseFloat(fields.tempo);
    if (isNaN(percent)) {
      return res.status(400).send("Invalid tempo percentage");
    }

    const multiplier = 1 + percent / 100;
    if (multiplier <= 0) {
      return res.status(400).send("Tempo multiplier must be positive");
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
    console.log("🚀 ~ change_tempo.js ~ form.parse ~ filter:", filter);

    const outputPath = path.join(tmpPath, `tempo-changed-${Date.now()}.wav`);
    ffmpeg(audioFile)
      .audioFilters(filter)
      .output(outputPath)
      .on("end", () => {
        const stat = fs.statSync(outputPath);
        res.writeHead(200, {
          "Content-Type": "audio/wav",
          "Content-Length": stat.size,
          "Content-Disposition": 'attachment; filename="tempo_changed.wav"',
        });
        fs.createReadStream(outputPath).pipe(res);
      })
      .on("error", (err) => {
        console.error("FFmpeg error:", err);
        res.status(500).send("Audio processing failed");
      })
      .run();
  });
}
