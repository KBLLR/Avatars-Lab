import { TalkingHead } from "@met4citizen/talkinghead";
import { HeadAudio } from "@met4citizen/headaudio/dist/headaudio.min.mjs";
import workletUrl from "@met4citizen/headaudio/dist/headworklet.min.mjs?url";
import modelUrl from "@met4citizen/headaudio/dist/model-en-mixed.bin?url";
import { getMlxConfig } from "./mlx-config";

type Mode = "push" | "vad";

const els = {
  status: document.getElementById("status") as HTMLElement,
  avatar: document.getElementById("avatar") as HTMLElement,
  avatarSelect: document.getElementById("avatarSelect") as HTMLSelectElement,
  startBtn: document.getElementById("startBtn") as HTMLButtonElement,
  stopBtn: document.getElementById("stopBtn") as HTMLButtonElement,
  pushModeBtn: document.getElementById("pushModeBtn") as HTMLButtonElement,
  vadModeBtn: document.getElementById("vadModeBtn") as HTMLButtonElement,
  recordBtn: document.getElementById("recordBtn") as HTMLButtonElement,
  levelMeter: document.getElementById("levelMeter") as HTMLElement,
  vadThreshold: document.getElementById("vadThreshold") as HTMLInputElement,
  vadSilence: document.getElementById("vadSilence") as HTMLInputElement,
  voiceInput: document.getElementById("voiceInput") as HTMLInputElement,
  log: document.getElementById("log") as HTMLElement,
  llmChip: document.getElementById("llmChip") as HTMLElement,
  ttsChip: document.getElementById("ttsChip") as HTMLElement,
  sttChip: document.getElementById("sttChip") as HTMLElement
};

const config = getMlxConfig();

const instructions = [
  "You are Julia, a clear and conversational assistant.",
  "Listen for user speech, wait for a brief pause before responding.",
  "If unclear, ask a brief clarifying question.",
  "You can control your avatar with function calls.",
  "Use gestures and mood shifts to amplify intent."
].join("\n");

