import fs from "fs";
import { path as ffmpegPath } from "@ffmpeg-installer/ffmpeg";
import ffmpeg from "fluent-ffmpeg";
import formidable from "formidable-serverless";
import path from "path";

ffmpeg.setFfmpegPath(ffmpegPath);

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  const form = new formidable.IncomingForm({
    uploadDir: "/tmp",
    keepExtensions: true,
  });

  form.parse(req, async (err, fields, files) => {
    if (err) return res.status(500).send("Upload error");

    // clearTmpFolder();

    const inputPath = files.audio.path;
    const silenceLog = [];

    // Example usage:
    try {
      // 1. Detect silence
      const audioLength = await getDurationWithFFmpeg(inputPath);
      await new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .noVideo()
          .audioFilters("silencedetect=noise=-35dB:d=0.3")
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
      //   console.log(
      //     "🚀 ~ truncate_silence.js ~ form.parse ~ silenceLog:",
      //     silenceLog
      //   );

      // 2. Compute segments
      const segments = getSegments(silenceLog, 0.2, audioLength);
      //   console.log(
      //     "🚀 ~ truncate_silence.js ~ form.parse ~ segments:",
      //     segments
      //   );
      const segmentFiles = [];

      // 3. Extract audio segments and generate silences
      for (let i = 0; i < segments.length; i++) {
        const s = segments[i];

        if (s.type === "audio") {
          const segFile = `/tmp/seg_${i}.wav`;
          await new Promise((resolve, reject) => {
            ffmpeg(inputPath)
              .setStartTime(s.start)
              .setDuration(s.duration)
              .output(segFile)
              .on("end", resolve)
              .on("error", reject)
              .run();
          });
          segmentFiles.push(segFile);
        } else {
          const segFile = `/tmp/seg_${i}_silence.wav`;
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
          segmentFiles.push(segFile);
        }
      }

      // 4. Write concat list
      const listFile = "/tmp/list.txt";
      fs.writeFileSync(
        listFile,
        segmentFiles.map((f) => `file '${f}'`).join("\n")
      );

      // 5. Concat to output
      const outputPath = "/tmp/output.wav";
      await new Promise((resolve, reject) => {
        ffmpeg()
          .input(listFile)
          .inputOptions(["-f", "concat", "-safe", "0"])
          .outputOptions(["-c", "copy"])
          .output(outputPath)
          .on("end", resolve)
          .on("error", reject)
          .run();
      });

      res.setHeader("Content-Type", "audio/wav");
      fs.createReadStream(outputPath).pipe(res);
    } catch (err) {
      console.error("Processing error:", err);
      res.status(500).send("Processing failed");
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

      if (start >= 15.317) {
        console.log();
      }

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
  console.log("🚀 ~ truncate_silence.js ~ getSegments ~ segments:", segments);
  return segments;
}

function clearTmpFolder() {
  const tmpDir = path.join(process.cwd(), "tmp");
  const files = fs.readdirSync(tmpDir);
  files.forEach((file) => fs.unlinkSync(path.join(tmpDir, file)));
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
