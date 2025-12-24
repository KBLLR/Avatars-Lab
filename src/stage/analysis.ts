import { createOrchestrator } from "../pipeline/orchestrator";
import type { DirectorOrchestrator, PipelineResult } from "../pipeline/orchestrator";
import type {
  DirectorStage,
  InputSection,
  PlanSection,
  WordTiming
} from "../directors/types";
import type { StageState } from "./types";
import type { StageElements } from "./elements";
import { buildSectionsFromTimings, encodeWords } from "../performance/index";
import {
  updateStatus,
  setAnalysisOverlay,
  resetAnalysisThoughts,
  updateProgressBar,
  updateStageBadges,
  resetStageBadges,
  appendAnalysisThought,
  updateHero
} from "../ui/index";

export interface AnalysisConfig {
  llmBaseUrl?: string;
  directorModel?: string;
  ttsModel?: string;
}

export interface AnalysisDeps {
  els: StageElements;
  config: AnalysisConfig;
  getState: () => StageState;
  updateState: (partial: Partial<StageState>) => void;
  decodeAudio: (file: File, audioCtx: AudioContext) => Promise<AudioBuffer>;
  applyPlanApproved: (approved: boolean) => void;
  renderPlan: (sections: PlanSection[]) => void;
  enqueueAnalysisVoice: (text: string) => void;
  buildWordTimings: (words: string[], durationMs: number) => WordTiming;
  directorModelFallback: string;
}

export interface AnalysisController {
  analyzePerformance: () => Promise<void>;
  cancelAnalysis: () => void;
}

const getStageDisplayName = (stage: DirectorStage): string => {
  const names: Record<DirectorStage, string> = {
    performance: "Performance Director",
    stage: "Stage Director",
    camera: "Camera Director",
    postfx: "PostFX Director"
  };
  return names[stage];
};

