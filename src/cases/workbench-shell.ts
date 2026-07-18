import { ChevronDown, Grid3X3, createElement } from "lucide";
import { AVATAR_LAB_CASES } from "./registry";

const currentPath = window.location.pathname.replace(/\/$/, "") || "/";
const currentCase = AVATAR_LAB_CASES.find((item) => item.href === currentPath);

document.body.dataset.avatarLabsWorkbench = "true";
if (currentCase) document.body.dataset.avatarLabsCase = currentCase.id;

const bar = document.createElement("header");
bar.className = "case-workbench-bar";
bar.setAttribute("aria-label", "Avatar Labs case navigation");

const launcherLink = document.createElement("a");
launcherLink.className = "case-workbench-bar__launcher";
launcherLink.href = "/";
launcherLink.title = "All Avatar Labs cases";
launcherLink.setAttribute("aria-label", "All Avatar Labs cases");
launcherLink.appendChild(createElement(Grid3X3, { width: 15, height: 15 }));

const identity = document.createElement("div");
identity.className = "case-workbench-bar__identity";
identity.innerHTML = `
  <span>Core-X / Avatar Labs</span>
  <strong>${currentCase?.title || document.title}</strong>
`;

const routePicker = document.createElement("label");
routePicker.className = "case-workbench-bar__picker";
routePicker.title = "Switch case";
const routeSelect = document.createElement("select");
routeSelect.setAttribute("aria-label", "Switch Avatar Labs case");
for (const item of AVATAR_LAB_CASES) {
  const option = document.createElement("option");
  option.value = item.href;
  option.textContent = `${item.code} / ${item.title}`;
  option.selected = item.href === currentPath;
  routeSelect.appendChild(option);
}
routeSelect.addEventListener("change", () => {
  window.location.assign(routeSelect.value);
});
routePicker.append(routeSelect, createElement(ChevronDown, { width: 14, height: 14 }));

const runtime = document.createElement("div");
runtime.className = "case-workbench-bar__runtime";
runtime.innerHTML = `
  <span class="case-workbench-bar__state">Local</span>
  <span>${currentCase?.renderer || "dom"}</span>
`;

bar.append(launcherLink, identity, routePicker, runtime);
document.body.prepend(bar);

if (currentCase?.id === "composition-layer" && window.matchMedia("(max-width: 700px)").matches) {
  const panels = Array.from(document.querySelectorAll<HTMLElement>(".panel"));
  panels.forEach((panel) => panel.classList.add("minimized"));
  panels.forEach((panel) => {
    panel.addEventListener("click", () => {
      if (!panel.classList.contains("minimized")) {
        panels.filter((candidate) => candidate !== panel).forEach((candidate) => {
          candidate.classList.add("minimized");
        });
      }
    });
  });
}

document.documentElement.dataset.avatarLabsCaseShell = "ready";
