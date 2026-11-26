import { AudioLines, Images, Upload, X, createElement } from "lucide";
import { extractOpenResponseText } from "./runtime/openresponses-client";
import { corexClient, type VoiceRecord } from "./runtime/corex-client";

const form = document.querySelector<HTMLFormElement>("#chat-form")!;
const prompt = document.querySelector<HTMLTextAreaElement>("#prompt")!;
const send = document.querySelector<HTMLButtonElement>("#send")!;
const retry = document.querySelector<HTMLButtonElement>("#retry")!;
const portrait = document.querySelector<HTMLVideoElement>("#portrait")!;
const turns = document.querySelector<HTMLDivElement>("#turns")!;
const threadEmpty = document.querySelector<HTMLParagraphElement>("#thread-empty")!;
const chatStatus = document.querySelector<HTMLParagraphElement>("#chat-status")!;
const renderStatus = document.querySelector<HTMLParagraphElement>("#render-status")!;
const playbackTiming = document.querySelector<HTMLParagraphElement>("#playback-timing")!;
const interpolate = document.querySelector<HTMLInputElement>("#interpolate")!;
const progressive = document.querySelector<HTMLInputElement>("#progressive")!;
const mime = 'video/mp4; codecs="avc1.42C01F, mp4a.40.2"';
const mseSupported = typeof MediaSource !== "undefined" && MediaSource.isTypeSupported(mime);
progressive.checked = mseSupported;
progressive.disabled = !mseSupported;

const stageEmpty = document.querySelector<HTMLDivElement>("#stage-empty")!;
const stagePortrait = document.querySelector<HTMLSpanElement>("#stage-portrait")!;
const stagePlaceholder = document.querySelector<HTMLParagraphElement>("#stage-placeholder")!;

interface Driver {
  id: string;
  label: string;
  persona: string;
  group: string;
  house?: string;
}
type Turn = { role: "user" | "assistant"; content: string };
const openGallery = document.querySelector<HTMLButtonElement>("#open-characters")!;
const activeDriverName = document.querySelector<HTMLSpanElement>("#active-driver-name")!;
const activeDriverThumb = document.querySelector<HTMLSpanElement>("#active-driver-thumb")!;
const gallery = document.querySelector<HTMLDialogElement>("#character-gallery")!;
const closeGallery = document.querySelector<HTMLButtonElement>("#close-characters")!;
const galleryGroups = Array.from(gallery.querySelectorAll<HTMLButtonElement>("#character-groups button"));
const galleryScroll = document.querySelector<HTMLDivElement>("#character-gallery-scroll")!;
const galleryCards = document.querySelector<HTMLDivElement>("#character-cards")!;
const galleryEmpty = document.querySelector<HTMLParagraphElement>("#character-gallery-empty")!;
const upload = document.querySelector<HTMLButtonElement>("#upload-driver")!;
const filePicker = document.querySelector<HTMLInputElement>("#driver-file")!;
const driverStatus = document.querySelector<HTMLParagraphElement>("#driver-status")!;
const openVoices = document.querySelector<HTMLButtonElement>("#open-voices")!;
const activeVoiceName = document.querySelector<HTMLElement>("#active-voice-name")!;
const voiceGallery = document.querySelector<HTMLDialogElement>("#voice-gallery")!;
const voiceCards = document.querySelector<HTMLDivElement>("#voice-cards")!;
const voiceCharacter = document.querySelector<HTMLParagraphElement>("#voice-gallery-character")!;
const closeVoices = document.querySelector<HTMLButtonElement>("#close-voices")!;
const voiceStatus = document.querySelector<HTMLParagraphElement>("#voice-status")!;
const character = document.querySelector<HTMLLabelElement>('label[for="prompt"]')!;
const drivers = new Map<string, Driver>();
const conversations = new Map<string, Turn[]>();
const sessionVoices = new Map<string, string>();
const reviewedGroup = "Reviewed drivers";
const matchedGroup = "Matched comparisons";
const uploadGroup = "Local uploads";
let selectedDriverId = "";
let galleryGroup = reviewedGroup;
let voiceCatalog: Map<string, VoiceRecord> | undefined;
let selectedVoice = "";
let runtimeReady = false;
let busy = false;

