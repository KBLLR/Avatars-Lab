import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream, existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, parse } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

const probe = promisify(execFile);
const MAX_BYTES = 64 * 1024 * 1024;
const validId = /^[a-z][a-z0-9-]{0,70}$/;
const uploadId = /^upload-[0-9a-f-]{36}$/;

export function driverLibrary({ reviewRoot, b3, uploadRoot }) {
  const thumbnails = new Map();
  let thumbnailQueue = Promise.resolve();

  function list() {
    const entries = new Map();
    if (b3 && existsSync(b3)) entries.set("kbllr", {
      id: "kbllr", label: "kbllr · B3", persona: "kbllr", house: "Core-X", path: b3, group: "Reviewed drivers",
    });
    if (reviewRoot && existsSync(join(reviewRoot, "review.json"))) {
      let catalog;
      try { catalog = JSON.parse(readFileSync(join(reviewRoot, "review.json"), "utf8")); }
      catch { catalog = []; }
      for (const entry of Array.isArray(catalog) ? catalog : []) {
        if (!validId.test(entry?.id ?? "") || typeof entry.persona !== "string") continue;
        const path = join(reviewRoot, `${entry.id}-driver.mp4`);
        if (existsSync(path) && !entries.has(entry.id)) entries.set(entry.id, {
          id: entry.id, label: entry.persona, persona: entry.persona.split(" · ")[0], path,
          house: typeof entry.house === "string" ? entry.house.split(" (")[0] : undefined,
          group: entry.id.startsWith("pair-") ? "Matched comparisons" : "Reviewed drivers",
        });
      }
    }
    if (existsSync(uploadRoot)) {
      for (const item of readdirSync(uploadRoot, { withFileTypes: true })) {
        if (!item.isDirectory() || !uploadId.test(item.name)) continue;
        const dir = join(uploadRoot, item.name);
        try {
          const { label } = JSON.parse(readFileSync(join(dir, "driver.json"), "utf8"));
          const path = join(dir, "driver.mp4");
          if (typeof label === "string" && existsSync(path)) entries.set(item.name, {
            id: item.name, label, persona: label, path, group: "Local uploads",
          });
        } catch { /* Failed or interrupted uploads do not enter the picker. */ }
      }
    }
    return entries;
  }

  async function thumbnail(id) {
    const driver = list().get(id);
    if (!driver) return null;
    const { size, mtimeMs } = await stat(driver.path);
    const version = `${size}:${mtimeMs}`;
    const cached = thumbnails.get(id);
    if (cached?.version === version) return cached.image;

    // Keep decoding serial and small when the browser opens the full grid.
    const image = thumbnailQueue.then(async () => {
      const { stdout } = await probe("ffmpeg", [
        "-nostdin", "-v", "error", "-threads", "1", "-protocol_whitelist", "file,pipe",
        "-f", "mov", "-i", driver.path, "-map", "0:v:0", "-frames:v", "1",
        "-filter_threads", "1", "-vf", "crop='min(iw,ih)':'min(iw,ih)',scale=256:256:flags=lanczos",
        "-an", "-c:v", "mjpeg", "-q:v", "4", "-threads", "1", "-f", "image2pipe", "pipe:1",
      ], { timeout: 5000, maxBuffer: 512 * 1024, encoding: "buffer" });
      if (!stdout.length) throw Error("Driver returned no thumbnail frame.");
      return stdout;
    });
    thumbnailQueue = image.catch(() => {});
    thumbnails.set(id, { version, image });
    if (thumbnails.size > 64) thumbnails.delete(thumbnails.keys().next().value);
    try {
      return await image;
    } catch (error) {
      if (thumbnails.get(id)?.image === image) thumbnails.delete(id);
      throw error;
    }
  }

  async function upload(req) {
    const length = Number(req.headers["content-length"]);
    if (length > MAX_BYTES) throw Error("Upload a video of 64 MiB or less.");
    const label = parse(basename(decodeURIComponent(req.headers["x-driver-name"] ?? "New driver"))).name.trim().slice(0, 80);
    const id = `upload-${randomUUID()}`;
    await mkdir(uploadRoot, { recursive: true, mode: 0o700 });
    const dir = join(uploadRoot, id);
    await mkdir(dir, { mode: 0o700 });
    try {
      const path = join(dir, "driver.mp4");
      let bytes = 0;
      const limit = new Transform({
        transform(chunk, _, cb) {
          bytes += chunk.length;
          cb(bytes > MAX_BYTES ? Error("Upload a video of 64 MiB or less.") : null, chunk);
        },
      });
      // Validate the file via the local MOV demuxer, without probing URLs or
      // interpreting playlists as uploads.
      await pipeline(req, limit, createWriteStream(path, { mode: 0o600 }));
      let result;
      try {
        const { stdout } = await probe("ffprobe", ["-v", "error", "-protocol_whitelist", "file,pipe", "-f", "mov",
          "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", path],
        { timeout: 5000 });
        result = JSON.parse(stdout);
      } catch {
        throw Error("Choose a valid MP4 or MOV video.");
      }
      const video = result.streams?.[0];
      const seconds = Number(result.format?.duration);
      if (!video?.width || !video.height || video.width > 3840 || video.height > 3840
          || !Number.isFinite(seconds) || seconds < 0.08 || seconds > 30) {
        throw Error("Choose a video between 0.08 and 30 seconds, up to 3840 pixels per side.");
      }
      await writeFile(join(dir, "driver.json"), JSON.stringify({ label: label || "New driver" }), { mode: 0o600 });
      return id;
    } catch (error) {
      await rm(dir, { recursive: true, force: true });
      throw error;
    }
  }

  return { list, thumbnail, upload };
}
