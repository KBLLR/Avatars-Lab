const byId = (id: string) => document.getElementById(id) as HTMLElement;

const env = {
  llmBase: import.meta.env.VITE_MLX_LLM_BASE_URL || "(missing)",
  audioBase: import.meta.env.VITE_MLX_AUDIO_BASE_URL || "(missing)",
  llmModel: import.meta.env.VITE_MLX_DEFAULT_LLM_MODEL || "(missing)",
  ttsModel: import.meta.env.VITE_MLX_DEFAULT_TTS_MODEL || "(missing)",
  sttModel: import.meta.env.VITE_MLX_DEFAULT_STT_MODEL || "(missing)"
};

byId("llmBase").textContent = `LLM Base: ${env.llmBase}`;
byId("audioBase").textContent = `Audio Base: ${env.audioBase}`;
byId("llmModel").textContent = `LLM Model: ${env.llmModel}`;
byId("ttsModel").textContent = `TTS Model: ${env.ttsModel}`;
byId("sttModel").textContent = `STT Model: ${env.sttModel}`;

const headttsOptions = [
  {
    option: "endpoints",
    description: "List of WebSocket/RESTful servers or backends webgpu/wasm, in order of priority.",
    value: '["webgpu", "wasm"]'
  },
  {
    option: "audioCtx",
    description: "Audio context for creating audio buffers.",
    value: "null"
  },
  {
    option: "workerModule",
    description: "URL of HeadTTS Web Worker module.",
    value: "null"
  },
  {
    option: "transformersModule",
    description: "transformers.js module URL.",
    value: "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2/dist/transformers.min.js"
  },
  {
    option: "model",
    description: "Kokoro ONNX model used for in-browser inference.",
    value: "onnx-community/Kokoro-82M-v1.0-ONNX-timestamped"
  },
  {
    option: "dtypeWebgpu",
    description: "Precision for WebGPU inference.",
    value: "fp32"
  },
  {
    option: "dtypeWasm",
    description: "Precision for WASM inference.",
    value: "q4"
  },
  {
    option: "styleDim",
    description: "Style embedding dimension.",
    value: "256"
  },
  {
    option: "audioSampleRate",
    description: "Audio sample rate in Hz.",
    value: "24000"
  },
  {
    option: "frameRate",
    description: "Frame rate in FPS.",
    value: "40"
  },
  {
    option: "languages",
    description: "Language modules to preload.",
    value: "[\"en-us\"]"
  },
  {
    option: "dictionaryURL",
    description: "URL to language dictionaries.",
    value: "../dictionaries"
  },
  {
    option: "voiceURL",
    description: "URL for loading voices.",
    value: "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/voices"
  },
  {
    option: "voices",
    description: "Voices to preload.",
    value: "[]"
  },
  {
    option: "splitSentences",
    description: "Split text into sentences.",
    value: "true"
  },
  {
    option: "splitLength",
    description: "Maximum length per text chunk.",
    value: "500"
  },
  {
    option: "deltaStart",
    description: "Adjustment (ms) to viseme start times.",
    value: "-10"
  },
  {
    option: "deltaEnd",
    description: "Adjustment (ms) to viseme end times.",
    value: "10"
  },
  {
    option: "defaultVoice",
    description: "Default voice.",
    value: "af_bella"
  },
  {
    option: "defaultLanguage",
    description: "Default language.",
    value: "en-us"
  },
  {
    option: "defaultSpeed",
    description: "Speaking speed (0.25-4).",
    value: "1"
  },
  {
    option: "defaultAudioEncoding",
    description: "Default audio format.",
    value: "wav"
  },
  {
    option: "trace",
    description: "Debug bitmask (0=none, 255=all).",
    value: "0"
  }
];

const headttsTbody = byId("headttsOptions");
headttsOptions.forEach((row) => {
  const tr = document.createElement("tr");
  tr.innerHTML = `<td><code>${row.option}</code></td><td>${row.description}</td><td><code>${row.value}</code></td>`;
  headttsTbody.appendChild(tr);
});

const renderModels = async () => {
  try {
    const response = await fetch("/models/registry.json");
    if (!response.ok) throw new Error("Missing registry snapshot");
    const data = await response.json();
    const models = Array.isArray(data.models) ? data.models : [];
    const voices = Array.isArray(data.voices) ? data.voices : [];

    const list = document.createElement("table");
    list.innerHTML = `
      <thead>
        <tr>
          <th>Model ID</th>
          <th>Type</th>
          <th>Capabilities</th>
        </tr>
      </thead>
      <tbody>
        ${models
          .map(
            (model: any) => `
              <tr>
                <td><code>${model.id}</code></td>
                <td>${model.type || "-"}</td>
                <td>${(model.capabilities || []).join(", ") || "-"}</td>
              </tr>`
          )
          .join("")}
      </tbody>`;
    const modelsEl = byId("models");
    modelsEl.innerHTML = "";
    modelsEl.appendChild(list);

    const voicesEl = byId("voices");
    voicesEl.textContent = voices.length ? voices.join(", ") : "No voices found.";
  } catch (error) {
    byId("models").textContent = "Model registry snapshot not found. Run npm run dev to generate it.";
    byId("voices").textContent = "No voices found.";
  }
};

renderModels();
