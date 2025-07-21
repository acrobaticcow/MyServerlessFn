import fs from "fs";
import { path as ffmpegPath } from "@ffmpeg-installer/ffmpeg";
import ffmpeg from "fluent-ffmpeg";
import formidable from "formidable-serverless";
import path from "path";
import os from "node:os";
import { clearFolder } from "../utils.js";
import { change_tempo } from "./change_tempo.js";
import { truncate_silence } from "./truncate_silence.js";

ffmpeg.setFfmpegPath(ffmpegPath);

export const config = {
  api: {
    bodyParser: false,
  },
};

const tmpPath = os.tmpdir();

/**
 * Handles HTTP POST requests to process an uploaded audio file by detecting silences,
 * truncating them to a specified duration, and returning the processed audio.
 *
 * Expects a multipart/form-data POST request with the following fields:
 * - audio: The audio file to process (required).
 * - threshold: Silence detection threshold in dB (number, required, between -100 and 0).
 * - detection_duration: Minimum duration (in seconds) to consider as silence (number, required, >= 0.01).
 * - truncate_to: Duration (in seconds) to truncate detected silences to (number, required, >= 0.0).
 *
 * The handler performs the following steps:
 * 1. Parses and validates the input fields and file.
 * 2. Detects silence segments in the audio using ffmpeg.
 * 3. Splits the audio into segments, truncating silences as specified.
 * 4. Concatenates the processed segments into a single output file.
 * 5. Streams the resulting audio file back to the client as an attachment.
 * 6. Cleans up temporary files after processing.
 *
 * @param {import('next').NextApiRequest} req - The HTTP request object.
 * @param {import('next').NextApiResponse} res - The HTTP response object.
 * @returns {Promise<void>}
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  const outputDir = path.join(tmpPath, Date.now().toString());
  fs.mkdirSync(outputDir, { recursive: true });

  const form = new formidable.IncomingForm({
    uploadDir: outputDir,
    keepExtensions: true,
  });

  form.parse(req, async (err, fields, files) => {
    if (err) {
      clearFolder(outputDir);
      return res.status(500).send("Upload error");
    }

    const inputPath = files.audio?.filepath || files.audio?.path;
    let threshold, detection_duration, truncate_to, multiplier;

    if (!inputPath) {
      clearFolder(outputDir);
      return res.status(400).send("Missing audio file");
    }

    try {
      threshold = parseOrError(fields.threshold, "threshold", {
        min: -100,
        max: 0,
      });
      detection_duration = parseOrError(
        fields.detection_duration,
        "detection_duration",
        {
          min: 0.01,
        }
      );
      truncate_to = parseOrError(fields.truncate_to, "truncate_to", {
        min: 0.0,
      });
      multiplier = 1 + parseOrError(fields.tempo, "tempo") / 100;
    } catch (err) {
      clearFolder(outputDir);
      return res.status(400).json({ error: err.message });
    }

    // Example usage:
    try {
      const path1 = await truncate_silence(
        inputPath,
        threshold,
        detection_duration,
        truncate_to,
        outputDir
      );
      const outputPath = await change_tempo(path1, multiplier, outputDir);

      const stat = fs.statSync(outputPath);
      res.writeHead(200, {
        "Content-Type": "audio/wav",
        "Content-Length": stat.size,
        "Content-Disposition": 'attachment; filename="truncate_silence.mp3"',
      });
      fs.createReadStream(outputPath).pipe(res);
      await new Promise((resolve, reject) => {
        res.on("finish", resolve); // when response is fully sent
        res.on("error", reject); // if there is an error
      });
    } catch (err) {
      console.error("Processing error:", err);
      res.status(500).send("Processing failed");
    } finally {
      clearFolder(outputDir);
    }
  });
}

const parseOrError = (value, name, options = {}) => {
  const num = parseFloat(value);
  if (isNaN(num)) {
    throw new Error(`Invalid ${name}: must be a number`);
  }

  if ("min" in options && num < options.min) {
    throw new Error(`${name} must be >= ${options.min}`);
  }
  if ("max" in options && num > options.max) {
    throw new Error(`${name} must be <= ${options.max}`);
  }

  return num;
};
