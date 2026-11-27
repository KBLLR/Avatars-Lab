import { driverLibrary } from "./drivers.mjs";
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, open, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
function startWorker(python, args, runnerSource) {
  const child = spawn(python, ["-m", "musetalk_runner.live", ...args], {
    detached: true,
    stdio: ["pipe", "pipe", "inherit"],
    env: { ...process.env, PYTHONPATH: runnerSource },
  });
  const lines = createInterface({ input: child.stdout });
  let closed = false;
  child.stdin.on("error", () => { /* The close event reports worker failure. */ });
  const stop = () => {
    if (closed || !child.pid) return;
    try { process.kill(-child.pid, "SIGKILL"); }
    catch (error) { if (error.code !== "ESRCH") console.error("[MuseTalk chat] Could not stop worker", error.code); }
  };
  child.once("close", () => { closed = true; });
  async function expect(type, signal, timeout) {
    const timer = AbortSignal.timeout(timeout);
    const cleanup = new AbortController();
    const wait = AbortSignal.any([signal, timer, cleanup.signal]);
    try {
      const message = await Promise.race([
        once(lines, "line", { signal: wait }).then(([line]) => JSON.parse(line)),
        once(child, "close", { signal: wait }).then(() => { throw Error("MuseTalk worker closed."); }),
      ]);
      if (message.type === "driver-error") throw new TurnError(422, "The driver could not be prepared. Choose a video with a clear face.");
      if (message.type !== type) throw Error("MuseTalk worker failed.");
    } finally {
      cleanup.abort();
    }
  }
  return { child, stop, expect, get closed() { return closed; } };
}

const videoPath = /^\/[a-f0-9-]{36}\/output\.mp4$/;

function plainLocal(req) {
  const host = req.headers.host ?? "";
  return req.socket.remoteAddress === "127.0.0.1"
    && /^127\.0\.0\.1(?::\d+)?$/.test(host)
    && req.headers["sec-fetch-site"] !== "cross-site"
    && (!req.headers.origin || req.headers.origin === `http://${host}`);
}

class TurnError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function readTurn(req) {
  if (req.headers["content-type"]?.split(";")[0] !== "application/json") {
    throw new TurnError(415, "Expected JSON.");
  }
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > 16000) throw new TurnError(413, "This turn is too long.");
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new TurnError(400, "Invalid turn.");
  }
}

async function resolveVoice(gateway, voice, signal) {
  if (voice === undefined) return "lullabot";
  if (typeof voice !== "string" || !voice || voice.length > 128) {
    throw new TurnError(400, "Choose an available local TTS voice.");
  }
  let voices;
  try {
    const response = await fetch(`${gateway}/v1/audio/voices`, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(4000)]),
    });
    if (!response.ok) throw Error();
    ({ voices } = await response.json());
    if (!Array.isArray(voices)) throw Error();
  } catch {
    throw new TurnError(503, "The local TTS voice catalog is unavailable.");
  }
  if (!voices.some((entry) => entry === voice || (entry?.name === voice && entry.has_sample !== false))) {
    throw new TurnError(400, "Choose an available local TTS voice.");
  }
  return voice;
}

async function requireMemory(signal) {
  const { stdout } = await run("/usr/sbin/sysctl", ["-n", "kern.memorystatus_vm_pressure_level"], { timeout: 2000, signal });
  if (!/^[01]$/.test(stdout.trim())) {
    throw new TurnError(503, "Memory pressure is elevated. Retry video when pressure returns to normal.");
  }
}

