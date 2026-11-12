const byId = (id: string) => document.getElementById(id) as HTMLElement | null;
const setText = (id: string, value: string) => {
  const el = byId(id);
  if (el) el.textContent = value;
};
const setStatus = (id: string, online: boolean) => {
  const el = byId(id);
  if (!el) return;
  el.classList.remove("online", "offline");
  el.classList.add(online ? "online" : "offline");
  el.title = online ? "Online" : "Offline";
};

const gatewayBase = (
  import.meta.env.VITE_COREX_GATEWAY_URL || "http://127.0.0.1:8090"
).replace(/\/$/, "");
const motionBase = (
  import.meta.env.VITE_AVATAR_LABS_MOTION_API_URL || "/api/motion"
).replace(/\/$/, "");

setText("llmBase", `${gatewayBase}/v1/responses`);
setText("audioBase", `${gatewayBase}/v1/audio/speech`);
setText("motionBase", `${motionBase}/health`);
setText("llmModel", import.meta.env.VITE_MLX_DEFAULT_LLM_MODEL || "openai/gpt-oss-20b (via Gateway)");
setText("ttsModel", import.meta.env.VITE_MLX_DEFAULT_TTS_MODEL || "kokoro-82m");
setText("sttModel", import.meta.env.VITE_MLX_DEFAULT_STT_MODEL || "whisper-large-v3-turbo");

const headttsOptions = [
  {
    option: "endpoints",
    description: "Priority order of WebSocket/RESTful servers or local WebGPU/WASM backends.",
    value: '["http://127.0.0.1:8090/v1/audio/speech", "webgpu", "wasm"]',
  },
  {
    option: "model",
    description: "Kokoro model used for speech and timestamped viseme synthesis.",
    value: "onnx-community/Kokoro-82M-v1.0-ONNX-timestamped",
  },
  {
    option: "audioSampleRate",
    description: "PCM/WAV audio sample rate in Hz.",
    value: "24000",
  },
  {
    option: "frameRate",
    description: "Viseme & blendshape evaluation rate in FPS.",
    value: "40",
  },
  {
    option: "defaultVoice",
    description: "Default Kokoro voice profile.",
    value: "af_heart",
  },
  {
    option: "defaultLanguage",
    description: "Default phoneme dictionary language.",
    value: "en-us",
  },
];

const headttsTbody = byId("headttsOptions");
if (headttsTbody) {
  headttsTbody.innerHTML = "";
  headttsOptions.forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td><code>${row.option}</code></td><td>${row.description}</td><td><code>${row.value}</code></td>`;
    headttsTbody.appendChild(tr);
  });
}

const probeServicesAndAssets = async () => {
  // 1. Probe Avatar Labs /health, runtime avatars, and FBX animation catalog
  try {
    const [healthRes, avatarsRes, catalogRes] = await Promise.all([
      fetch("/health", { cache: "no-store" }),
      fetch("/avatars/runtime-manifest.json", { cache: "no-store" }),
      fetch("/performance-assets/catalog.json", { cache: "no-store" }),
    ]);
    const healthOk = healthRes.ok;
    setStatus("stt-status", healthOk);

    const avatarData = avatarsRes.ok ? await avatarsRes.json() : { avatars: [] };
    const catalogData = catalogRes.ok ? await catalogRes.json() : { animations: [], summary: {} };
    const avatars = Array.isArray(avatarData.avatars) ? avatarData.avatars : [];
    const animations = Array.isArray(catalogData.animations) ? catalogData.animations : [];

    setText(
      "houseAssetsSummary",
      `${avatars.length} hydrated GLB avatars · ${animations.length} FBX clips (${catalogData.summary?.curated || 0} Rigging Palace + ${catalogData.summary?.rpm || 0} RPM)`,
    );

    const modelsEl = byId("models");
    if (modelsEl) {
      const table = document.createElement("table");
      table.innerHTML = `
        <thead>
          <tr>
            <th>Asset / Avatar ID</th>
            <th>File</th>
            <th>Rig Profile</th>
            <th>TalkingHead</th>
            <th>Project / Source</th>
          </tr>
        </thead>
        <tbody>
          ${avatars
            .map(
              (a: any) => `
                <tr>
                  <td><code>${a.id}</code> (${a.display_name || a.id})</td>
                  <td><code>${a.file}</code>${a.m2mr_fbx ? ` + <code>${a.m2mr_fbx}</code>` : ""}</td>
                  <td><code>${a.rig_profile || "mixamo-rpm-full"}</code></td>
                  <td>${a.talkinghead_compatible === false ? "Body-only (MIA 52)" : "Yes (ARKit/Viseme)"}</td>
                  <td>${a.project || "Avatar Labs"}</td>
                </tr>`,
            )
            .join("")}
        </tbody>`;
      modelsEl.innerHTML = "";
      modelsEl.appendChild(table);
    }
  } catch {
    setStatus("stt-status", false);
  }

  // 2. Probe Motion2MixamoRig service (:8104)
  try {
    const motionRes = await fetch(`${motionBase}/health`, { cache: "no-store" });
    if (motionRes.ok) {
      const motionData = await motionRes.json();
      setStatus("motion-status", motionData?.status === "healthy" || motionData?.ok === true);
    } else {
      setStatus("motion-status", false);
    }
  } catch {
    setStatus("motion-status", false);
  }

  // 3. Probe Core-X Gateway (:8090)
  try {
    const gwRes = await fetch("/api/llm/health", { cache: "no-store" });
    setStatus("llm-status", gwRes.ok);
    setStatus("tts-status", gwRes.ok);
  } catch {
    setStatus("llm-status", false);
    setStatus("tts-status", false);
  }

  // 4. Probe SAiD (:8096 via proxy or direct)
  try {
    const saidRes = await fetch("/api/said/health", { cache: "no-store" });
    setStatus("said-status", saidRes.ok);
  } catch {
    setStatus("said-status", false);
  }
};

void probeServicesAndAssets();
