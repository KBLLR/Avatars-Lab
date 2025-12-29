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
  if (els.lightPreset) {
    presetOptions.forEach((option) => els.lightPreset.appendChild(option));
    els.lightPreset.value = state.lightPreset;
  }
  updateState({ lightPreset: state.lightPreset });

  if (els.cameraView) els.cameraView.value = state.cameraSettings.view;
  if (els.cameraDistance) els.cameraDistance.value = String(state.cameraSettings.distance);
  if (els.cameraX) els.cameraX.value = String(state.cameraSettings.x);
  if (els.cameraY) els.cameraY.value = String(state.cameraSettings.y);
  if (els.cameraRotateX) els.cameraRotateX.value = String(state.cameraSettings.rotateX);
  if (els.cameraRotateY) els.cameraRotateY.value = String(state.cameraSettings.rotateY);
  if (els.autoRotate) els.autoRotate.checked = state.cameraSettings.autoRotate;
  if (els.autoRotateSpeed) els.autoRotateSpeed.value = String(state.cameraSettings.autoRotateSpeed);
  updateSliderReadouts(els);
  
  if (els.directorEnablePerformance) els.directorEnablePerformance.checked = true; // Always true
  if (els.directorEnableStage) els.directorEnableStage.checked = state.enabledDirectors.includes("stage");
  if (els.directorEnableCamera) els.directorEnableCamera.checked = state.enabledDirectors.includes("camera");
  if (els.directorEnablePostFx) els.directorEnablePostFx.checked = state.enabledDirectors.includes("postfx");
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
  // Duo Mode callbacks
  onDuoMutualGaze?: () => void;
  onDuoFaceCamera?: () => void;
  onDuoTestA?: () => void;
  onDuoTestB?: () => void;
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
  setRuntimeStatusText,
  onDuoMutualGaze,
  onDuoFaceCamera,
  onDuoTestA,
  onDuoTestB
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
    if (input) {
      input.addEventListener("input", () => {
        applyCameraInputState();
      });
    }
  });

  if (els.autoRotate) {
    els.autoRotate.addEventListener("change", () => {
      applyCameraInputState();
    });
  }

  if (els.lightPreset) {
    els.lightPreset.addEventListener("change", () => {
      updateState({ lightPreset: els.lightPreset.value });
    });
  }

  const lightInputs = [
    els.ambientColor,
    els.directColor,
    els.spotColor,
    els.ambientIntensity,
    els.directIntensity,
    els.spotIntensity
  ];

  lightInputs.forEach((input) => {
    if (input) {
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
    }
  });

  if (els.lightPulse) {
    els.lightPulse.addEventListener("change", () => {
      updateState({ lightPulse: els.lightPulse.checked });
    });
  }

  if (els.directorModelSelect) {
    els.directorModelSelect.addEventListener("change", () => {
      const value = els.directorModelSelect.value;
      if (value) {
        config.directorModel = value;
        setOverride("directorModel", value);
        setChip(els.llmChip, "LLM", value);
      }
    });
  }

  if (els.llmModelSelect) {
    els.llmModelSelect.addEventListener("change", () => {
      const value = els.llmModelSelect.value;
      if (value) {
        config.llmModel = value;
        setOverride("llmModel", value);
        setChip(els.chatChip, "Chat", value);
      }
    });
  }

  if (els.vlmModelSelect) {
    els.vlmModelSelect.addEventListener("change", () => {
      const value = els.vlmModelSelect.value;
      if (value) {
        config.vlmModel = value;
        setOverride("vlmModel", value);
        setChip(els.vlmChip, "VLM", value);
      }
    });
  }

  if (els.sttModelSelect) {
    els.sttModelSelect.addEventListener("change", () => {
      const value = els.sttModelSelect.value;
      if (value) {
        config.sttModel = value;
        setOverride("sttModel", value);
        setChip(els.sttChip, "STT", value);
      }
    });
  }

  if (els.embedModelSelect) {
    els.embedModelSelect.addEventListener("change", () => {
      const value = els.embedModelSelect.value;
      if (value) {
        config.embedModel = value;
        setOverride("embedModel", value);
        setChip(els.embedChip, "Embed", value);
      }
    });
  }

  if (els.llmRuntimeRefresh) {
    els.llmRuntimeRefresh.addEventListener("click", () => {
      refreshRuntimePanel().catch(() => {
        setRuntimeStatusText("Failed to refresh LLM status.");
      });
    });
  }

  if (els.llmRuntimeUnload) {
    els.llmRuntimeUnload.addEventListener("click", () => {
      unloadRuntimeModel().catch(() => {
        setRuntimeStatusText("Failed to unload model.");
      });
    });
  }

  if (els.llmRuntimeLoad) {
    els.llmRuntimeLoad.addEventListener("click", () => {
      loadRuntimeModel().catch(() => {
        setRuntimeStatusText("Failed to load model.");
      });
    });
  }

  if (els.approveBtn) {
    els.approveBtn.addEventListener("click", () => {
      const state = getState();
      if (!state.plan) {
        updateStatus("Analyze a plan before approval.");
        return;
      }
      applyPlanApproved(true);
      updateStatus("Plan approved. Ready to perform.");
    });
  }

  // Director Toggles
  const updateDirectorState = (stage: "stage" | "camera" | "postfx", enabled: boolean) => {
    const current = getState().enabledDirectors.filter(d => d !== stage);
    if (enabled) current.push(stage);
    updateState({ enabledDirectors: current });
  };

  if (els.directorEnableStage) {
    els.directorEnableStage.addEventListener("change", () => {
      updateDirectorState("stage", els.directorEnableStage.checked);
    });
  }

  if (els.directorEnableCamera) {
    els.directorEnableCamera.addEventListener("change", () => {
      updateDirectorState("camera", els.directorEnableCamera.checked);
    });
  }

  if (els.directorEnablePostFx) {
    els.directorEnablePostFx.addEventListener("change", () => {
      updateDirectorState("postfx", els.directorEnablePostFx.checked);
    });
  }

  // Duo Mode toggle
  if (els.duoModeToggle) {
    els.duoModeToggle.addEventListener("change", () => {
      const enabled = els.duoModeToggle.checked;
      if (els.duoModeOptions) els.duoModeOptions.style.display = enabled ? "block" : "none";
      updateState({ duoMode: enabled });
      updateStatus(enabled ? "Duo Mode enabled. Select avatars A & B." : "Solo mode.");
    });
  }

  // Avatar A/B selection
  if (els.avatarASelect) {
    els.avatarASelect.addEventListener("change", () => {
      const url = els.avatarASelect.value;
      if (url) updateState({ avatarAUrl: url });
    });
  }

  if (els.avatarBSelect) {
    els.avatarBSelect.addEventListener("change", () => {
      const url = els.avatarBSelect.value;
      if (url) updateState({ avatarBUrl: url });
    });
  }

  // Duo Mode gaze controls
  if (els.duoMutualGazeBtn) {
    els.duoMutualGazeBtn.addEventListener("click", () => {
      if (onDuoMutualGaze) onDuoMutualGaze();
    });
  }

  if (els.duoFaceCameraBtn) {
    els.duoFaceCameraBtn.addEventListener("click", () => {
      if (onDuoFaceCamera) onDuoFaceCamera();
    });
  }

  if (els.duoTestABtn) {
    els.duoTestABtn.addEventListener("click", () => {
      if (onDuoTestA) onDuoTestA();
    });
  }

  if (els.duoTestBBtn) {
    els.duoTestBBtn.addEventListener("click", () => {
      if (onDuoTestB) onDuoTestB();
    });
  }
};