async function streamFragments(res, worker, directory, signal) {
  let done = false;
  let failure;
  const completion = worker.then(() => { done = true; }, (error) => { failure = error; done = true; });
  const partial = join(directory, "output.partial.mp4");
  const final = join(directory, "output.mp4");
  let file;
  try {
    while (!file && !done) {
      file = await open(partial, "r").catch((error) => {
        if (error.code !== "ENOENT") throw error;
        return undefined;
      });
      if (!file) await delay(60, undefined, { signal });
    }
    if (failure) throw failure;
    file ??= await open(final, "r");
    while (true) {
      const buffer = Buffer.alloc(64 * 1024);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, null);
      if (bytesRead) {
        if (!res.headersSent) res.writeHead(200, { "Content-Type": "video/mp4", "Cache-Control": "no-store" });
        if (!res.write(buffer.subarray(0, bytesRead))) await once(res, "drain", { signal });
      } else if (done) {
        if (failure) throw failure;
        break;
      } else {
        await delay(60, undefined, { signal });
      }
    }
  } finally {
    await file?.close();
    await completion;
  }
}

export function registerMuseTalkChat(middlewares, { env, gateway, modelRoot, serveStatic, runnerSource }) {
  const research = env("AVATAR_LABS_B3_RESEARCH_ROOT");
  const runner = env("AVATAR_LABS_MUSETALK_RUNNER")
    || (research && resolve(research, "venvs/runner/bin/musetalk-runner"));
  const python = env("AVATAR_LABS_MUSETALK_PYTHON") || (runner && join(dirname(runner), "python"));
  const weights = env("AVATAR_LABS_MUSETALK_WEIGHTS")
    || join(homedir(), "Library/Application Support/CoreX/research/musetalk-mlx/weights/MuseTalk-1.5-fp16");
  const drivers = driverLibrary({
    b3: research && resolve(research, "inputs/kbllr/b3-driving.mp4"),
    reviewRoot: env("AVATAR_LABS_PORTRAIT_REVIEW_ROOT"),
    uploadRoot: join(homedir(), "Library/Application Support/CoreX/research/musetalk-mlx/chat-drivers"),
  });
  const landmarker = join(modelRoot, "face_landmarker.task");
  const configured = () => [python, landmarker, ...["unet", "vae", "whisper_encoder"].map(
    (model) => join(weights, `${model}.safetensors`),
  )].every((path) => path && existsSync(path));

  // Keep review drafts outside the checkout and Warehouse. Only this server's
  // successful run IDs can be fetched, with range support from the asset bridge.
  let jobsRoot;
  const outputs = new Set();
  let active = false;
  let resident;
  let residentReady = false;
  const dispose = () => {
    resident?.stop();
    resident = undefined;
    residentReady = false;
  };

  middlewares.use("/musetalk-driver-thumbnail", async (req, res) => {
    const id = /^\/([a-z][a-z0-9-]{0,70})\.jpg$/.exec((req.url ?? "").split("?")[0])?.[1];
    if (!plainLocal(req) || !["GET", "HEAD"].includes(req.method) || !id) {
      return res.writeHead(404).end();
    }
    const image = await drivers.thumbnail(id).catch(() => null);
    if (res.destroyed) return;
    if (!image) return res.writeHead(404).end();
    res.writeHead(200, { "Content-Type": "image/jpeg", "Content-Length": image.length,
      "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" });
    res.end(req.method === "HEAD" ? undefined : image);
  });

  middlewares.use("/api/musetalk-chat-driver", async (req, res) => {
    if (!plainLocal(req)) return res.writeHead(403).end();
    if (req.method !== "POST") return res.writeHead(405).end();
    try {
      const id = await drivers.upload(req);
      const { path, ...driver } = drivers.list().get(id);
      res.writeHead(201, { "Content-Type": "application/json" }).end(JSON.stringify(driver));
    } catch (error) {
      if (!res.destroyed) res.writeHead(400, { "Content-Type": "application/json" })
        .end(JSON.stringify({ error: error.message }));
    }
  });

  middlewares.use("/api/musetalk-chat", async (req, res) => {
    const send = (status, value) => {
      if (res.destroyed) return;
      res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify(value));
    };
    if (!plainLocal(req)) return send(403, { error: "Local Avatar Labs only." });
    if (req.method === "GET") {
      const catalog = Array.from(drivers.list().values(), ({ path, ...driver }) => driver);
      return send(200, { ready: configured(), drivers: catalog, busy: active, resident: residentReady && !resident?.closed });
    }
    if (req.method !== "POST") return send(405, { error: "Method unavailable." });
    if (active) return send(409, { error: "A portrait is already rendering." });
    active = true;
    const cancel = new AbortController();
    res.on("close", () => { if (!res.writableEnded) { cancel.abort(); dispose(); } });
    const signal = cancel.signal;
    let stage = "preflight";
    const id = randomUUID();
    try {
      const turn = await readTurn(req);
      const text = typeof turn?.text === "string" ? turn.text.trim() : "";
      if (!text || text.length > 360) throw new TurnError(400, "Use a reply between 1 and 360 characters.");
      const driver = drivers.list().get(turn.driver ?? "kbllr");
      if (!driver) throw new TurnError(400, "Choose an available driver video.");
      const voice = await resolveVoice(gateway, turn.voice, signal);
      if (!configured()) throw new TurnError(503, "Configure the local runner and SSD weights.");
      await requireMemory(signal);
      jobsRoot ??= await mkdtemp(join(tmpdir(), "avatar-labs-musetalk-chat-"));
      if (!resident || resident.closed) {
        stage = "worker preparation";
        residentReady = false;
        resident = startWorker(python, [
          "--gateway", gateway, "--weights", weights, "--landmarker", landmarker,
          "--cache-dir", join(homedir(), "Library/Application Support/CoreX/research/musetalk-mlx/cache/face-latents"),
        ], runnerSource);
        await resident.expect("ready", signal, 180000);
        residentReady = true;
        await requireMemory(signal);
      }

      stage = "streaming speech and render";
      const stream = turn.stream === true;
      const directory = join(jobsRoot, id);
      await mkdir(directory);
      const worker = resident.expect("done", signal, 240000);
      resident.child.stdin.write(JSON.stringify({ text, voice, directory, stream, driver: driver.path, driver_id: driver.id, interpolate: turn.interpolate === true }) + "\n");
      if (stream) await streamFragments(res, worker, join(jobsRoot, id), signal);
      else await worker;

      const result = JSON.parse(await readFile(join(jobsRoot, id, "result.json"), "utf8"));
      if (!existsSync(join(jobsRoot, id, "output.mp4"))) throw new Error("Missing MP4");
      outputs.add(id);
      if (outputs.size > 8) {
        const oldest = outputs.values().next().value;
        outputs.delete(oldest);
        await rm(join(jobsRoot, oldest), { recursive: true, force: true }).catch(() => {});
      }
      if (stream) {
        res.end();
        return;
      }
      send(200, { video: `/musetalk-chat-output/${id}/output.mp4`, timings: result.timings_s });
    } catch (error) {
      if (!(error instanceof TurnError) || stage === "worker preparation") dispose();
      if (jobsRoot) await rm(join(jobsRoot, id), { recursive: true, force: true }).catch(() => {});
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (error instanceof TurnError) send(error.status, { error: error.message, stage });
      else {
        console.error(`[MuseTalk chat] ${stage} failed`, error.code ?? error.name);
        send(500, { error: `MuseTalk chat failed during ${stage}.`, stage });
      }
    } finally {
      active = false;
    }
  });

  // The static bridge resolves absolute paths once. Register it inside a
  // lightweight router so the private temporary root can be created lazily.
  const media = [];
  middlewares.use("/musetalk-chat-output", (req, res, next) => {
    const path = (req.url ?? "").split("?")[0];
    if (!plainLocal(req) || !["GET", "HEAD"].includes(req.method)
        || !videoPath.test(path) || !outputs.has(path.split("/")[1])) {
      res.writeHead(404).end();
      return;
    }
    if (!media.length) serveStatic({ use: (_route, handler) => media.push(handler) }, "/", jobsRoot);
    media[0](req, res, next);
  });
  return dispose;
}