function setBusy(value: boolean) {
  busy = value;
  send.disabled = busy || drivers.size === 0 || !voiceCatalog;
  openGallery.disabled = busy;
  openVoices.disabled = busy || drivers.size === 0 || !voiceCatalog;
  upload.disabled = busy;
  galleryCards.querySelectorAll("button").forEach((button) => { button.disabled = busy; });
}

function friendlyName(raw: string) {
  return raw.replace(/[_-]+/g, " ").replace(/\b[A-Za-z][A-Za-z']*\b/g, (word) => {
    if (word.toLowerCase() === "kbllr") return "KBLLR";
    if (word === word.toUpperCase() || word === word.toLowerCase()) {
      return word[0].toUpperCase() + word.slice(1).toLowerCase();
    }
    return word;
  });
}

function driverTitle(driver: Driver) {
  if (driver.group !== matchedGroup) return friendlyName(driver.persona);
  const take = driver.label.endsWith(" · Control") ? "Control take" : "Test take";
  return `${friendlyName(driver.persona)} · ${take}`;
}

function fillThumbnail(element: HTMLElement, driver: Driver) {
  const image = document.createElement("img");
  image.alt = "";
  image.width = image.height = 256;
  image.decoding = "async";
  image.loading = "lazy";
  image.addEventListener("error", () => { image.hidden = true; }, { once: true });
  image.src = `/musetalk-driver-thumbnail/${encodeURIComponent(driver.id)}.jpg`;
  element.replaceChildren(friendlyName(driver.persona).slice(0, 2).toUpperCase(), image);
}

function showGalleryGroup(group: string) {
  galleryGroup = group;
  for (const button of galleryGroups) button.setAttribute("aria-pressed", String(button.dataset.group === group));
  const items = [...drivers.values()].filter((driver) => driver.group === group);
  if (group === reviewedGroup) items.sort((a, b) => friendlyName(a.persona).localeCompare(friendlyName(b.persona)));
  galleryCards.replaceChildren(...items.map((driver) => {
    const title = driverTitle(driver);
    const card = document.createElement("button");
    const thumbnail = document.createElement("span");
    const name = document.createElement("strong");
    card.type = "button";
    card.className = "musetalk-gallery__card";
    card.disabled = busy;
    card.setAttribute("aria-pressed", String(selectedDriverId === driver.id));
    card.setAttribute("aria-label", title);
    thumbnail.className = "musetalk-gallery__thumbnail";
    thumbnail.ariaHidden = "true";
    name.textContent = group === matchedGroup ? friendlyName(driver.persona) : title;
    fillThumbnail(thumbnail, driver);
    const details = document.createElement("span");
    details.className = "musetalk-gallery__card-copy";
    details.append(name);
    const subtitle = group === matchedGroup ? title.split(" · ").at(-1) : driver.house;
    if (subtitle) {
      const meta = document.createElement("small");
      meta.textContent = subtitle;
      meta.title = subtitle;
      details.append(meta);
    }
    card.append(thumbnail, details);
    card.addEventListener("click", () => {
      switchDriver(driver.id);
      gallery.close();
    });
    return card;
  }));
  galleryEmpty.hidden = Boolean(items.length);
  galleryEmpty.textContent = group === uploadGroup
    ? "Upload a video to add a character."
    : "No character videos are available in this collection.";
  galleryScroll.scrollTop = 0;
}

function voicePreferenceKey(driver: Driver) {
  const characterId = driver.group === uploadGroup ? driver.id : driver.persona.toLowerCase();
  return `avatar-labs:musetalk-chat:voice:${characterId}`;
}

function showVoice(voice: string) {
  selectedVoice = voice;
  activeVoiceName.textContent = friendlyName(voice || "lullabot");
}

function restoreVoice() {
  const driver = drivers.get(selectedDriverId);
  showVoice("");
  if (!driver) return;
  const key = voicePreferenceKey(driver);
  let saved = sessionVoices.get(key);
  if (saved === undefined) {
    try { saved = localStorage.getItem(key) ?? ""; }
    catch { /* The session still supports voice selection without storage. */ }
  }
  if (saved && voiceCatalog?.has(saved)) showVoice(saved);
  voiceStatus.textContent = !voiceCatalog ? "Loading local voices."
    : !voiceCatalog.size ? "Local voice catalog unavailable. Using the default voice."
    : saved && !selectedVoice ? "Saved voice unavailable. Using the default voice."
    : "";
}