export const createAnalysisController = (deps: AnalysisDeps): AnalysisController => {
  const {
    els,
    config,
    getState,
    updateState,
    decodeAudio,
    applyPlanApproved,
    renderPlan,
    enqueueAnalysisVoice,
    buildWordTimings,
    directorModelFallback
  } = deps;

  const updateAnalyzeButton = (isAnalyzing: boolean) => {
    updateState({ isAnalyzing });
    els.analyzeBtn.textContent = isAnalyzing ? "Cancel" : "Analyze";
    els.analyzeBtn.classList.toggle("cancel-mode", isAnalyzing);
  };

  const getOrchestrator = (): DirectorOrchestrator => {
    const state = getState();
    const model = els.directorModelSelect.value || config.directorModel || directorModelFallback;
    const style = els.directorStyle.value || "cinematic";
    const seed = state.analysisSeed || new Date().toISOString();

    if (!state.orchestrator) {
      const isLargeModel = model.toLowerCase().includes("14b") || model.toLowerCase().includes("32b");
      const safeMaxTokens = isLargeModel ? 2000 : 3000;

      const orchestrator = createOrchestrator({
        baseUrl: config.llmBaseUrl,
        model,
        style,
        seed,
        timeoutMs: isLargeModel ? 120000 : 90000,
        maxTokens: safeMaxTokens,
        retries: 2,
        streaming: true,
        enableChunking: true,
        parallelStageCamera: false
      });
      // Store current config in state to detect changes
      updateState({ 
        orchestrator,
        lastDirectorModel: model,
        lastDirectorStyle: style
      });
      return orchestrator;
    }

    // If model/style changed, recreate orchestrator
    if (state.lastDirectorModel !== model || state.lastDirectorStyle !== style) {
      const isLargeModel = model.toLowerCase().includes("14b") || model.toLowerCase().includes("32b");
      const safeMaxTokens = isLargeModel ? 2000 : 3000;
      
      const orchestrator = createOrchestrator({
        baseUrl: config.llmBaseUrl,
        model,
        style,
        seed,
        timeoutMs: isLargeModel ? 120000 : 90000,
        maxTokens: safeMaxTokens,
        retries: 2,
        streaming: true,
        enableChunking: true,
        parallelStageCamera: false
      });
      updateState({ 
        orchestrator,
        lastDirectorModel: model,
        lastDirectorStyle: style
      });
      return orchestrator;
    }

    state.orchestrator.updateSeed(seed);
    return state.orchestrator;
  };

  const cancelAnalysis = () => {
    const state = getState();
    if (state.orchestrator && state.isAnalyzing) {
      state.orchestrator.cancel();
      updateAnalyzeButton(false);
      setAnalysisOverlay(els, false);
      updateStatus(els, "Analysis cancelled.");
    }
  };

  const analyzePerformance = async () => {
    const state = getState();

    if (state.isAnalyzing) {
      cancelAnalysis();
      return;
    }

    if (!state.audioBuffer) {
      if (state.audioFile && state.head) {
        updateStatus(els, "Decoding audio for analysis...");
        try {
          const audioBuffer = await decodeAudio(state.audioFile, state.head.audioCtx);
          updateState({ audioBuffer });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to decode audio.";
          updateStatus(els, message);
          return;
        }
      } else {
        updateStatus(els, "Load audio before analyzing performance.");
        return;
      }
    }
    if (!getState().audioBuffer) {
      updateStatus(els, "Load audio before analyzing performance.");
      return;
    }
    if (!state.transcriptText) {
      updateStatus(els, "Transcript required. Run transcribe first.");
      return;
    }
    if (!config.llmBaseUrl) {
      updateStatus(els, "Missing VITE_MLX_LLM_BASE_URL.");
      return;
    }

    const model = els.directorModelSelect.value || config.directorModel || directorModelFallback;
    if (!model) {
      updateStatus(els, "Missing VITE_MLX_DEFAULT_LLM_MODEL.");
      return;
    }

    applyPlanApproved(false);
    const analysisSeed = new Date().toISOString();
    const directorNotes = "Performance Director: thinking...";
    updateState({
      analysisSeed,
      directorNotes,
      analysisVoiceQueue: Promise.resolve()
    });
    els.directorNotes.textContent = directorNotes;
    updateAnalyzeButton(true);
    setAnalysisOverlay(els, true, "Performance Director");
    els.analysisHint.textContent = config.ttsModel
      ? "Voiceover will play when available."
      : "Voiceover disabled (missing TTS model).";
    updateState({
      analysisSegments: resetAnalysisThoughts(
        els,
        `Creative seed: ${analysisSeed}\nPerformance Director: listening to the lyrics...`
      )
    });
    renderPlan([]);

    updateProgressBar(els.analysisProgressBar, 0);
    resetStageBadges(els);

    try {
      const stateNow = getState();
      const durationMs = stateNow.audioBuffer!.duration * 1000;
      const timings =
        stateNow.wordTimings || buildWordTimings(encodeWords(stateNow.transcriptText), durationMs);
      const sections: InputSection[] = buildSectionsFromTimings(timings);

      const orchestrator = getOrchestrator();

      updateStatus(els, "Director pipeline: analyzing performance...");

      const result: PipelineResult = await orchestrator.run(
        {
          sections,
          durationMs,
          defaultLightPreset: stateNow.lightPreset,
          defaultCameraView: stateNow.cameraSettings.view,
          enabledDirectors: stateNow.enabledDirectors
        },
        {
          onProgress: (event) => {
            const stageName = getStageDisplayName(event.stage);
            setAnalysisOverlay(els, true, stageName);

            if (event.status === "running") {
              updateStageBadges(els, event.stage, "active");

              const stageProgress: Record<DirectorStage, number> = {
                performance: 10,
                stage: 35,
                camera: 60,
                postfx: 85
              };
              updateProgressBar(els.analysisProgressBar, stageProgress[event.stage]);

              const chunkInfo = event.chunk && event.totalChunks
                ? ` (${event.chunk}/${event.totalChunks})`
                : "";
              updateStatus(els, `${stageName}${chunkInfo}: ${event.message || "analyzing..."}`);

              if (event.thoughtsPreview) {
                const notesState = getState();
                els.directorNotes.textContent = `${notesState.directorNotes}\n\n${stageName}: ${event.thoughtsPreview}`;
              }
            } else if (event.status === "complete") {
              updateStageBadges(els, event.stage, "complete");

              const completedProgress: Record<DirectorStage, number> = {
                performance: 25,
                stage: 50,
                camera: 75,
                postfx: 100
              };
              updateProgressBar(els.analysisProgressBar, completedProgress[event.stage]);

              updateState({
                analysisSegments: appendAnalysisThought(
                  els,
                  getState().analysisSegments,
                  `${stageName}: Complete`
                )
              });
            } else if (event.status === "failed") {
              updateStageBadges(els, event.stage, "failed");
              updateState({
                analysisSegments: appendAnalysisThought(
                  els,
                  getState().analysisSegments,
                  `${stageName}: ${event.message || "Failed"}`
                )
              });
            }
          },
          onChunk: () => {
            // Progress is handled via onProgress.
          },
          onThoughts: (stage, thoughts) => {
            const stageName = getStageDisplayName(stage);
            const displayText = `${stageName}: ${thoughts}`;
            updateState({
              analysisSegments: appendAnalysisThought(els, getState().analysisSegments, displayText)
            });
            enqueueAnalysisVoice(`${stageName}. ${thoughts}`);

            const nextNotes = [getState().directorNotes, displayText]
              .filter(Boolean)
              .join("\n\n");
            updateState({ directorNotes: nextNotes });
            els.directorNotes.textContent = nextNotes;
          },
          onFallback: (reason) => {
            updateState({
              analysisSegments: appendAnalysisThought(
                els,
                getState().analysisSegments,
                `Using fallback plan: ${reason}`
              )
            });
            updateStatus(els, `Fallback: ${reason}`);
          }
        }
      );

      const plan = result.plan;

      if (result.usedFallback) {
        const fallbackNotes = "Fallback plan used because director output was invalid.";
        updateState({ plan, planSource: "heuristic", directorNotes: fallbackNotes });
        els.directorNotes.textContent = fallbackNotes;
        updateStatus(els, "Using fallback staging plan.");
      } else {
        const allNotes = [
          result.plan.performanceNotes,
          result.plan.stageNotes,
          result.plan.cameraNotes,
          result.plan.postFxNotes
        ].filter(Boolean).join("\n\n");

        const nextNotes = allNotes || "Director pipeline completed.";
        updateState({ plan, planSource: "llm", directorNotes: nextNotes });
        els.directorNotes.textContent = nextNotes;
        updateStatus(els, `Performance plan ready (${(result.totalDurationMs / 1000).toFixed(1)}s). Hit Perform.`);
      }

      renderPlan(plan.sections);
      updateHero(
        els,
        undefined,
        getState().audioFile ? getState().audioFile!.name : undefined,
        plan.title || "Performance Plan"
      );
      els.analysisHint.textContent = "Analysis complete.";
      setAnalysisOverlay(els, false);
      applyPlanApproved(false);
    } catch (error) {
      console.error("Analysis error:", error);
      const message = error instanceof Error ? error.message : String(error);

      if (message.includes("cancelled")) {
        updateStatus(els, "Analysis cancelled by user.");
      } else {
        updateStatus(els, `Analysis failed: ${message}`);
      }

      setAnalysisOverlay(els, false);
    } finally {
      updateAnalyzeButton(false);
    }
  };

  return { analyzePerformance, cancelAnalysis };
};