const functionDefs = [
  {
    type: "function",
    name: "set_mood",
    description: "Set the avatar mood (applies mood animations and morph baselines).",
    parameters: {
      type: "object",
      properties: {
        mood: {
          type: "string",
          enum: ["neutral", "happy", "angry", "sad", "fear", "disgust", "love", "sleep"],
          description: "Mood name"
        }
      },
      required: ["mood"]
    }
  },
  {
    type: "function",
    name: "play_gesture",
    description: "Play a named hand gesture or animated emoji.",
    parameters: {
      type: "object",
      properties: {
        gesture: {
          type: "string",
          description: "Gesture name or emoji (e.g. 'handup', 'index', 'ok', 'thumbup', 'thumbdown', 'side', 'shrug', 'namaste' or emoji character)"
        },
        duration: {
          type: "number",
          description: "Duration in seconds (optional)."
        },
        mirror: {
          type: "boolean",
          description: "If true, mirror gesture to the other hand (optional)."
        },
        ms: {
          type: "number",
          description: "Transition time in milliseconds (optional)."
        }
      },
      required: ["gesture"]
    }
  },
  {
    type: "function",
    name: "stop_gesture",
    description: "Stop current gesture (graceful transition).",
    parameters: {
      type: "object",
      properties: {
        ms: { type: "number", description: "Transition time in milliseconds (optional)." }
      }
    }
  },
  {
    type: "function",
    name: "make_facial_expression",
    description: "Trigger a facial expression using an emoji template.",
    parameters: {
      type: "object",
      properties: {
        emoji: { type: "string", description: "Single face emoji or emoji name to play." },
        duration: { type: "number", description: "Duration in seconds (optional)." }
      },
      required: ["emoji"]
    }
  },
  {
    type: "function",
    name: "speak_break",
    description: "Insert a pause/break into the speech/animation queue.",
    parameters: {
      type: "object",
      properties: {
        duration_ms: { type: "number", description: "Break length in milliseconds." }
      },
      required: ["duration_ms"]
    }
  },
  {
    type: "function",
    name: "speak_marker",
    description: "Insert a marker callback into the speech queue (useful for timing).",
    parameters: {
      type: "object",
      properties: {
        marker: { type: "string", description: "Marker id or name. Client will receive marker event." }
      },
      required: ["marker"]
    }
  },
  {
    type: "function",
    name: "look_at",
    description: "Make the avatar look at a screen position (x,y) for t milliseconds.",
    parameters: {
      type: "object",
      properties: {
        x: { type: "number", description: "Normalized screen X position (0..1) or pixel value depending on your UI." },
        y: { type: "number", description: "Normalized screen Y position (0..1) or pixel value depending on your UI." },
        t: { type: "number", description: "Duration in milliseconds (optional)." }
      },
      required: ["x", "y"]
    }
  },
  {
    type: "function",
    name: "look_at_camera",
    description: "Make the avatar look at the camera for t milliseconds.",
    parameters: {
      type: "object",
      properties: {
        t: { type: "number", description: "Duration in milliseconds." }
      },
      required: ["t"]
    }
  },
  {
    type: "function",
    name: "make_eye_contact",
    description: "Force the avatar to maintain eye contact for t milliseconds.",
    parameters: {
      type: "object",
      properties: {
        t: { type: "number", description: "Duration in milliseconds." }
      },
      required: ["t"]
    }
  },
  {
    type: "function",
    name: "set_value",
    description: "Set a morph-target (blendshape) or custom property value with optional transition.",
    parameters: {
      type: "object",
      properties: {
        mt: { type: "string", description: "Morph-target name or custom property (see allowed list)." },
        value: { type: "number", description: "Target value." },
        ms: { type: "number", description: "Transition time in milliseconds (optional)." }
      },
      required: ["mt", "value"]
    }
  },
  {
    type: "function",
    name: "get_value",
    description: "Read the current value of a morph-target or custom property.",
    parameters: {
      type: "object",
      properties: {
        mt: { type: "string", description: "Morph-target or custom property name." }
      },
      required: ["mt"]
    }
  },
  {
    type: "function",
    name: "play_background_audio",
    description: "Play looped background or ambient audio.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Audio URL to play." },
        volume: { type: "number", description: "Volume (0..1, optional)." }
      },
      required: ["url"]
    }
  },
  {
    type: "function",
    name: "stop_background_audio",
    description: "Stop background audio playback.",
    parameters: {
      type: "object",
      properties: {}
    }
  },
  {
    type: "function",
    name: "start",
    description: "Start/restart the TalkingHead animation loop.",
    parameters: {
      type: "object",
      properties: {}
    }
  },
  {
    type: "function",
    name: "stop",
    description: "Stop the TalkingHead animation loop.",
    parameters: {
      type: "object",
      properties: {}
    }
  },
  {
    type: "function",
    name: "start_listening",
    description: "Begin VAD/listening using the client's analyser settings (server may just forward the command).",
    parameters: {
      type: "object",
      properties: {
        listeningSilenceThresholdLevel: { type: "number" },
        listeningSilenceThresholdMs: { type: "number" },
        listeningActiveThresholdLevel: { type: "number" },
        listeningActiveThresholdMs: { type: "number" }
      }
    }
  },
  {
    type: "function",
    name: "stop_listening",
    description: "Stop VAD/listening.",
    parameters: {
      type: "object",
      properties: {}
    }
  }
];

const state = {
  head: null as TalkingHead | null,
  headaudio: null as HeadAudio | null,
  micStream: null as MediaStream | null,
  micSource: null as MediaStreamAudioSourceNode | null,
  micAnalyser: null as AnalyserNode | null,
  micProcessor: null as ScriptProcessorNode | null,
  silenceGain: null as GainNode | null,
  vadBuffer: new Float32Array(2048),
  mode: "push" as Mode,
  sessionActive: false,
  isRecording: false,
  recordStart: 0,
  lastVoiceAt: 0,
  audioChunks: [] as Float32Array[],
  totalSamples: 0,
  messages: [{ role: "system", content: instructions }] as Array<Record<string, any>>,
  busy: false
};

const updateStatus = (text: string) => {
  els.status.textContent = text;
};

const setChip = (el: HTMLElement, label: string, value?: string) => {
  el.textContent = `${label}: ${value || "-"}`;
};

