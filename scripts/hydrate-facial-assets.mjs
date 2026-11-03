import { createWriteStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";

const houseRoot = resolve(import.meta.dirname, "..");
const target = resolve(
  process.env.COREX_FACE_LANDMARKER_TASK_PATH ||
    resolve(houseRoot, "../../warehouse/var/cache/objects/avatar-labs/intake-2026-05-05/public/mediapipe/face_landmarker.task"),
);
const source = process.env.AVATAR_LABS_FACE_LANDMARKER_URL ||
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

if (existsSync(target) && statSync(target).size > 1_000_000) {
  console.log(`[facial-assets] face landmarker ready: ${target}`);
  process.exit(0);
}

mkdirSync(dirname(target), { recursive: true });
const temporary = `${target}.tmp`;
const response = await fetch(source);
if (!response.ok || !response.body) {
  throw new Error(`Face Landmarker download failed (${response.status}) from ${source}`);
}
try {
  await finished(Readable.fromWeb(response.body).pipe(createWriteStream(temporary)));
  if (statSync(temporary).size < 1_000_000) throw new Error("Downloaded Face Landmarker asset is unexpectedly small.");
  renameSync(temporary, target);
} catch (error) {
  if (existsSync(temporary)) unlinkSync(temporary);
  throw error;
}
console.log(`[facial-assets] hydrated local Google MediaPipe model: ${target}`);
