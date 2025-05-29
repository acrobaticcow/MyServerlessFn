import fs from "fs";
import { path as ffmpegPath } from "@ffmpeg-installer/ffmpeg";
import ffmpeg from "fluent-ffmpeg";
import formidable from "formidable-serverless";
import path from "path";
import os from "node:os";
import { clearFolder } from "../utils.js";

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
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  const oneTimePath = path.join(tmpPath, Date.now().toString());
  fs.mkdirSync(oneTimePath, { recursive: true });

  const form = new formidable.IncomingForm({
    uploadDir: oneTimePath,
    keepExtensions: true,
  });

  form.parse(req, async (err, fields, files) => {
    if (err) return res.status(500).send("Upload error");

    const inputPath = files.audio?.filepath || files.audio?.path;
    let threshold, detection_duration, truncate_to;
    const silenceLog = [];

    if (!inputPath) {
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
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    // Example usage:
    try {
      // 1. Detect silence
      const audioLength = await getDurationWithFFmpeg(inputPath);
      await new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .noVideo()
          .audioFilters(
            `silencedetect=noise=${threshold}dB:d=${detection_duration}`
          )
          .outputOptions("-f", "null") // force null output
          .on("stderr", (line) => {
            // console.log("🚀 ~ truncate_silence.js ~ .on ~ line:", line);
            const start = line.match(/silence_start: (\d+\.\d+)/);
            const end = line.match(/silence_end: (\d+\.\d+)/);

            if (start)
              silenceLog.push({ type: "start", time: parseFloat(start[1]) });
            if (end) silenceLog.push({ type: "end", time: parseFloat(end[1]) });
          })
          .on("end", resolve)
          .on("error", reject)
          .saveToFile(
            process.platform === "win32"
              ? "NUL"
              : process.platform === "linux"
              ? "/dev/null"
              : ""
          );
      });
      // 2. Compute segments
      if (!silenceLog.length) {
        // No silence detected, just return the original file as mp3
        const outputPath = path.join(oneTimePath, "output.mp3");
        await new Promise((resolve, reject) => {
          ffmpeg(inputPath)
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
          "Content-Type": "audio/wav",
          "Content-Length": stat.size,
          "Content-Disposition": 'attachment; filename="truncate_silence.mp3"',
        });
        fs.createReadStream(outputPath).pipe(res);
        await new Promise((resolve, reject) => {
          res.on("finish", resolve);
          res.on("error", reject);
        });
        return;
      }

      const segments = getSegments(silenceLog, truncate_to, audioLength);
      const segmentFiles = [];

      // 3. Extract audio segments and generate silences
      for (let i = 0; i < segments.length; i++) {
        const s = segments[i];

        if (s.type === "audio") {
          const segFile = path.join(oneTimePath, `seg_${i}.wav`);
          await new Promise((resolve, reject) => {
            ffmpeg(inputPath)
              .setStartTime(s.start)
              .setDuration(s.duration)
              .output(segFile)
              .on("end", resolve)
              .on("error", reject)
              .run();
          });
          await waitUntilFileIsStable(segFile);
          segmentFiles.push(segFile);
        } else {
          const segFile = path.join(oneTimePath, `seg_${i}_silence.wav`);
          await new Promise((resolve, reject) => {
            ffmpeg()
              .input("anullsrc=channel_layout=mono:sample_rate=44100")
              .inputOptions(["-f", "lavfi"])
              .outputOptions([`-t ${s.duration}`])
              .output(segFile)
              .on("end", resolve)
              .on("error", reject)
              .run();
          });
          await waitUntilFileIsStable(segFile);
          segmentFiles.push(segFile);
        }
      }

      // 4. Write concat list
      const listFile = path.join(oneTimePath, "list.txt");
      fs.writeFileSync(
        listFile,
        segmentFiles.map((f) => `file '${f}'`).join("\n")
      );

      // 5. Concat to output
      const outputPath = path.join(oneTimePath, "output.mp3");
      await new Promise((resolve, reject) => {
        ffmpeg()
          .input(listFile)
          .inputOptions(["-f", "concat", "-safe", "0"])
          .audioCodec("libmp3lame")
          .audioBitrate("128k")
          .outputOptions("-ar 44100") // optional: sample rate
          .output(outputPath)
          .on("end", resolve)
          .on("error", reject)
          .run();
      });

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
      clearFolder(oneTimePath);
    }
  });
}

// ⛏️ Extract audio/silence segments
function getSegments(logs, silenceDuration, audioLength) {
  const segments = [];
  let lastEnd = 0;

  for (let i = 0; i < logs.length; i++) {
    if (logs[i].type === "start" && logs[i + 1]?.type === "end") {
      const start = logs[i].time;
      const end = logs[i + 1].time;

      if (start > lastEnd) {
        segments.push({
          type: "audio",
          start: lastEnd,
          duration: start - lastEnd,
        });
      }

      segments.push({
        type: "silence",
        duration: silenceDuration,
      });

      if (end === logs[logs.length - 1].time && end < audioLength) {
        segments.push({
          type: "audio",
          start: end,
          duration: audioLength - end,
        });
      }

      lastEnd = end;
      i++; // skip next
    }
  }
  return segments;
}

function getDurationWithFFmpeg(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg(filePath)
      .output("-") // dummy output
      .on("start", (commandLine) => {
        // Nothing needed here, just to see the cmd if you're debugging
      })
      .on("stderr", (stderrLine) => {
        const match = stderrLine.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
        if (match) {
          const hours = parseInt(match[1], 10);
          const minutes = parseInt(match[2], 10);
          const seconds = parseFloat(match[3]);
          const duration = hours * 3600 + minutes * 60 + seconds;
          resolve(duration);
        }
      })
      .on("error", (err) => {
        reject(err);
      })
      .on("end", () => {
        // Edge case: duration not found before process ended
        reject(new Error("Could not determine duration"));
      })
      .run();
  });
}

// Usage
// getDurationWithFFmpeg(
//   "D:/Code/MyServerlessFn/Automation_Test_-vi-_part_1_-_79_words.mp3"
// )
//   .then((duration) => console.log(`Duration: ${duration} seconds`))
//   .catch((err) => console.error("Failed to get duration:", err));

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

function waitUntilFileIsStable(file, tries = 5, delay = 100) {
  return new Promise((resolve, reject) => {
    let prevSize = -1;
    let count = 0;

    const interval = setInterval(() => {
      if (!fs.existsSync(file)) return;
      const size = fs.statSync(file).size;
      if (size === prevSize) {
        clearInterval(interval);
        resolve();
      } else {
        prevSize = size;
        count++;
        if (count >= tries) {
          clearInterval(interval);
          reject(new Error(`File ${file} is not stabilizing.`));
        }
      }
    }, delay);
  });
}
