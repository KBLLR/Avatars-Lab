import fs from "node:fs";
import path from "node:path";

const findLatestEventFile = (root, stream) => {
  const streamDir = path.join(root, "events", stream);
  if (!fs.existsSync(streamDir)) return null;
  const entries = fs.readdirSync(streamDir).filter((name) => name.endsWith(".jsonl"));
  if (!entries.length) return null;
  entries.sort();
  return path.join(streamDir, entries[entries.length - 1]);
};

const readEventsSince = (filePath, sinceEpochMs) => {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, "utf-8").split(/\r?\n/).filter(Boolean);
  const events = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      const timestamp = Date.parse(parsed.timestamp || "");
      if (!Number.isNaN(timestamp) && timestamp >= sinceEpochMs) {
        events.push(parsed);
      }
    } catch {
      continue;
    }
  }
  return events;
};

export {
  findLatestEventFile,
  readEventsSince
};
