import {
  Activity,
  ArrowUpRight,
  AudioLines,
  AudioWaveform,
  Boxes,
  CircleGauge,
  Cpu,
  Hand,
  Layers3,
  MessagesSquare,
  MicVocal,
  PanelsTopLeft,
  ScanFace,
  Settings,
  SlidersHorizontal,
  Stethoscope,
  createIcons,
} from "lucide";
import { AVATAR_LAB_CASES } from "./cases/registry";
import { COREX_GATEWAY_URL, corexClient } from "./runtime/corex-client";
import "./styles/avatar-labs.css";

const caseGrid = document.querySelector<HTMLElement>("#case-grid");
const count = document.querySelector<HTMLElement>("#case-count");
const gatewayState = document.querySelector<HTMLElement>("#gateway-state");
const rendererState = document.querySelector<HTMLElement>("#renderer-state");

const statusLabel = (status: string) => status === "verified" ? "verified" : status;

if (caseGrid) {
  caseGrid.innerHTML = AVATAR_LAB_CASES.map((item) => `
    <a class="case-tile" href="${item.href}" data-case-id="${item.id}">
      <span class="case-tile__topline">
        <i data-lucide="${item.icon}" aria-hidden="true"></i>
        <span class="status-badge status-badge--${item.status}">${statusLabel(item.status)}</span>
      </span>
      <span class="case-tile__identity">
        <strong>${item.title}</strong>
        <span>${item.code}</span>
      </span>
      <span class="case-tile__description">${item.description}</span>
      <span class="case-tile__runtime">${item.renderer} &middot; ${item.services.join(" + ") || "browser"}</span>
      <i class="case-tile__open" data-lucide="ArrowUpRight" aria-hidden="true"></i>
    </a>
  `).join("");
}

if (count) count.textContent = `${AVATAR_LAB_CASES.length} harnesses`;

createIcons({
  icons: {
    Activity,
    ArrowUpRight,
    AudioLines,
    AudioWaveform,
    Boxes,
    CircleGauge,
    Cpu,
    Hand,
    Layers3,
    MessagesSquare,
    MicVocal,
    PanelsTopLeft,
    ScanFace,
    Settings,
    SlidersHorizontal,
    Stethoscope,
  },
  attrs: { "stroke-width": 1.5 },
});

const launcherResult = {
  ready: true,
  gateway: "checking",
  renderer: "gpu" in navigator ? "webgpu" : "webgl-fallback",
  cases: AVATAR_LAB_CASES.length,
  errors: [] as string[],
};
(window as Window & { __avatarLabsLauncherResult?: typeof launcherResult })
  .__avatarLabsLauncherResult = launcherResult;

if (rendererState) rendererState.textContent = launcherResult.renderer;

const controller = new AbortController();
window.setTimeout(() => controller.abort(), 2500);
corexClient.health(controller.signal).then((health) => {
  launcherResult.gateway = health.status || "online";
  if (gatewayState) {
    gatewayState.textContent = `${COREX_GATEWAY_URL.replace("http://", "")} online`;
    gatewayState.dataset.state = "online";
  }
}).catch((error: unknown) => {
  launcherResult.gateway = "offline";
  launcherResult.errors.push(error instanceof Error ? error.message : String(error));
  if (gatewayState) {
    gatewayState.textContent = `${COREX_GATEWAY_URL.replace("http://", "")} offline`;
    gatewayState.dataset.state = "offline";
  }
});
