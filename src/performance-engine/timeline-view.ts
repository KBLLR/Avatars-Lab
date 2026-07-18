import type { PerformanceClip, PerformanceProject, PerformanceTrack } from "./types";

interface TimelineCallbacks {
  onSeek: (timeMs: number) => void;
  onSelectClip: (trackId: string, clipId: string) => void;
  onClipChange: (trackId: string, clipId: string, startMs: number, durationMs: number) => void;
}

const LABEL_WIDTH = 184;
const MIN_CANVAS_WIDTH = 900;
const SNAP_MS = 100;

const formatTime = (timeMs: number): string => {
  const totalSeconds = Math.max(0, timeMs) / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const frames = Math.floor((totalSeconds % 1) * 30);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}:${String(frames).padStart(2, "0")}`;
};

const button = (label: string, title: string): HTMLButtonElement => {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "timeline-track-toggle";
  element.textContent = label;
  element.title = title;
  return element;
};

export class PerformanceTimelineView {
  private project: PerformanceProject | null = null;
  private scale = 44;
  private playhead: HTMLElement | null = null;
  private selectedClipId: string | null = null;

  constructor(private root: HTMLElement, private callbacks: TimelineCallbacks) {}

  setScale(pixelsPerSecond: number): void {
    this.scale = Math.max(20, Math.min(120, pixelsPerSecond));
    if (this.project) this.render(this.project);
  }

  render(project: PerformanceProject): void {
    this.project = project;
    this.root.replaceChildren();
    const totalWidth = Math.max(MIN_CANVAS_WIDTH, project.durationMs / 1000 * this.scale);
    const shell = document.createElement("div");
    shell.className = "timeline-shell";
    shell.style.setProperty("--timeline-width", `${totalWidth}px`);

    const ruler = document.createElement("div");
    ruler.className = "timeline-ruler";
    const corner = document.createElement("div");
    corner.className = "timeline-ruler-corner";
    corner.textContent = `${project.fps} FPS`;
    ruler.append(corner);
    const ticks = document.createElement("div");
    ticks.className = "timeline-ruler-ticks";
    ticks.style.width = `${totalWidth}px`;
    const majorEvery = project.durationMs > 120_000 ? 10 : project.durationMs > 60_000 ? 5 : 2;
    for (let second = 0; second <= Math.ceil(project.durationMs / 1000); second += majorEvery) {
      const tick = document.createElement("span");
      tick.className = "timeline-tick";
      tick.style.left = `${second * this.scale}px`;
      tick.textContent = formatTime(second * 1000).slice(0, 5);
      ticks.append(tick);
    }
    ruler.append(ticks);
    shell.append(ruler);

    const rows = document.createElement("div");
    rows.className = "timeline-rows";
    for (const track of project.tracks) rows.append(this.createTrackRow(track, totalWidth));
    const playhead = document.createElement("div");
    playhead.className = "timeline-playhead";
    playhead.style.left = `${LABEL_WIDTH}px`;
    playhead.innerHTML = "<span></span>";
    rows.append(playhead);
    this.playhead = playhead;
    shell.append(rows);
    this.root.append(shell);
  }

  setTime(timeMs: number): void {
    if (!this.playhead) return;
    this.playhead.style.transform = `translateX(${timeMs / 1000 * this.scale}px)`;
  }

  selectClip(clipId: string | null): void {
    this.selectedClipId = clipId;
    this.root.querySelectorAll<HTMLElement>(".timeline-clip").forEach((element) => {
      element.classList.toggle("is-selected", element.dataset.clipId === clipId);
    });
  }

  private createTrackRow(track: PerformanceTrack, totalWidth: number): HTMLElement {
    const row = document.createElement("div");
    row.className = "timeline-track";
    row.dataset.trackId = track.id;
    const label = document.createElement("div");
    label.className = "timeline-track-label";
    const swatch = document.createElement("span");
    swatch.className = "timeline-track-swatch";
    swatch.style.backgroundColor = track.color;
    const copy = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = track.name;
    const kind = document.createElement("small");
    kind.textContent = track.kind;
    copy.append(name, kind);
    const controls = document.createElement("div");
    controls.className = "timeline-track-controls";
    const mute = button(track.muted ? "M" : "·", track.muted ? "Muted" : "Track enabled");
    mute.disabled = true;
    const lock = button(track.locked ? "L" : "·", track.locked ? "Locked" : "Editable");
    lock.disabled = true;
    controls.append(mute, lock);
    label.append(swatch, copy, controls);
    row.append(label);

    const lane = document.createElement("div");
    lane.className = "timeline-lane";
    lane.style.width = `${totalWidth}px`;
    lane.addEventListener("pointerdown", (event) => {
      if (event.target !== lane) return;
      const rect = lane.getBoundingClientRect();
      this.callbacks.onSeek(Math.max(0, Math.min(this.project!.durationMs, (event.clientX - rect.left) / this.scale * 1000)));
    });
    for (const clip of track.clips) lane.append(this.createClip(track, clip));
    row.append(lane);
    return row;
  }

  private createClip(track: PerformanceTrack, clip: PerformanceClip): HTMLElement {
    const element = document.createElement("button");
    element.type = "button";
    element.className = "timeline-clip";
    if (clip.id === this.selectedClipId) element.classList.add("is-selected");
    element.dataset.clipId = clip.id;
    element.style.left = `${clip.startMs / 1000 * this.scale}px`;
    element.style.width = `${Math.max(18, clip.durationMs / 1000 * this.scale)}px`;
    element.style.setProperty("--clip-color", clip.color || track.color);
    const title = document.createElement("strong");
    title.textContent = clip.label;
    const meta = document.createElement("small");
    meta.textContent = formatTime(clip.durationMs);
    const resize = document.createElement("span");
    resize.className = "timeline-clip-resize";
    resize.title = "Resize clip";
    element.append(title, meta, resize);
    element.addEventListener("click", () => {
      this.selectedClipId = clip.id;
      this.selectClip(clip.id);
      this.callbacks.onSelectClip(track.id, clip.id);
    });
    element.addEventListener("pointerdown", (event) => {
      if (track.locked) return;
      event.stopPropagation();
      this.selectedClipId = clip.id;
      this.selectClip(clip.id);
      this.callbacks.onSelectClip(track.id, clip.id);
      const resizing = event.target === resize;
      const originX = event.clientX;
      const originStart = clip.startMs;
      const originDuration = clip.durationMs;
      let changed = false;
      element.setPointerCapture(event.pointerId);
      const move = (moveEvent: PointerEvent) => {
        const deltaMs = Math.round(((moveEvent.clientX - originX) / this.scale * 1000) / SNAP_MS) * SNAP_MS;
        if (Math.abs(moveEvent.clientX - originX) >= 2) changed = true;
        if (resizing) {
          const duration = Math.max(SNAP_MS, Math.min(this.project!.durationMs - clip.startMs, originDuration + deltaMs));
          element.style.width = `${Math.max(18, duration / 1000 * this.scale)}px`;
          element.dataset.previewDuration = String(duration);
        } else {
          const start = Math.max(0, Math.min(this.project!.durationMs - clip.durationMs, originStart + deltaMs));
          element.style.left = `${start / 1000 * this.scale}px`;
          element.dataset.previewStart = String(start);
        }
      };
      const up = (upEvent: PointerEvent) => {
        element.removeEventListener("pointermove", move);
        element.removeEventListener("pointerup", up);
        element.removeEventListener("pointercancel", up);
        element.releasePointerCapture(upEvent.pointerId);
        const start = Number(element.dataset.previewStart ?? clip.startMs);
        const duration = Number(element.dataset.previewDuration ?? clip.durationMs);
        delete element.dataset.previewStart;
        delete element.dataset.previewDuration;
        if (changed) this.callbacks.onClipChange(track.id, clip.id, start, duration);
      };
      element.addEventListener("pointermove", move);
      element.addEventListener("pointerup", up);
      element.addEventListener("pointercancel", up);
    });
    return element;
  }
}
