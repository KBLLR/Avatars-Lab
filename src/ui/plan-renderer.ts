import type { PlanElements, PlanSection } from "./types";

export interface PlanState {
  plan: { sections: PlanSection[] } | null;
  planApproved: boolean;
  planSource: "none" | "heuristic" | "llm";
  directorNotes: string;
  lightPreset: string;
}

export const setPlanApproved = (
  els: PlanElements,
  state: PlanState,
  approved: boolean
): void => {
  if (els.approveBtn) els.approveBtn.disabled = approved || !state.plan;
  if (els.playBtn) els.playBtn.disabled = !approved;
  if (els.planStatus) {
    els.planStatus.textContent = approved
      ? "Approved"
      : state.plan
      ? "Awaiting approval"
      : "Pending analysis";
  }
};

export const markPlanDirty = (
  els: PlanElements,
  state: PlanState
): void => {
  if (!state.plan) return;
  if (state.planApproved) {
    setPlanApproved(els, state, false);
  } else {
    if (els.planStatus) els.planStatus.textContent = "Awaiting approval";
  }
};

export const createSelect = (
  className: string,
  value: string,
  options: Array<{ value: string; label: string }>,
  onChange: (next: string) => void
): HTMLSelectElement => {
  const select = document.createElement("select");
  select.className = `chip-select ${className}`;
  options.forEach((option) => {
    const node = document.createElement("option");
    node.value = option.value;
    node.textContent = option.label;
    select.appendChild(node);
  });
  select.value = value;
  select.addEventListener("change", () => onChange(select.value));
  return select;
};

export const createInlineInput = (
  label: string,
  value: string,
  onChange: (next: string) => void
): HTMLDivElement => {
  const wrap = document.createElement("div");
  wrap.className = "chip-inline";
  const text = document.createElement("span");
  text.textContent = label;
  const input = document.createElement("input");
  input.value = value;
  input.addEventListener("change", () => onChange(input.value));
  wrap.appendChild(text);
  wrap.appendChild(input);
  return wrap;
};

export const updatePlanDetails = (
  els: PlanElements,
  sections: PlanSection[],
  state: Pick<PlanState, "planSource" | "directorNotes" | "lightPreset">
): void => {
  const details: string[] = [];
  sections.forEach((section, index) => {
    details.push(
      `${index + 1}. ${section.label} [${Math.round(section.start_ms / 1000)}s-${Math.round(
        section.end_ms / 1000
      )}s] role=${section.role} mood=${section.mood || "neutral"} camera=${section.camera || "upper"} light=${section.light || state.lightPreset}`
    );
    if (section.notes) details.push(`   notes: ${section.notes}`);
    if (section.actions?.length) details.push(`   actions: ${section.actions.length}`);
  });
  const header = `Source: ${state.planSource === "llm" ? "Director LLM" : "Fallback"} · Sections: ${sections.length}`;
  if (els.planDetails) els.planDetails.textContent = [header, ...details].join("\n");
  if (els.directorNotes) els.directorNotes.textContent = state.directorNotes || "Director notes unavailable.";
};

export const clearPlan = (els: PlanElements): void => {
  if (els.planList) {
    els.planList.innerHTML = "";
    const empty = document.createElement("div");
    empty.className = "plan-item";
    empty.textContent = "No staged sections yet.";
    els.planList.appendChild(empty);
  }
  if (els.planDetails) els.planDetails.textContent = "No performance plan yet.";
  if (els.directorNotes) els.directorNotes.textContent = "Director notes will appear here after analysis.";
};
