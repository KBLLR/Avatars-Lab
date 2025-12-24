import type { StageElements } from "../stage/elements";
import type { StageState } from "../stage/types";
import type { MlxConfig } from "../runtime/types";
import type { PlanSection } from "../directors/types";
import type { PerformanceRecord } from "./types";
import {
  createPerformanceStore,
  decodeBase64ToFile,
  encodeFileToBase64
} from "./store";
import { resetAnalysisThoughts } from "../ui/index";

export interface PerformanceLibraryDeps {
  els: StageElements;
  config: MlxConfig;
  getState: () => StageState;
  updateState: (partial: Partial<StageState>) => void;
  decodeAudioFile: (file: File, audioCtx: AudioContext) => Promise<AudioBuffer>;
  applyPlanApproved: (approved: boolean) => void;
  renderPlan: (sections: PlanSection[]) => void;
  setAnalysisOverlay: (active: boolean, step?: string) => void;
  setChip: (chip: HTMLElement, label: string, value: string) => void;
  updateHero: (avatarName?: string, songName?: string, status?: string) => void;
  updateStatus: (message: string) => void;
  setOverride: (key: string, value: string | undefined) => void;
}

interface PerformanceLibrary {
  refresh: () => Promise<void>;
}

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 64);

const createId = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `perf_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
};

const normalizeRecord = (raw: PerformanceRecord): PerformanceRecord => ({
  ...raw,
  wordTimings: typeof raw.wordTimings === "string" ? JSON.parse(raw.wordTimings) : raw.wordTimings,
  plan: typeof raw.plan === "string" ? JSON.parse(raw.plan) : raw.plan,
  models: typeof raw.models === "string" ? JSON.parse(raw.models) : raw.models,
  audio: typeof raw.audio === "string" ? JSON.parse(raw.audio) : raw.audio
});

const applyModelValue = (
  select: HTMLSelectElement,
  value: string | undefined,
  onApply: (next: string) => void
) => {
  if (!value) return;
  const existing = Array.from(select.options).some((option) => option.value === value);
  if (!existing) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  }
  select.value = value;
  onApply(value);
};

export const initPerformanceLibrary = (deps: PerformanceLibraryDeps): PerformanceLibrary => {
  const store = createPerformanceStore({ baseUrl: deps.config.dataLakeUrl });

  const setLibraryStatus = (text: string) => {
    deps.els.dataPoolStatus.textContent = text;
  };

  const refresh = async () => {
    try {
      setLibraryStatus("Refreshing library...");
      const items = await store.list();
      deps.els.dataPoolSelect.innerHTML = "";
      if (!items.length) {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = "No saved performances";
        deps.els.dataPoolSelect.appendChild(option);
        setLibraryStatus("No saved performances yet.");
        return;
      }
      items.forEach((item) => {
        const option = document.createElement("option");
        option.value = item.path;
        option.textContent = item.path.split("/").slice(-2).join("/");
        deps.els.dataPoolSelect.appendChild(option);
      });
      setLibraryStatus(`${items.length} performance(s) available.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to refresh library.";
      setLibraryStatus(message);
    }
  };

  const save = async () => {
    const state = deps.getState();
    if (!state.transcriptText) {
      setLibraryStatus("Transcript required before saving.");
      return;
    }
    const title =
      deps.els.dataPoolTitle.value.trim() ||
      state.audioFile?.name.replace(/\.[^/.]+$/, "") ||
      `Performance ${new Date().toLocaleString()}`;
    const recordId = createId();

    let audio: PerformanceRecord["audio"] = null;
    if (state.audioFile) {
      audio = {
        name: state.audioFile.name,
        type: state.audioFile.type || "audio/mpeg",
        size: state.audioFile.size
      };
      if (deps.els.dataPoolIncludeAudio.checked) {
        if (state.audioFile.size > MAX_AUDIO_BYTES) {
          setLibraryStatus("Audio too large to embed. Save without audio.");
        } else {
          audio.dataBase64 = await encodeFileToBase64(state.audioFile);
        }
      }
    }

    const record: PerformanceRecord = {
      id: recordId,
      title,
      createdAt: new Date().toISOString(),
      transcriptText: state.transcriptText,
      wordTimings: state.wordTimings,
      plan: state.plan,
      planSource: state.planSource,
      directorNotes: state.directorNotes,
      analysisSeed: state.analysisSeed,
      directorStyle: deps.els.directorStyle.value,
      models: {
        llmModel: deps.config.llmModel,
        directorModel: deps.config.directorModel,
        sttModel: deps.config.sttModel,
        ttsModel: deps.config.ttsModel,
        ttsVoice: deps.config.ttsVoice
      },
      audio
    };

    const fileName = `${slugify(title) || "performance"}-${recordId.slice(0, 8)}.json`;

    try {
      setLibraryStatus("Saving performance...");
      await store.save(record, { fileName });
      setLibraryStatus("Performance saved.");
      deps.updateStatus("Performance saved to data pool.");
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save performance.";
      setLibraryStatus(message);
    }
  };

  const load = async () => {
    const selected = deps.els.dataPoolSelect.value;
    if (!selected) {
      setLibraryStatus("Select a saved performance first.");
      return;
    }
    try {
      setLibraryStatus("Loading performance...");
      const rawRecord = await store.load(selected);
      const record = normalizeRecord(rawRecord);

      deps.updateState({
        transcriptText: record.transcriptText || "",
        wordTimings: record.wordTimings || null,
        plan: record.plan || null,
        planSource: record.planSource || "none",
        directorNotes: record.directorNotes || "",
        analysisSeed: record.analysisSeed || null,
        analysisVoiceQueue: Promise.resolve(),
        planApproved: false,
        analysisSegments: resetAnalysisThoughts(
          deps.els,
          "Performance loaded. Review and approve to perform."
        )
      });
      deps.els.transcript.value = record.transcriptText || "";
      deps.els.dataPoolTitle.value = record.title || "";
      deps.setAnalysisOverlay(false);
      deps.renderPlan(record.plan?.sections || []);
      deps.applyPlanApproved(false);

      if (record.directorStyle) {
        deps.els.directorStyle.value = record.directorStyle;
      }

      applyModelValue(deps.els.llmModelSelect, record.models?.llmModel, (next) => {
        deps.config.llmModel = next;
        deps.setOverride("llmModel", next);
        deps.setChip(deps.els.chatChip, "Chat", next);
      });
      applyModelValue(deps.els.directorModelSelect, record.models?.directorModel, (next) => {
        deps.config.directorModel = next;
        deps.setOverride("directorModel", next);
        deps.setChip(deps.els.llmChip, "LLM", next);
      });
      applyModelValue(deps.els.sttModelSelect, record.models?.sttModel, (next) => {
        deps.config.sttModel = next;
        deps.setOverride("sttModel", next);
        deps.setChip(deps.els.sttChip, "STT", next);
      });
      applyModelValue(deps.els.ttsModelSelect, record.models?.ttsModel, (next) => {
        deps.config.ttsModel = next;
        deps.setOverride("ttsModel", next);
      });

      if (record.models?.ttsVoice) {
        const hasVoice = Array.from(deps.els.voiceSelect.options).some(
          (option) => option.value === record.models.ttsVoice
        );
        if (!hasVoice) {
          const option = document.createElement("option");
          option.value = record.models.ttsVoice;
          option.textContent = record.models.ttsVoice;
          deps.els.voiceSelect.appendChild(option);
        }
        deps.els.voiceSelect.value = record.models.ttsVoice;
        deps.config.ttsVoice = record.models.ttsVoice;
      }

      if (record.audio?.dataBase64 && record.audio.name) {
        const file = decodeBase64ToFile(
          record.audio.dataBase64,
          record.audio.name,
          record.audio.type || "audio/mpeg"
        );
        deps.updateState({ audioFile: file });
        deps.setChip(deps.els.audioChip, "Audio", file.name);
        deps.updateHero(undefined, file.name, "Loaded Performance");
        const state = deps.getState();
        if (state.head) {
          const audioBuffer = await deps.decodeAudioFile(file, state.head.audioCtx);
          deps.updateState({ audioBuffer });
        } else {
          deps.updateState({ audioBuffer: null });
        }
        deps.els.heroLyrics.textContent = "Performance loaded. Approve to perform.";
      } else {
        deps.updateState({ audioFile: null, audioBuffer: null });
        deps.setChip(deps.els.audioChip, "Audio", record.audio?.name || "-");
        deps.updateHero(undefined, undefined, "Loaded Performance");
        deps.els.heroLyrics.textContent = "Performance loaded. Load audio to perform.";
      }

      deps.updateStatus("Performance loaded from data pool.");
      setLibraryStatus("Performance loaded.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load performance.";
      setLibraryStatus(message);
    }
  };

  deps.els.dataPoolSave.addEventListener("click", () => {
    save().catch(() => null);
  });
  deps.els.dataPoolRefresh.addEventListener("click", () => {
    refresh().catch(() => null);
  });
  deps.els.dataPoolLoad.addEventListener("click", () => {
    load().catch(() => null);
  });

  refresh().catch(() => null);

  return { refresh };
};
