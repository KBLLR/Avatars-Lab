import type { StageElements } from "./elements";
import type { StageState } from "./types";
import type { MlxConfig } from "../runtime/types";
import { lightPresets } from "./constants";
import { updateSliderReadouts } from "../scene/lighting";
import { getCameraSettingsFromInputs } from "../scene/camera";

export interface InitControlsDeps {
  els: StageElements;
  getState: () => StageState;
  updateState: (partial: Partial<StageState>) => void;
}

export const initControls = ({ els, getState, updateState }: InitControlsDeps): void => {
  const state = getState();
  const presetOptions = Object.entries(lightPresets).map(([id, preset]) => {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = preset.label;
    return option;
  });
  presetOptions.forEach((option) => els.lightPreset.appendChild(option));
  els.lightPreset.value = state.lightPreset;
  updateState({ lightPreset: state.lightPreset });

  els.cameraView.value = state.cameraSettings.view;
  els.cameraDistance.value = String(state.cameraSettings.distance);
  els.cameraX.value = String(state.cameraSettings.x);
  els.cameraY.value = String(state.cameraSettings.y);
  els.cameraRotateX.value = String(state.cameraSettings.rotateX);
  els.cameraRotateY.value = String(state.cameraSettings.rotateY);
  els.autoRotate.checked = state.cameraSettings.autoRotate;
  els.autoRotateSpeed.value = String(state.cameraSettings.autoRotateSpeed);
  updateSliderReadouts(els);
};

export interface BindControlsDeps {
  els: StageElements;
  getState: () => StageState;
  updateState: (partial: Partial<StageState>) => void;
  config: MlxConfig;
  setOverride: (key: string, value: string) => void;
  setChip: (el: HTMLElement, label: string, value?: string) => void;
  updateStatus: (message: string) => void;
  applyPlanApproved: (approved: boolean) => void;
  refreshRuntimePanel: () => Promise<void>;
  unloadRuntimeModel: () => Promise<void>;
  loadRuntimeModel: () => Promise<void>;
  setRuntimeStatusText: (text: string) => void;
}

export const bindControls = ({
  els,
  getState,
  updateState,
  config,
  setOverride,
  setChip,
  updateStatus,
  applyPlanApproved,
  refreshRuntimePanel,
  unloadRuntimeModel,
  loadRuntimeModel,
  setRuntimeStatusText
}: BindControlsDeps): void => {
  const applyCameraInputState = () => {
    updateSliderReadouts(els);
    updateState({ cameraSettings: getCameraSettingsFromInputs(els) });
  };

  const cameraInputs = [
    ["cameraView", els.cameraView],
    ["cameraDistance", els.cameraDistance],
    ["cameraX", els.cameraX],
    ["cameraY", els.cameraY],
    ["cameraRotateX", els.cameraRotateX],
    ["cameraRotateY", els.cameraRotateY],
    ["autoRotateSpeed", els.autoRotateSpeed]
  ] as const;

  cameraInputs.forEach(([, input]) => {
    input.addEventListener("input", () => {
      applyCameraInputState();
    });
  });

  els.autoRotate.addEventListener("change", () => {
    applyCameraInputState();
  });

  els.lightPreset.addEventListener("change", () => {
    updateState({ lightPreset: els.lightPreset.value });
  });

  const lightInputs = [
    els.ambientColor,
    els.directColor,
    els.spotColor,
    els.ambientIntensity,
    els.directIntensity,
    els.spotIntensity
  ];

  lightInputs.forEach((input) => {
    input.addEventListener("input", () => {
      const lightColors = {
        ambient: els.ambientColor.value,
        direct: els.directColor.value,
        spot: els.spotColor.value
      };
      const stageLightingBase = {
        ambient: Number(els.ambientIntensity.value),
        direct: Number(els.directIntensity.value),
        spot: Number(els.spotIntensity.value)
      };
      updateState({ lightColors, stageLightingBase });
      updateSliderReadouts(els);
    });
  });

  els.lightPulse.addEventListener("change", () => {
    updateState({ lightPulse: els.lightPulse.checked });
  });

  els.directorModelSelect.addEventListener("change", () => {
    const value = els.directorModelSelect.value;
    if (value) {
      config.directorModel = value;
      setOverride("directorModel", value);
      setChip(els.llmChip, "LLM", value);
    }
  });

  els.llmModelSelect.addEventListener("change", () => {
    const value = els.llmModelSelect.value;
    if (value) {
      config.llmModel = value;
      setOverride("llmModel", value);
      setChip(els.chatChip, "Chat", value);
    }
  });

  els.sttModelSelect.addEventListener("change", () => {
    const value = els.sttModelSelect.value;
    if (value) {
      config.sttModel = value;
      setOverride("sttModel", value);
      setChip(els.sttChip, "STT", value);
    }
  });

  els.ttsModelSelect.addEventListener("change", () => {
    const value = els.ttsModelSelect.value;
    if (value) {
      config.ttsModel = value;
      setOverride("ttsModel", value);
    }
  });

  els.llmRuntimeRefresh.addEventListener("click", () => {
    refreshRuntimePanel().catch(() => {
      setRuntimeStatusText("Failed to refresh LLM status.");
    });
  });

  els.llmRuntimeUnload.addEventListener("click", () => {
    unloadRuntimeModel().catch(() => {
      setRuntimeStatusText("Failed to unload model.");
    });
  });

  els.llmRuntimeLoad.addEventListener("click", () => {
    loadRuntimeModel().catch(() => {
      setRuntimeStatusText("Failed to load model.");
    });
  });

  els.approveBtn.addEventListener("click", () => {
    const state = getState();
    if (!state.plan) {
      updateStatus("Analyze a plan before approval.");
      return;
    }
    applyPlanApproved(true);
    updateStatus("Plan approved. Ready to perform.");
  });
};