const addBubble = (role: "user" | "assistant" | "tool", text: string) => {
  const bubble = document.createElement("div");
  bubble.className = `bubble ${role === "tool" ? "assistant" : role}`;
  bubble.textContent = text;
  els.log.appendChild(bubble);
  els.log.scrollTop = els.log.scrollHeight;
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const encodeWav = (samples: Float32Array, sampleRate: number) => {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const s = clamp(samples[i], -1, 1);
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return buffer;
};

const mergeChunks = (chunks: Float32Array[], totalSamples: number) => {
  const merged = new Float32Array(totalSamples);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
};

const updateModeUI = () => {
  const isPush = state.mode === "push";
  els.pushModeBtn.classList.toggle("primary", isPush);
  els.vadModeBtn.classList.toggle("primary", !isPush);
  els.recordBtn.textContent = isPush ? "Hold to Talk" : "Auto-VAD Listening";
  els.recordBtn.disabled = !state.sessionActive || !isPush;
};

const applyFunctionCall = (name: string, args: any) => {
  if (!state.head) {
    return { ok: false, error: "Avatar not initialized." };
  }

  switch (name) {
    case "set_mood":
      if (args?.mood) {
        state.head.setMood(args.mood);
        return { ok: true };
      }
      return { ok: false, error: "Missing mood." };
    case "play_gesture":
    case "make_hand_gesture":
      if (args?.gesture) {
        state.head.playGesture(args.gesture, args.duration ?? 3, args.mirror ?? false, args.ms ?? 1000);
        state.head.speakWithHands();
        return { ok: true };
      }
      return { ok: false, error: "Missing gesture." };
    case "stop_gesture":
      state.head.stopGesture(args?.ms ?? 1000);
      return { ok: true };
    case "make_facial_expression":
      if (args?.emoji) {
        state.head.speakEmoji(args.emoji);
        return { ok: true };
      }
      return { ok: false, error: "Missing emoji." };
    case "speak_break":
      if (typeof args?.duration_ms === "number") {
        state.head.speakBreak(args.duration_ms);
        return { ok: true };
      }
      return { ok: false, error: "Missing duration_ms." };
    case "speak_marker":
      if (args?.marker) {
        const marker = String(args.marker);
        state.head.speakMarker(() => {
          addBubble("tool", `marker: ${marker}`);
        });
        return { ok: true };
      }
      return { ok: false, error: "Missing marker." };
    case "look_at":
      if (typeof args?.x === "number" && typeof args?.y === "number") {
        state.head.lookAt(args.x, args.y, args.t ?? 600);
        return { ok: true };
      }
      return { ok: false, error: "Missing x/y." };
    case "look_at_camera":
    case "make_eye_contact":
      if (typeof args?.t === "number") {
        state.head.lookAtCamera(args.t);
        return { ok: true };
      }
      return { ok: false, error: "Missing t." };
    case "set_value":
      if (args?.mt && typeof args?.value === "number") {
        state.head.setValue(args.mt, args.value, args.ms ?? null);
        return { ok: true };
      }
      return { ok: false, error: "Missing mt/value." };
    case "get_value":
      if (args?.mt) {
        const value = state.head.getValue(args.mt);
        return { ok: true, value };
      }
      return { ok: false, error: "Missing mt." };
    case "play_background_audio":
      if (args?.url) {
        state.head.playBackgroundAudio(args.url);
        if (typeof args.volume === "number") {
          state.head.setMixerGain(null, Math.max(0, Math.min(1, args.volume)));
        }
        return { ok: true };
      }
      return { ok: false, error: "Missing url." };
    case "stop_background_audio":
      state.head.stopBackgroundAudio();
      return { ok: true };
    case "start":
      state.head.start();
      return { ok: true };
    case "stop":
      state.head.stop();
      return { ok: true };
    case "start_listening": {
      if (!state.sessionActive) {
        return { ok: false, error: "Session not active." };
      }
      if (!state.micAnalyser) {
        setupMic().catch(() => null);
      }
      if (typeof args?.listeningSilenceThresholdLevel === "number") {
        els.vadThreshold.value = String(args.listeningSilenceThresholdLevel);
      }
      if (typeof args?.listeningSilenceThresholdMs === "number") {
        els.vadSilence.value = String(args.listeningSilenceThresholdMs);
      }
      state.mode = "vad";
      updateModeUI();
      requestAnimationFrame(runVadLoop);
      return { ok: true };
    }
    case "stop_listening":
      state.mode = "push";
      updateModeUI();
      if (state.isRecording) {
        stopRecording().catch(() => null);
      }
      return { ok: true };
    default:
      return { ok: false, error: `Unknown function ${name}` };
  }
};

const createHead = () => {
  const head = new TalkingHead(els.avatar, {
    ttsEndpoint: "N/A",
    lipsyncLang: "en",
    lipsyncModules: [],
    cameraView: "upper",
    mixerGainSpeech: 3,
    cameraDistance: -0.9,
    cameraRotateEnable: false,
    lightAmbientIntensity: 0.4,
    lightDirectIntensity: 1.4,
    lightSpotIntensity: 1.2
  });
  return head;
};

const resetMicNodes = () => {
  state.micSource?.disconnect();
  state.micAnalyser?.disconnect();
  state.micProcessor?.disconnect();
  state.silenceGain?.disconnect();
  state.micSource = null;
  state.micAnalyser = null;
  state.micProcessor = null;
  state.silenceGain = null;
};

const resetHead = () => {
  resetMicNodes();
  if (state.head && typeof state.head.dispose === "function") {
    state.head.dispose();
  }
  state.head = createHead();
  state.headaudio = null;
};

const callLLM = async (messages: Array<Record<string, any>>) => {
  const response = await fetch(`${config.llmBaseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.llmModel,
      messages,
      tools: functionDefs,
      tool_choice: "auto"
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`LLM error (${response.status}): ${detail}`);
  }

  return response.json();
};

const speakResponse = async (text: string) => {
  if (!state.head) return;

  const voice = els.voiceInput.value.trim() || config.ttsVoice;
  const response = await fetch(`${config.audioBaseUrl}/v1/audio/speech`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.ttsModel,
      input: text,
      voice,
      response_format: "wav",
      speed: 1.0
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`TTS error (${response.status}): ${detail}`);
  }

  const wavBuffer = await response.arrayBuffer();
  await state.head.audioCtx.resume();
  const audioBuffer = await state.head.audioCtx.decodeAudioData(wavBuffer.slice(0));

  const pcm = new Int16Array(audioBuffer.length);
  const channel = audioBuffer.getChannelData(0);
  for (let i = 0; i < channel.length; i += 1) {
    const sample = clamp(channel[i], -1, 1);
    pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }

  await state.head.streamStart(
    {
      sampleRate: audioBuffer.sampleRate,
      lipsyncType: "visemes",
      gain: 0.75,
      waitForAudioChunks: false
    },
    () => {
      updateStatus("Speaking...");
    },
    () => {
      updateStatus("Listening...");
    }
  );

  state.head.streamAudio({
    audio: pcm.buffer
  });
  state.head.streamNotifyEnd();
};

const handleUserText = async (text: string) => {
  if (!text) return;
  if (!config.llmModel) {
    updateStatus("Missing VITE_MLX_DEFAULT_LLM_MODEL");
    return;
  }

  addBubble("user", text);
  state.messages.push({ role: "user", content: text });
  updateStatus("Thinking...");

  const llmResponse = await callLLM(state.messages);
  const assistant = llmResponse?.choices?.[0]?.message;
  if (!assistant) {
    throw new Error("LLM response missing assistant message.");
  }

  state.messages.push(assistant);

  if (assistant.tool_calls?.length) {
    const toolMessages = [] as Array<Record<string, any>>;
    for (const call of assistant.tool_calls) {
      const name = call.function?.name;
      const rawArgs = call.function?.arguments || "{}";
      let args = {};
      try {
        args = JSON.parse(rawArgs);
      } catch {
        args = {};
      }
      const result = applyFunctionCall(name, args);
      toolMessages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result ?? { ok: true })
      });
      addBubble("tool", `${name}: ${rawArgs}`);
    }

    state.messages.push(...toolMessages);

    if (!assistant.content) {
      const followUp = await callLLM(state.messages);
      const followMsg = followUp?.choices?.[0]?.message;
      if (followMsg?.content) {
        state.messages.push(followMsg);
        addBubble("assistant", followMsg.content);
        await speakResponse(followMsg.content);
        return;
      }
    }
  }

  if (assistant.content) {
    addBubble("assistant", assistant.content);
    await speakResponse(assistant.content);
  }
};

const sendToStt = async (wavBuffer: ArrayBuffer) => {
  if (!config.sttModel) {
    updateStatus("Missing VITE_MLX_DEFAULT_STT_MODEL");
    return;
  }
  const form = new FormData();
  form.append("file", new Blob([wavBuffer], { type: "audio/wav" }), "speech.wav");
  form.append("model", config.sttModel);

  const response = await fetch(`${config.audioBaseUrl}/v1/audio/transcriptions`, {
    method: "POST",
    body: form
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`STT error (${response.status}): ${detail}`);
  }

  const payload = await response.json();
  return payload?.text || "";
};

const startRecording = (reason: string) => {
  if (state.isRecording || !state.micProcessor || !state.head) return;
  state.isRecording = true;
  state.recordStart = performance.now();
  state.audioChunks = [];
  state.totalSamples = 0;
  updateStatus(reason === "vad" ? "Listening..." : "Recording...");
  els.recordBtn.textContent = reason === "vad" ? "Auto-VAD Listening" : "Release to Send";
};

const stopRecording = async () => {
  if (!state.isRecording || !state.head) return;
  state.isRecording = false;
  els.recordBtn.textContent = state.mode === "push" ? "Hold to Talk" : "Auto-VAD Listening";

  const samples = mergeChunks(state.audioChunks, state.totalSamples);
  if (!samples.length) {
    updateStatus("No speech detected.");
    return;
  }

  const wavBuffer = encodeWav(samples, state.head.audioCtx.sampleRate);
  updateStatus("Transcribing...");
  const text = await sendToStt(wavBuffer);
  if (!text) {
    updateStatus("No transcript returned.");
    return;
  }

  updateStatus("Processing... ");
  await handleUserText(text);
};

const updateMeter = (rms: number) => {
  const percent = clamp((rms * 200) * 100, 0, 100);
  els.levelMeter.style.width = `${percent}%`;
};

const runVadLoop = () => {
  if (!state.sessionActive || state.mode !== "vad" || !state.micAnalyser) return;
  state.micAnalyser.getFloatTimeDomainData(state.vadBuffer);
  const rms = Math.sqrt(state.vadBuffer.reduce((sum, v) => sum + v * v, 0) / state.vadBuffer.length);
  updateMeter(rms);

  const db = 20 * Math.log10(rms || 1e-6);
  const threshold = Number(els.vadThreshold.value || -48);
  const silenceMs = Number(els.vadSilence.value || 600);
  const now = performance.now();

  if (db > threshold && !state.head?.isSpeaking) {
    state.lastVoiceAt = now;
    if (!state.isRecording) {
      startRecording("vad");
    }
  }

  if (state.isRecording) {
    const elapsed = now - state.recordStart;
    if (elapsed > 250 && now - state.lastVoiceAt > silenceMs) {
      stopRecording().catch((err) => console.error(err));
    }
  }

  requestAnimationFrame(runVadLoop);
};

const setupMic = async () => {
  if (!state.head) return;
  let stream = state.micStream;
  if (!stream) {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.micStream = stream;
  }
  resetMicNodes();
  state.micSource = state.head.audioCtx.createMediaStreamSource(stream);
  state.micAnalyser = state.head.audioCtx.createAnalyser();
  state.micAnalyser.fftSize = 2048;
  state.micSource.connect(state.micAnalyser);

  state.micProcessor = state.head.audioCtx.createScriptProcessor(4096, 1, 1);
  state.silenceGain = state.head.audioCtx.createGain();
  state.silenceGain.gain.value = 0;
  state.micSource.connect(state.micProcessor);
  state.micProcessor.connect(state.silenceGain);
  state.silenceGain.connect(state.head.audioCtx.destination);

  state.micProcessor.onaudioprocess = (event) => {
    if (!state.isRecording) return;
    const input = event.inputBuffer.getChannelData(0);
    state.audioChunks.push(new Float32Array(input));
    state.totalSamples += input.length;
  };
};

const initHeadAudio = async () => {
  if (!state.head) return;
  if (state.headaudio) return;
  await state.head.audioCtx.audioWorklet.addModule(workletUrl);
  state.headaudio = new HeadAudio(state.head.audioCtx, {
    processorOptions: {
      visemeEventsEnabled: true
    }
  });
  await state.headaudio.loadModel(modelUrl);
  state.head.audioSpeechGainNode.connect(state.headaudio);
  state.headaudio.onvalue = (key, value) => {
    if (state.head?.mtAvatar?.[key]) {
      Object.assign(state.head.mtAvatar[key], { newvalue: value, needsUpdate: true });
    }
  };
  state.head.opt.update = state.headaudio.update.bind(state.headaudio);

  state.headaudio.onstarted = () => {
    state.head?.lookAtCamera(400);
    state.head?.speakWithHands();
  };
};

const loadAvatarList = async () => {
  const response = await fetch("/avatars/manifest.json");
  if (!response.ok) {
    throw new Error("Failed to load avatar manifest.");
  }
  const data = await response.json();
  const avatars = Array.isArray(data.avatars) ? data.avatars : [];
  els.avatarSelect.innerHTML = "";
  avatars.forEach((name: string) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name.replace(/\.glb$/i, "");
    els.avatarSelect.appendChild(option);
  });
  if (avatars.length) {
    els.avatarSelect.value = avatars[0];
  }
};

const loadAvatar = async (reload = false) => {
  if (!state.head || reload) {
    resetHead();
    await state.head.start();
    if (state.head.audioCtx.state !== "running") {
      try {
        await state.head.audioCtx.resume();
      } catch {
        // Audio context resume may require user gesture; keep avatar loading.
      }
    }
  }
  const name = els.avatarSelect.value;
  if (!name) return;
  updateStatus(`Loading avatar: ${name}`);
  await state.head.showAvatar({
    url: `/avatars/${name}`,
    body: "F",
    avatarMood: "neutral"
  });
  updateStatus("Avatar ready.");
  if (state.sessionActive) {
    await initHeadAudio();
    await setupMic();
  }
};

const startSession = async () => {
  if (!config.llmBaseUrl || !config.audioBaseUrl) {
    updateStatus("Missing MLX base URLs. Set VITE_MLX_LLM_BASE_URL + VITE_MLX_AUDIO_BASE_URL.");
    return;
  }
  if (!config.llmModel || !config.ttsModel || !config.sttModel) {
    updateStatus("Missing model IDs. Set VITE_MLX_DEFAULT_LLM_MODEL, TTS, and STT.");
    return;
  }

  setChip(els.llmChip, "LLM", config.llmModel);
  setChip(els.ttsChip, "TTS", config.ttsModel);
  setChip(els.sttChip, "STT", config.sttModel);

  if (!state.head) {
    state.head = createHead();
  }

  await state.head.start();
  if (state.head.audioCtx.state !== "running") {
    await state.head.audioCtx.resume();
  }
  await loadAvatar();
  await initHeadAudio();
  await setupMic();

  state.sessionActive = true;
  els.startBtn.disabled = true;
  els.stopBtn.disabled = false;
  updateModeUI();
  updateStatus("Session active. Ready for input.");

  if (state.mode === "vad") {
    requestAnimationFrame(runVadLoop);
  }
};

const stopSession = () => {
  state.sessionActive = false;
  state.isRecording = false;
  state.micStream?.getTracks().forEach((track) => track.stop());
  state.micStream = null;
  state.micSource?.disconnect();
  state.micAnalyser?.disconnect();
  state.micProcessor?.disconnect();
  state.silenceGain?.disconnect();
  state.headaudio = null;
  updateStatus("Session stopped.");
  els.startBtn.disabled = false;
  els.stopBtn.disabled = true;
  updateModeUI();
};

const init = async () => {
  setChip(els.llmChip, "LLM", config.llmModel);
  setChip(els.ttsChip, "TTS", config.ttsModel);
  setChip(els.sttChip, "STT", config.sttModel);
  els.voiceInput.value = config.ttsVoice;

  try {
    await loadAvatarList();
  } catch (error) {
    updateStatus("Failed to load avatars. Check /public/avatars.");
  }

  loadAvatar(true).catch(() => {
    updateStatus("Avatar preview requires a user gesture.");
  });

  updateModeUI();

  els.startBtn.addEventListener("click", () => {
    if (state.busy) return;
    state.busy = true;
    startSession()
      .catch((error) => {
        console.error(error);
        updateStatus(error.message || "Failed to start session.");
      })
      .finally(() => {
        state.busy = false;
      });
  });

  els.stopBtn.addEventListener("click", () => stopSession());

  els.avatarSelect.addEventListener("change", () => {
    loadAvatar(true).catch((error) => {
      updateStatus(error.message || "Failed to load avatar.");
    });
  });

  els.pushModeBtn.addEventListener("click", () => {
    state.mode = "push";
    updateModeUI();
    if (state.isRecording) {
      stopRecording().catch((err) => console.error(err));
    }
  });

  els.vadModeBtn.addEventListener("click", () => {
    state.mode = "vad";
    updateModeUI();
    if (state.isRecording) {
      stopRecording().catch((err) => console.error(err));
    }
    if (state.sessionActive) {
      requestAnimationFrame(runVadLoop);
    }
  });

  els.recordBtn.addEventListener("pointerdown", () => {
    if (!state.sessionActive || state.mode !== "push") return;
    startRecording("push");
  });

  const stopHandler = () => {
    if (!state.sessionActive || state.mode !== "push") return;
    stopRecording().catch((err) => console.error(err));
  };

  els.recordBtn.addEventListener("pointerup", stopHandler);
  els.recordBtn.addEventListener("pointerleave", stopHandler);
};

init().catch((error) => {
  console.error(error);
  updateStatus("Initialization failed.");
});