async function loadVoiceCatalog() {
  try {
    const records = await corexClient.voices(AbortSignal.timeout(4000), "/api/audio");
    voiceCatalog = new Map(records.filter(({ name, has_sample }) =>
      name && name !== "lullabot" && has_sample !== false)
      .sort((a, b) => a.name.localeCompare(b.name)).map((record) => [record.name, record]));
  } catch {
    voiceCatalog = new Map();
  }
  restoreVoice();
  setBusy(busy);
}

function showDrivers(items: Driver[], selected = items[0]?.id ?? "") {
  drivers.clear();
  for (const item of items) drivers.set(item.id, item);
  switchDriver(selected);
}

let lastReply = "";
let objectUrl: string | undefined;
let playbackVersion = 0;

function appendFragment(buffer: SourceBuffer, chunk: Uint8Array<ArrayBuffer>) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      buffer.removeEventListener("updateend", updated);
      buffer.removeEventListener("error", failed);
    };
    const updated = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error("The browser rejected a MuseTalk video fragment.")); };
    buffer.addEventListener("updateend", updated);
    buffer.addEventListener("error", failed);
    try { buffer.appendBuffer(chunk); }
    catch (error) { cleanup(); reject(error); }
  });
}

async function playWhileRendering(body: ReadableStream<Uint8Array<ArrayBuffer>>) {
  const source = new MediaSource();
  const opened = new Promise<void>((resolve) => source.addEventListener("sourceopen", () => resolve(), { once: true }));
  objectUrl = URL.createObjectURL(source);
  portrait.src = objectUrl;
  portrait.hidden = false;
  await opened;
  const buffer = source.addSourceBuffer(mime);
  const reader = body.getReader();
  try {
    let playRequested = false;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      await appendFragment(buffer, value);
      if (!playRequested && buffer.buffered.length) {
        playRequested = true;
        renderStatus.textContent = "Playing while MuseTalk renders.";
        void portrait.play().catch(() => {});
      }
    }
    if (!buffer.buffered.length) throw new Error("MuseTalk returned no playable frames.");
    source.endOfStream();
    renderStatus.textContent = "Render complete.";
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

function addTurn(label: string, content: string) {
  const entry = document.createElement("article");
  entry.classList.toggle("musetalk-chat__turn--user", label === "You");
  const name = document.createElement("strong");
  const text = document.createElement("p");
  name.textContent = label;
  text.textContent = content;
  entry.append(name, text);
  threadEmpty.hidden = true;
  turns.append(entry);
  turns.scrollTop = turns.scrollHeight;
}

function clearPreview() {
  ++playbackVersion;
  retry.hidden = true;
  playbackTiming.hidden = true;
  delete playbackTiming.dataset.firstFrameMs;
  delete playbackTiming.dataset.turnToFirstFrameMs;
  portrait.pause();
  portrait.hidden = true;
  stageEmpty.hidden = false;
  portrait.removeAttribute("src");
  portrait.load();
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = undefined;
}

function switchDriver(id: string) {
  if (id === selectedDriverId) return;
  selectedDriverId = id;
  const driver = drivers.get(id);
  const name = driver ? friendlyName(driver.persona) : "";
  character.textContent = name ? `Message ${name}` : "Message";
  activeDriverName.textContent = driver ? driverTitle(driver) : "Choose character";
  activeDriverThumb.hidden = !driver;
  stagePortrait.hidden = !driver;
  stagePlaceholder.hidden = Boolean(driver);
  if (driver) {
    fillThumbnail(activeDriverThumb, driver);
    fillThumbnail(stagePortrait, driver);
  }
  restoreVoice();
  lastReply = "";
  clearPreview();
  renderStatus.textContent = "";
  turns.replaceChildren();
  threadEmpty.hidden = false;
  for (const turn of conversations.get(selectedDriverId) ?? []) {
    addTurn(turn.role === "user" ? "You" : name || "Character", turn.content);
  }
}

async function renderReply(submittedAt?: number) {
  clearPreview();
  const version = playbackVersion;
  const stream = progressive.checked && mseSupported;
  renderStatus.textContent = stream ? "Generating local speech. Waiting for the first frames."
    : "Generating local speech and rendering the video.";
  const started = performance.now();
  const measured = () => {
    if (version !== playbackVersion) return;
    const now = performance.now();
    const ms = now - started;
    if (submittedAt !== undefined) playbackTiming.dataset.turnToFirstFrameMs = String(Math.round(now - submittedAt));
    playbackTiming.dataset.firstFrameMs = String(Math.round(ms));
    playbackTiming.textContent = `First displayed frame · ${(ms / 1000).toFixed(2)} s after the text reply`;
    playbackTiming.hidden = false;
  };
  const frameCallback = portrait.requestVideoFrameCallback?.(measured);
  if (frameCallback === undefined) {
    portrait.addEventListener("loadeddata", measured, { once: true });
  }
  try {
    const response = await fetch("/api/musetalk-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: lastReply, driver: selectedDriverId, voice: selectedVoice || undefined,
        stream, interpolate: interpolate.checked,
      }),
    });
    if (!response.ok) throw new Error((await response.json()).error);
    if (stream && response.body) {
      await playWhileRendering(response.body);
      return;
    }
    const result = await response.json();
    portrait.src = result.video;
    portrait.hidden = false;
    renderStatus.textContent = "Video ready.";
    void portrait.play().catch(() => {});
  } catch (error) {
    if (frameCallback !== undefined) portrait.cancelVideoFrameCallback(frameCallback);
    else portrait.removeEventListener("loadeddata", measured);
    renderStatus.textContent = error instanceof Error ? error.message : "Video unavailable.";
    retry.hidden = false;
  } finally {
    setBusy(false);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submittedAt = performance.now();
  const content = prompt.value.trim();
  const driver = drivers.get(selectedDriverId);
  if (!content || send.disabled || !driver) return;
  setBusy(true);
  const history = conversations.get(driver.id) ?? [];
  conversations.set(driver.id, history);
  retry.hidden = true;
  prompt.value = "";
  addTurn("You", content);
  chatStatus.textContent = "Waiting for a local reply.";
  try {
    const response = await fetch("/api/llm/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "text/gpt-oss-20b-optiq-4bit",
        instructions: `You are the selected character in the Core-X Avatar Labs portrait harness. The selected character label is ${JSON.stringify(driver.persona)}. Reply directly in one short sentence, at most 18 words, with plain text suitable for speech.`,
        input: [...history.slice(-6), { role: "user", content }],
        reasoning: { effort: "low" },
        stream: false,
        max_output_tokens: 384,
      }),
      signal: AbortSignal.timeout(90000),
    });
    if (!response.ok) throw new Error(`Gateway reply failed (HTTP ${response.status}).`);
    lastReply = extractOpenResponseText(await response.json()).trim();
    if (!lastReply) throw new Error("The local model returned no reply.");
    if (lastReply.length > 360) {
      lastReply = lastReply.slice(0, 356).replace(/\s+\S*$/, "") + "…";
    }
    history.push({ role: "user", content }, { role: "assistant", content: lastReply });
    if (history.length > 6) history.splice(0, history.length - 6);
    addTurn(friendlyName(driver.persona), lastReply);
    chatStatus.textContent = "";
    await renderReply(submittedAt);
  } catch (error) {
    chatStatus.textContent = error instanceof Error ? error.message : "Local reply unavailable.";
    prompt.value = content;
    setBusy(false);
  }
});

