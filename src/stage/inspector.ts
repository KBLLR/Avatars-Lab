import type { StageElements } from "./elements";
import type { StageState } from "./types";

export interface StageInspector {
  openCard: (cardId: string) => void;
  sync: (state: StageState, changed?: Partial<StageState>) => void;
}

const workflowSteps = ["audio", "transcript", "plan", "perform"] as const;

const setText = (id: string, value: string) => {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
};

const phaseIndex = (state: StageState): number => {
  if (!state.audioFile) return 0;
  if (!state.transcriptText) return 1;
  if (!state.plan || !state.planApproved) return 2;
  return 3;
};

export const initStageInspector = (
  els: StageElements,
  options: { enabled: boolean }
): StageInspector => {
  const cards = options.enabled
    ? Array.from(document.querySelectorAll<HTMLElement>("#panel > .card"))
    : [];

  const panel = document.getElementById("panel");
  [
    "cardAudio",
    "cardDirector",
    "cardPlan",
    "cardControls",
    "cardCamera",
    "cardLighting",
    "cardLibrary",
    "cardModels",
    "cardRuntime"
  ].forEach((cardId) => {
    const card = document.getElementById(cardId);
    if (options.enabled && panel && card) panel.appendChild(card);
  });

  const setCardOpen = (card: HTMLElement, open: boolean) => {
    const header = card.querySelector<HTMLButtonElement>(".card-header");
    const body = card.querySelector<HTMLElement>(".card-body");
    card.classList.toggle("collapsed", !open);
    if (header) header.setAttribute("aria-expanded", String(open));
    if (body) body.hidden = !open;
  };

  const openCard = (cardId: string) => {
    cards.forEach((card) => setCardOpen(card, card.id === cardId));
    document.getElementById(cardId)?.scrollIntoView({ block: "nearest" });
  };

  cards.forEach((card) => {
    const header = card.querySelector<HTMLButtonElement>(".card-header");
    const body = card.querySelector<HTMLElement>(".card-body");
    if (!header || !body) return;
    const bodyId = body.id || `${card.id}Body`;
    body.id = bodyId;
    header.type = "button";
    header.setAttribute("aria-controls", bodyId);
    header.addEventListener("click", () => {
      const opening = card.classList.contains("collapsed");
      cards.forEach((candidate) => setCardOpen(candidate, false));
      if (opening) setCardOpen(card, true);
    });
    setCardOpen(card, !card.classList.contains("collapsed"));
  });

  const sync = (state: StageState, changed: Partial<StageState> = {}) => {
    if (!options.enabled) return;

    const current = phaseIndex(state);
    workflowSteps.forEach((step, index) => {
      const item = document.querySelector<HTMLElement>(`[data-stage-step="${step}"]`);
      if (!item) return;
      item.dataset.state = index < current ? "complete" : index === current ? "current" : "pending";
      item.setAttribute("aria-current", index === current ? "step" : "false");
    });

    els.transcribeBtn.disabled = !state.audioFile || state.isAnalyzing || state.performing;
    els.analyzeBtn.disabled = state.performing || (!state.transcriptText && !state.isAnalyzing);
    els.lipsyncBtn.disabled = !state.transcriptText || state.performing;
    els.playBtn.disabled = !state.planApproved || state.performing;
    if (els.dataPoolSave) els.dataPoolSave.disabled = !state.transcriptText;

    setText("audioCardMeta", state.audioFile ? "Loaded" : "Required");
    setText("directorCardMeta", els.directorStyle.selectedOptions[0]?.textContent || "Cinematic");
    setText("planCardMeta", state.planApproved ? "Approved" : state.plan ? "Review" : "Pending");
    setText("controlsCardMeta", state.duoMode ? "Duo" : "Solo");
    setText("cameraCardMeta", state.cameraSettings.view);
    setText("lightingCardMeta", state.lightPreset);

    els.status.dataset.phase = state.performing
      ? "performing"
      : state.isAnalyzing
      ? "analyzing"
      : state.planApproved
      ? "ready"
      : state.audioFile
      ? "working"
      : "idle";

    if (changed.plan !== undefined && state.plan) openCard("cardPlan");
    if (changed.audioFile !== undefined && state.audioFile && !state.transcriptText) {
      openCard("cardAudio");
    }
  };

  return { openCard, sync };
};
