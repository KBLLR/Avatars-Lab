for (const clip of document.querySelectorAll<HTMLVideoElement>(".portrait-clips video")) {
  const showError = () => {
    const status = clip.parentElement?.querySelector<HTMLElement>("[role=status]");
    if (status) status.textContent = "Clip unavailable. Check that the local review media is mounted.";
  };
  clip.addEventListener("error", showError);
  if (clip.error) showError();
}

if (document.querySelector("#reviewBody")) {
  type MatchedPair = { control: string; test: string; condition: string; notes: string };
  type ReviewEntry = { id: string; persona: string; house: string; sentence: string; pair?: MatchedPair };
  const reviewRoot = "/portrait-review";
  const reviewStatus = document.querySelector<HTMLParagraphElement>("#reviewStatus")!;
  const body = document.querySelector<HTMLDivElement>("#reviewBody")!;
  const cast = document.querySelector<HTMLSelectElement>("#reviewCast")!;
  const sentence = document.querySelector<HTMLParagraphElement>("#reviewSentence")!;
  const driver = document.querySelector<HTMLVideoElement>("#reviewDriver")!;
  const render = document.querySelector<HTMLVideoElement>("#reviewRender")!;
  const scores = document.querySelector<HTMLFieldSetElement>("#reviewScores")!;

  const pairPanel = document.querySelector<HTMLElement>("#matchedPair")!;
  const pairNotes = document.querySelector<HTMLParagraphElement>("#pairNotes")!;
  const pairControl = document.querySelector<HTMLVideoElement>("#pairControl")!;
  const pairTest = document.querySelector<HTMLVideoElement>("#pairTest")!;

  const criteria = ["Identity", "Lip sync", "Visible flaws"];
  const scoreInputs = criteria.map((criterion) => {
    const label = document.createElement("label");
    const select = document.createElement("select");
    select.setAttribute("aria-label", criterion);
    label.textContent = criterion;
    select.add(new Option("Unscored", ""));
    for (let score = 1; score <= 5; score++) select.add(new Option(String(score)));
    label.append(select);
    scores.append(label);
    return select;
  });

  const isReviewEntry = (entry: unknown): entry is ReviewEntry => {
    if (!entry || typeof entry !== "object") return false;
    const value = entry as Partial<ReviewEntry>;
    return typeof value.id === "string" && /^[a-z][a-z0-9-]*$/.test(value.id) &&
      typeof value.persona === "string" && typeof value.house === "string" &&
      typeof value.sentence === "string";
  };

  async function loadReview() {
    try {
      const response = await fetch(`${reviewRoot}/review.json`);
      if (!response.ok) throw new Error("Review unavailable");
      const data: unknown = await response.json();
      if (!Array.isArray(data) || !data.length || !data.every(isReviewEntry)) {
        throw new Error("Invalid review catalog");
      }
      const entries = new Map(data.map((entry) => [entry.id, entry]));
      for (const entry of entries.values()) cast.add(new Option(`${entry.persona} · ${entry.house}`, entry.id));
      const loadClip = (clip: HTMLVideoElement, path: string) => {
        const message = clip.parentElement?.querySelector<HTMLElement>("[role=status]");
        if (message) message.textContent = "";
        const url = `${reviewRoot}/${path}.mp4`;
        if (clip.getAttribute("src") !== url) clip.src = url;
      };
      const storageKey = (criterion: string) => `avatar-labs:portrait-review:20261126:${cast.value}:${criterion}`;
      const show = () => {
        const entry = entries.get(cast.value);
        if (!entry) return;
        sentence.textContent = entry.sentence;
        loadClip(driver, `${entry.id}-driver`);
        loadClip(render, `${entry.id}-render`);
        const pair = entry.pair;
        pairPanel.hidden = !(pair && entries.has(pair.control) && entries.has(pair.test));
        if (pair && !pairPanel.hidden) {
          pairNotes.textContent = `${pair.condition}. ${pair.notes}`;
          loadClip(pairControl, `${pair.control}-render`);
          loadClip(pairTest, `${pair.test}-render`);
        } else {
          pairControl.pause();
          pairTest.pause();
        }
        scoreInputs.forEach((input, index) => {
          input.value = localStorage.getItem(storageKey(criteria[index])) ?? "";
        });
      };
      scoreInputs.forEach((input, index) => input.addEventListener("change", () => {
        localStorage.setItem(storageKey(criteria[index]), input.value);
      }));
      cast.addEventListener("change", show);
      show();
      body.hidden = false;
    } catch {
      reviewStatus.textContent = "The local portrait review media is unavailable.";
    }
  }

  void loadReview();
}