retry.addEventListener("click", () => {
  if (!lastReply || send.disabled) return;
  setBusy(true);
  void renderReply();
});

portrait.addEventListener("error", () => {
  if (!portrait.getAttribute("src")) return;
  renderStatus.textContent = "This browser could not play the rendered MP4.";
  stageEmpty.hidden = false;
  portrait.hidden = true;
  retry.hidden = false;
});
portrait.addEventListener("loadeddata", () => { stageEmpty.hidden = true; });

openGallery.append(createElement(Images, { width: 18, height: 18, "aria-hidden": "true" }));
closeGallery.append(createElement(X, { width: 18, height: 18, "aria-hidden": "true" }));
upload.prepend(createElement(Upload, { width: 15, height: 15, "aria-hidden": "true" }));
openGallery.addEventListener("click", () => {
  showGalleryGroup(drivers.get(selectedDriverId)?.group ?? galleryGroup);
  gallery.showModal();
});
closeGallery.addEventListener("click", () => gallery.close());
for (const button of galleryGroups) {
  button.addEventListener("click", () => showGalleryGroup(button.dataset.group ?? reviewedGroup));
}

function selectVoice(driver: Driver, voice: string) {
  showVoice(voice);
  const key = voicePreferenceKey(driver);
  sessionVoices.set(key, voice);
  try {
    if (voice) localStorage.setItem(key, voice);
    else localStorage.removeItem(key);
    voiceStatus.textContent = "";
  } catch {
    voiceStatus.textContent = "Voice saved for this page only.";
  }
}

openVoices.prepend(createElement(AudioLines, { width: 21, height: 21, "aria-hidden": "true" }));
closeVoices.append(createElement(X, { width: 18, height: 18, "aria-hidden": "true" }));
closeVoices.addEventListener("click", () => voiceGallery.close());
openVoices.addEventListener("click", () => {
  const driver = drivers.get(selectedDriverId);
  if (!driver || !voiceCatalog) return;
  voiceCharacter.textContent = `Voice for ${friendlyName(driver.persona)}`;
  voiceCards.replaceChildren(...["", ...voiceCatalog.keys()].map((voice) => {
    const name = document.createElement("strong");
    name.textContent = friendlyName(voice || "lullabot");
    const details = document.createElement("span");
    details.className = "musetalk-gallery__card-copy";
    details.append(name);
    const description = voiceCatalog.get(voice)?.description;
    if (!voice || (description && !/^voice sample for /i.test(description))) {
      const meta = document.createElement("small");
      meta.textContent = voice ? description! : "Default voice";
      details.append(meta);
    }
    const card = document.createElement("button");
    card.type = "button";
    card.className = "musetalk-gallery__card musetalk-gallery__voice-card";
    card.setAttribute("aria-pressed", String(voice === selectedVoice));
    card.append(createElement(AudioLines, { width: 20, height: 20, "aria-hidden": "true" }), details);
    card.addEventListener("click", () => {
      selectVoice(driver, voice);
      voiceGallery.close();
    });
    return card;
  }));
  voiceGallery.showModal();
});
upload.addEventListener("click", () => filePicker.click());

filePicker.addEventListener("change", async () => {
  const file = filePicker.files?.[0];
  filePicker.value = "";
  if (!file || busy) return;
  if (!/\.(mp4|mov)$/i.test(file.name) || file.size > 64 * 1024 * 1024) {
    driverStatus.textContent = "Choose an MP4 or MOV of 64 MiB or less.";
    return;
  }
  setBusy(true);
  driverStatus.textContent = "Checking the uploaded video.";
  try {
    const response = await fetch("/api/musetalk-chat-driver", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream", "X-Driver-Name": encodeURIComponent(file.name) },
      body: file,
    });
    const result = await response.json();
    if (!response.ok) throw Error(result.error);
    showDrivers([...drivers.values(), result], result.id);
    showGalleryGroup(uploadGroup);
    driverStatus.textContent = `${friendlyName(result.persona)} added and selected.`;
    if (runtimeReady) chatStatus.textContent = "";
  } catch (error) {
    driverStatus.textContent = error instanceof Error ? error.message : "Upload unavailable.";
  } finally {
    setBusy(false);
  }
});

void fetch("/api/musetalk-chat").then(async (response) => {
  if (!response.ok) throw Error();
  const status = await response.json();
  runtimeReady = status.ready;
  showDrivers(status.drivers ?? []);
  chatStatus.textContent = !runtimeReady ? "Local render assets are unavailable. Text replies are still available."
    : drivers.size ? "" : "Upload a driver video to start.";
  setBusy(false);
  void loadVoiceCatalog();
}).catch(() => { chatStatus.textContent = "Open this harness from a local Avatar Labs dev or preview server."; });
